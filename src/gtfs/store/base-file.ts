/**
 * A FeedStore base as one binary file.
 *
 * Layout: 8-byte magic, u32 meta length, u32 zero, meta JSON, then every
 * typed array 8-byte aligned at the offset the meta records. The base is
 * immutable, so a store with edits is refused: fold the edits into a new
 * store first.
 *
 * The layout is written and read through `ByteSink` / `ByteSource`, so the
 * same code serves OPFS (`opfs-base.ts`) and in-memory tests.
 */

import { ColTable } from './col-table';
import { CSR, Col, Grow, Interner, type Kind } from './columns';
import { FeedStore, type BaseParts, type StopTimesMode } from './feed-store';
import { Patterns } from './patterns';
import { ShapeTable } from './shapes';
import type { StreamResult } from './csv-stream';

const MAGIC = 'GTFSZB01';
/** Bump on any layout change; an older file is refused, not migrated. */
const FORMAT = 2;
const HEADER = 16;
/** Strings per encoded chunk, so no single string is built from millions. */
const STR_CHUNK = 200_000;

export interface ByteSink {
  write(bytes: Uint8Array, at: number): void;
}

export interface ByteSource {
  readonly size: number;
  /** Fill `into` from offset `at`; must fill it completely. */
  read(into: Uint8Array, at: number): void;
}

type ArrayName = 'u32' | 'i32' | 'u8';
type Arr = Uint32Array | Int32Array | Uint8Array;
const CTORS = { u32: Uint32Array, i32: Int32Array, u8: Uint8Array } as const;

interface BufRef {
  t: ArrayName;
  off: number;
  len: number;
}

interface ColMeta {
  kind: Kind;
  data: BufRef;
  dec: BufRef | null;
  exc: [number, string][];
}

interface TableMeta {
  name: string;
  n: number;
  cols: string[];
  data: ColMeta[];
}

interface CsrMeta {
  keys: BufRef;
  offs: BufRef;
  rows: BufRef;
}

interface Meta {
  format: number;
  /** File size, checked on read to catch a truncated write. */
  size: number;
  stream: StreamResult;
  stopTimesMode: StopTimesMode;
  stopTimesCols: string[];
  shapeCols: string[];
  files: { name: string; data: BufRef }[];
  strChunks: { text: BufRef; lens: BufRef }[];
  sorted: BufRef;
  tables: TableMeta[];
  patterns: {
    header: string[];
    rows: TableMeta;
    patStart: BufRef;
    tripKeys: BufRef;
    tripPattern: BufRef;
    tripTimeStart: BufRef;
    arr: ColMeta | null;
    dep: ColMeta | null;
    stopRows: CsrMeta;
    rowPattern: BufRef;
    patternTrips: CsrMeta;
  } | null;
  shapes: {
    cols: string[];
    n: number;
    data: [string, ColMeta][];
    seq: ColMeta | null;
    runKey: BufRef;
    runStart: BufRef;
    runSeq0: BufRef;
    sortedKeys: BufRef;
    sortedRuns: BufRef;
  } | null;
}

function arrayName(a: Arr): ArrayName {
  if (a instanceof Uint32Array) {
    return 'u32';
  }
  if (a instanceof Int32Array) {
    return 'i32';
  }
  return 'u8';
}

/** Collects buffers and assigns their offsets, relative to the data start. */
class Layout {
  bufs: { ref: BufRef; a: Arr }[] = [];
  end = 0;

  add(a: Arr): BufRef {
    this.end = align8(this.end);
    const ref = { t: arrayName(a), off: this.end, len: a.length };
    this.bufs.push({ ref, a });
    this.end += a.byteLength;
    return ref;
  }

  col(c: Col): ColMeta {
    return {
      kind: c.kind,
      data: this.add(c.data.trim()),
      dec: c.dec ? this.add(c.dec.trim()) : null,
      exc: [...c.exc],
    };
  }

  table(t: ColTable): TableMeta {
    return {
      name: t.name,
      n: t.n,
      cols: [...t.cols],
      data: t.data.map((c) => this.col(c)),
    };
  }

  csr(c: CSR): CsrMeta {
    return {
      keys: this.add(c.keys),
      offs: this.add(c.offs),
      rows: this.add(c.rows),
    };
  }
}

function align8(n: number): number {
  return Math.ceil(n / 8) * 8;
}

/** Write the store's base. Returns the file size in bytes. */
export function writeBase(
  store: FeedStore,
  stream: StreamResult,
  sink: ByteSink
): number {
  const parts = store.baseParts();
  const enc = new TextEncoder();
  const L = new Layout();

  const strs = parts.pool.strs;
  const strChunks: Meta['strChunks'] = [];
  for (let i = 0; i < strs.length; i += STR_CHUNK) {
    const slice = strs.slice(i, i + STR_CHUNK);
    const lens = new Uint32Array(slice.length);
    slice.forEach((s, k) => (lens[k] = s.length));
    strChunks.push({
      text: L.add(enc.encode(slice.join(''))),
      lens: L.add(lens),
    });
  }

  const p = parts.patterns;
  const sh = parts.shapes;
  const meta: Meta = {
    format: FORMAT,
    size: 0,
    stream,
    stopTimesMode: parts.stopTimesMode,
    stopTimesCols: parts.stopTimesCols,
    shapeCols: parts.shapeCols,
    files: [...parts.files].map(([name, bytes]) => ({
      name,
      data: L.add(bytes),
    })),
    strChunks,
    sorted: L.add(parts.pool.sorted!),
    tables: parts.tables.map((t) => L.table(t)),
    patterns: p
      ? {
          header: p.header,
          rows: L.table(p.rows),
          patStart: L.add(p.patStart),
          tripKeys: L.add(p.tripKeys),
          tripPattern: L.add(p.tripPattern),
          tripTimeStart: L.add(p.tripTimeStart),
          arr: p.arr ? L.col(p.arr) : null,
          dep: p.dep ? L.col(p.dep) : null,
          stopRows: L.csr(p.stopRows),
          rowPattern: L.add(p.rowPattern),
          patternTrips: L.csr(p.patternTrips),
        }
      : null,
    shapes: sh
      ? {
          cols: sh.cols,
          n: sh.n,
          data: [...sh.data].map(([k, c]) => [k, L.col(c)]),
          seq: sh.seq ? L.col(sh.seq) : null,
          runKey: L.add(sh.runKey.trim()),
          runStart: L.add(sh.runStart.trim()),
          runSeq0: L.add(sh.runSeq0.trim()),
          sortedKeys: L.add(sh.sortedKeys),
          sortedRuns: L.add(sh.sortedRuns),
        }
      : null,
  };

  // The size depends on the meta length, which depends on the size: settle
  // it with a fixed-width placeholder.
  meta.size = Number.MAX_SAFE_INTEGER;
  const metaLen = enc.encode(JSON.stringify(meta)).length;
  const dataStart = align8(HEADER + metaLen);
  meta.size = dataStart + L.end;
  let metaBytes = enc.encode(JSON.stringify(meta));
  if (metaBytes.length > metaLen) {
    throw new Error('[BaseFile] meta grew while sizing');
  }
  // Pad with spaces so the length matches the reserved space exactly.
  if (metaBytes.length < metaLen) {
    const padded = new Uint8Array(metaLen).fill(0x20);
    padded.set(metaBytes);
    metaBytes = padded;
  }

  const head = new Uint8Array(HEADER);
  head.set(enc.encode(MAGIC));
  new DataView(head.buffer).setUint32(8, metaLen, true);
  sink.write(head, 0);
  sink.write(metaBytes, HEADER);
  for (const { ref, a } of L.bufs) {
    sink.write(
      new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
      dataStart + ref.off
    );
  }
  console.log(
    `[BaseFile] wrote ${meta.size} bytes, ${L.bufs.length} buffers, ${strs.length} strings`
  );
  return meta.size;
}

/** Read a base written by `writeBase` into a finished, edit-free store. */
export function readBase(src: ByteSource): {
  store: FeedStore;
  stream: StreamResult;
} {
  const dec = new TextDecoder();
  const head = new Uint8Array(HEADER);
  if (src.size < HEADER) {
    throw new Error(`[BaseFile] file too short (${src.size} bytes)`);
  }
  src.read(head, 0);
  if (dec.decode(head.subarray(0, 8)) !== MAGIC) {
    throw new Error('[BaseFile] not a feed base file');
  }
  const metaLen = new DataView(head.buffer).getUint32(8, true);
  const metaBytes = new Uint8Array(metaLen);
  src.read(metaBytes, HEADER);
  const meta = JSON.parse(dec.decode(metaBytes)) as Meta;
  if (meta.format !== FORMAT) {
    throw new Error(
      `[BaseFile] format ${meta.format}, expected ${FORMAT}; reset the stored data`
    );
  }
  if (src.size !== meta.size) {
    throw new Error(
      `[BaseFile] size ${src.size}, expected ${meta.size}: the file is incomplete`
    );
  }
  const dataStart = align8(HEADER + metaLen);

  // One read per buffer: a single ArrayBuffer for a multi-GB file fails.
  const arr = <T extends ArrayName>(r: BufRef & { t: T }) => {
    const a = new CTORS[r.t](r.len);
    src.read(
      new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
      dataStart + r.off
    );
    return a as InstanceType<(typeof CTORS)[T]>;
  };
  const u32 = (r: BufRef) =>
    arr(r as BufRef & { t: 'u32' }) as Uint32Array<ArrayBuffer>;

  const strs: string[] = [];
  for (const c of meta.strChunks) {
    const text = dec.decode(arr(c.text));
    const lens = u32(c.lens);
    let at = 0;
    for (let k = 0; k < lens.length; k++) {
      strs.push(text.slice(at, at + lens[k]));
      at += lens[k];
    }
  }
  const pool = Interner.frozen(strs, u32(meta.sorted));

  const col = (m: ColMeta): Col => {
    const c = new Col(m.kind, pool);
    const data = arr(m.data);
    c.data =
      data instanceof Uint32Array
        ? Grow.from(Uint32Array, data)
        : Grow.from(Int32Array, data as Int32Array);
    c.dec = m.dec ? Grow.from(Uint8Array, arr(m.dec) as Uint8Array) : null;
    c.exc = new Map(m.exc);
    return c;
  };
  const table = (m: TableMeta): ColTable => {
    const t = new ColTable(m.name, pool);
    t.cols = m.cols;
    t.data = m.data.map(col);
    t.n = m.n;
    return t;
  };
  const csr = (m: CsrMeta) => new CSR(u32(m.keys), u32(m.offs), u32(m.rows));

  const pm = meta.patterns;
  const patterns = pm
    ? new Patterns(
        pm.header,
        table(pm.rows),
        u32(pm.patStart),
        u32(pm.tripKeys),
        u32(pm.tripPattern),
        u32(pm.tripTimeStart),
        pm.arr ? col(pm.arr) : null,
        pm.dep ? col(pm.dep) : null,
        csr(pm.stopRows),
        u32(pm.rowPattern),
        csr(pm.patternTrips),
        pool
      )
    : null;

  const sm = meta.shapes;
  let shapes: ShapeTable | null = null;
  if (sm) {
    shapes = ShapeTable.restore(pool, {
      cols: sm.cols,
      n: sm.n,
      data: new Map(sm.data.map(([k, m]) => [k, col(m)])),
      seq: sm.seq ? col(sm.seq) : null,
      runKey: u32(sm.runKey),
      runStart: u32(sm.runStart),
      runSeq0: arr(
        sm.runSeq0 as BufRef & { t: 'i32' }
      ) as Int32Array<ArrayBuffer>,
      sortedKeys: u32(sm.sortedKeys),
      sortedRuns: u32(sm.sortedRuns),
    });
  }

  const parts: BaseParts = {
    pool,
    tables: meta.tables.map(table),
    patterns,
    shapes,
    stopTimesMode: meta.stopTimesMode,
    stopTimesCols: meta.stopTimesCols,
    shapeCols: meta.shapeCols,
    files: new Map(
      meta.files.map((f) => [
        f.name,
        arr(f.data as BufRef & { t: 'u8' }) as Uint8Array,
      ])
    ),
  };
  console.log(
    `[BaseFile] read ${meta.size} bytes, ${strs.length} strings, ${parts.tables.length} tables`
  );
  return { store: FeedStore.fromBase(parts), stream: meta.stream };
}
