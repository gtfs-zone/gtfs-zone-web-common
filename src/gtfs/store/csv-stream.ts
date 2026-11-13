/**
 * Streaming unzip (fflate) into chunked CSV parsing (PapaParse).
 *
 * Never holds a whole file as text: each inflated chunk is decoded and parsed
 * as it arrives, and a nested archive is inflated straight into a second
 * `Unzip`. Inflate and parse run synchronously inside `push`, so the byte
 * source is only read as fast as the sinks consume rows.
 */

import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';
import Papa from 'papaparse';
import { LoadCancelledError } from '../feed-download';

export interface TableSink {
  /** The header, trimmed and without a BOM. Called once, before any rows. */
  header(cols: string[]): void;
  /** One parsed batch. A row may be shorter than the header. */
  rows(batch: string[][]): void;
  end(): void;
}

export interface StreamOptions {
  /** Nested archive path inside the outer one, one per level. */
  innerPaths?: string[];
  /** Strip leading/trailing whitespace from every value (and count it). */
  trim?: boolean;
  signal?: AbortSignal;
  /** Compressed bytes read from the source so far. */
  onBytes?: (read: number) => void;
  /** Inflated bytes of `table` so far; `size` is 0 when the zip omits it. */
  onTableBytes?: (table: string, read: number, size: number) => void;
  /**
   * Receives each non-`.txt` entry's whole contents, by archive path. When
   * unset, those entries are only listed in `otherFiles`, never inflated.
   */
  onOtherFile?: (name: string, bytes: Uint8Array) => void;
}

export interface StreamResult {
  /** Rows per table, after empty lines were skipped. */
  rows: Record<string, number>;
  /** `file.column` to the number of values that needed trimming. */
  padded: Record<string, number>;
  /** Papa errors per table, capped per table. */
  errors: Record<string, string[]>;
  /** Archive entries that were not `.txt` tables, by name. */
  otherFiles: string[];
}

const MAX_ERRORS_PER_TABLE = 20;

/** Minimal Node-style readable, the shape Papa's stream parser accepts. */
class PushStream {
  readable = true;
  private handlers: Record<string, ((x?: unknown) => void)[]> = {};
  read(): void {}
  pause(): void {}
  resume(): void {}
  on(ev: string, fn: (x?: unknown) => void): void {
    (this.handlers[ev] ??= []).push(fn);
  }
  removeListener(ev: string, fn: (x?: unknown) => void): void {
    this.handlers[ev] = (this.handlers[ev] ?? []).filter((f) => f !== fn);
  }
  emit(ev: string, x?: unknown): void {
    for (const f of [...(this.handlers[ev] ?? [])]) {
      f(x);
    }
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const c of chunks) {
    n += c.length;
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Table name of an archive entry (`dir/stops.txt` -> `stops`), or null. */
function tableName(path: string): string | null {
  const base = path.split('/').pop() ?? path;
  return base.toLowerCase().endsWith('.txt') ? base.slice(0, -4) : null;
}

/**
 * Parse every `.txt` entry of a GTFS zip read from `source`.
 *
 * `sinkFor` returns null to skip a table without parsing it. A sink that
 * throws fails the whole stream rather than being swallowed by the parser.
 */
export async function streamGtfsZip(
  source: ReadableStream<Uint8Array>,
  sinkFor: (table: string, size: number) => TableSink | null,
  options: StreamOptions = {}
): Promise<StreamResult> {
  const result: StreamResult = {
    rows: {},
    padded: {},
    errors: {},
    otherFiles: [],
  };
  const pending: Promise<void>[] = [];
  let failed: unknown = null;
  const fail = (err: unknown): void => {
    failed ??= err;
  };

  const onTableFile = (file: UnzipFile, table: string): void => {
    const size = file.originalSize ?? 0;
    const sink = sinkFor(table, size);
    if (!sink) {
      return;
    }
    console.log(`[CsvStream] ${table}: parsing (${size} bytes)`);
    result.rows[table] = 0;
    let read = 0;
    let header: string[] | null = null;
    const decoder = new TextDecoder('utf-8');
    const stream = new PushStream();
    let resolve!: () => void;
    pending.push(new Promise<void>((r) => (resolve = r)));

    const guard = (fn: () => void): void => {
      if (failed) {
        return;
      }
      try {
        fn();
      } catch (err) {
        fail(err);
      }
    };

    const trimBatch = (batch: string[][]): void => {
      for (const row of batch) {
        for (let c = 0; c < row.length; c++) {
          const v = row[c];
          const t = v.trim();
          if (t !== v) {
            row[c] = t;
            const key = `${table}.${header![c] ?? c}`;
            result.padded[key] = (result.padded[key] ?? 0) + 1;
          }
        }
      }
    };

    Papa.parse(stream as unknown as File, {
      header: false,
      skipEmptyLines: 'greedy',
      chunk: (res: Papa.ParseResult<string[]>) =>
        guard(() => {
          if (res.errors.length) {
            const list = (result.errors[table] ??= []);
            for (const e of res.errors) {
              if (list.length < MAX_ERRORS_PER_TABLE) {
                list.push(`row ${e.row ?? '?'}: ${e.message}`);
              }
            }
          }
          let data = res.data;
          if (!header && data.length) {
            header = data[0].map((h, i) =>
              (i === 0 ? h.replace(/^\uFEFF/, '') : h).trim()
            );
            sink.header(header);
            data = data.slice(1);
          }
          if (!data.length) {
            return;
          }
          if (options.trim !== false) {
            trimBatch(data);
          }
          result.rows[table] += data.length;
          sink.rows(data);
        }),
      complete: () =>
        guard(() => {
          if (!header) {
            sink.header([]);
          }
          sink.end();
          console.log(
            `[CsvStream] ${table}: ${result.rows[table]} rows parsed`
          );
          resolve();
        }),
    });

    file.ondata = (err, chunk, final) => {
      if (err) {
        fail(err);
        return;
      }
      if (failed) {
        return;
      }
      read += chunk.length;
      options.onTableBytes?.(table, read, size);
      const text = decoder.decode(chunk, { stream: !final });
      if (text) {
        stream.emit('data', text);
      }
      if (final) {
        stream.emit('end');
      }
    };
    file.start();
  };

  const onOtherFile = (
    file: UnzipFile,
    take: (name: string, bytes: Uint8Array) => void
  ): void => {
    const chunks: Uint8Array[] = [];
    let resolve!: () => void;
    pending.push(new Promise<void>((r) => (resolve = r)));
    file.ondata = (err, chunk, final) => {
      if (err) {
        fail(err);
        resolve();
        return;
      }
      if (failed) {
        resolve();
        return;
      }
      chunks.push(chunk);
      if (final) {
        try {
          take(file.name, concat(chunks));
          console.log(`[CsvStream] ${file.name}: kept as a file`);
        } catch (e) {
          fail(e);
        }
        resolve();
      }
    };
    file.start();
  };

  // Innermost archive first: each nested level feeds the next Unzip.
  const innerPaths = options.innerPaths ?? [];
  const levels: Unzip[] = [];
  const foundZips: string[][] = innerPaths.map(() => []);
  const matched: boolean[] = innerPaths.map(() => false);
  for (let level = 0; level <= innerPaths.length; level++) {
    const isLast = level === innerPaths.length;
    const uz = new Unzip((file) => {
      if (!isLast) {
        if (file.name === innerPaths[level]) {
          matched[level] = true;
          const next = levels[level + 1];
          file.ondata = (err, chunk, final) => {
            if (err) {
              fail(err);
              return;
            }
            if (!failed) {
              next.push(chunk, final);
            }
          };
          file.start();
        } else if (file.name.toLowerCase().endsWith('.zip')) {
          foundZips[level].push(file.name);
        }
        return;
      }
      const table = tableName(file.name);
      if (table) {
        onTableFile(file, table);
      } else if (!file.name.endsWith('/')) {
        result.otherFiles.push(file.name);
        if (options.onOtherFile) {
          onOtherFile(file, options.onOtherFile);
        }
      }
    });
    uz.register(UnzipInflate);
    levels.push(uz);
  }
  const outer = levels[0];

  const reader = source.getReader();
  const abort = (): void => fail(new LoadCancelledError());
  options.signal?.addEventListener('abort', abort);
  let bytes = 0;
  try {
    for (;;) {
      if (failed) {
        throw failed;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.length;
      options.onBytes?.(bytes);
      outer.push(value, false);
    }
    outer.push(new Uint8Array(0), true);
    if (failed) {
      throw failed;
    }
    for (let level = 0; level < innerPaths.length; level++) {
      if (!matched[level]) {
        const found = foundZips[level];
        throw new Error(
          `The archive has no entry "${innerPaths[level]}"; it contains ${
            found.length ? found.join(', ') : 'no nested archives at all'
          }.`
        );
      }
    }
    await Promise.all(pending);
    if (failed) {
      throw failed;
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
  return result;
}
