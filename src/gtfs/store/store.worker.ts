/**
 * The worker that owns one loaded feed.
 *
 * It streams the zip into a `FeedStore`, posts the mirrored tables and the
 * summary, then serves reads and edits by RPC until the client terminates
 * it. Terminating is the release: it is the only thing that hands the whole
 * heap back.
 */

import {
  FeedStore,
  type IdRow,
  type Row,
  type StoreOptions,
} from './feed-store';
import { streamGtfsZip, type StreamResult } from './csv-stream';
import { loadBaseFile, saveBaseFile } from './opfs-base';
import {
  allShapes,
  allStopTimes,
  feedSummary,
  routeGeometries,
  routeTrips,
  tripsInfo,
  type FeedSummary,
} from './feed-queries';
import { splitInnerZipPath } from '../feed-url-resolve';
import { describeHttpError, describeNetworkError } from '../feed-selection';

/**
 * Where the feed comes from. A URL may name a nested zip (`a.zip#b.zip`);
 * `base` names a base file saved earlier with `saveBase`.
 */
export type StoreInput = { url: string } | { file: File } | { base: string };

export interface LoadOptions extends StoreOptions {
  /** Trim leading/trailing whitespace from values (default true). */
  trim?: boolean;
  /** Tables sent whole to the main thread for synchronous reads. */
  mirror?: string[];
}

export interface LoadProgress {
  stage: 'read' | 'restore' | 'index';
  /** Compressed bytes read, and the total when known. */
  bytes: number;
  total: number | null;
  /** The table being parsed, its inflated bytes so far and its size (0 if unknown). */
  table?: string;
  tableBytes?: number;
  tableSize?: number;
}

export interface Loaded {
  stream: StreamResult;
  summary: FeedSummary;
  columns: Record<string, string[]>;
  mirror: Record<string, IdRow[]>;
  stopTimesMode: FeedStore['stopTimesMode'];
}

/** A mirrored row that changed: `row` is null when it was deleted. */
export interface MirrorChange {
  table: string;
  id: number;
  row: Row | null;
}

let store: FeedStore | null = null;
let streamResult: StreamResult | null = null;
let mirrored = new Set<string>();

function requireStore(): FeedStore {
  if (!store) {
    throw new Error('[StoreWorker] no feed loaded');
  }
  return store;
}

const api = {
  counts: () => requireStore().counts(),
  columns: (table: string) => requireStore().columns(table),
  rows: (table: string, offset?: number, limit?: number) =>
    requireStore().rows(table, offset, limit),
  row: (table: string, id: number) => requireStore().row(table, id),
  find: (table: string, col: string, value: string) =>
    requireStore().find(table, col, value),
  stopTimesForTrip: (tripId: string) => requireStore().stopTimesForTrip(tripId),
  tripStops: (tripId: string) => requireStore().tripStops(tripId),
  tripsAtStop: (stopId: string) => requireStore().tripsAtStop(stopId),
  tripsWithStopTimes: () => requireStore().tripsWithStopTimes(),
  shapeIds: () => requireStore().shapeIds(),
  shapeRows: (shapeId: string) => requireStore().shapeRows(shapeId),
  shapeCoords: (shapeId: string) => requireStore().shapeCoords(shapeId),
  summary: () => feedSummary(requireStore()),
  routeGeometries: () => routeGeometries(requireStore()),
  tripsInfo: (tripIds: string[]) => tripsInfo(requireStore(), tripIds),
  routeTrips: (routeId: string) => routeTrips(requireStore(), routeId),
  allStopTimes: () => allStopTimes(requireStore()),
  allShapes: () => allShapes(requireStore()),
  stats: () => requireStore().stats(),
  ensureTable: (table: string, cols: string[]) =>
    requireStore().ensureTable(table, cols),
  insertRow: (table: string, row: Row) => {
    const id = requireStore().insertRow(table, row);
    return { value: id, change: mirrorChange(table, id) };
  },
  updateRow: (table: string, id: number, row: Row) => {
    requireStore().updateRow(table, id, row);
    return { value: undefined, change: mirrorChange(table, id) };
  },
  deleteRow: (table: string, id: number) => {
    requireStore().deleteRow(table, id);
    return { value: undefined, change: mirrorChange(table, id) };
  },
  setTripStopTimes: (tripId: string, rows: Row[]) =>
    requireStore().setTripStopTimes(tripId, rows),
  setShape: (shapeId: string, rows: Row[]) =>
    requireStore().setShape(shapeId, rows),
  hasEdits: () => requireStore().hasEdits(),
  /** Write the unedited base to a new OPFS file. Resolves to its size. */
  saveBase: (name: string) => saveBaseFile(requireStore(), streamResult!, name),
};

export type StoreApi = typeof api;

function mirrorChange(table: string, id: number): MirrorChange | null {
  return mirrored.has(table)
    ? { table, id, row: requireStore().row(table, id) }
    : null;
}

export type WorkerRequest =
  | { type: 'load'; input: StoreInput; options: LoadOptions }
  | { type: 'call'; id: number; method: keyof StoreApi; args: unknown[] };

export type WorkerReply =
  | { type: 'progress'; progress: LoadProgress }
  | { type: 'loaded'; loaded: Loaded }
  | { type: 'load-error'; message: string; cancelled: boolean }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'call-error'; id: number; message: string };

const post = (msg: WorkerReply, transfer: Transferable[] = []): void =>
  (self as unknown as Worker).postMessage(msg, transfer);

const PROGRESS_INTERVAL_MS = 100;

async function openSource(input: { url: string } | { file: File }): Promise<{
  stream: ReadableStream<Uint8Array>;
  total: number | null;
  innerPaths: string[];
}> {
  if ('file' in input) {
    return {
      stream: input.file.stream(),
      total: input.file.size,
      innerPaths: [],
    };
  }
  const { url, innerPaths } = splitInnerZipPath(input.url);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(describeNetworkError(url, err), { cause: err });
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(describeHttpError(url, res.status, res.statusText, body));
  }
  const len = res.headers.get('Content-Length');
  return { stream: res.body, total: len ? Number(len) : null, innerPaths };
}

async function load(input: StoreInput, options: LoadOptions): Promise<void> {
  if (store) {
    throw new Error('[StoreWorker] a feed is already loaded; use a new worker');
  }
  const t0 = performance.now();
  let s: FeedStore;
  let result: StreamResult;
  if ('base' in input) {
    post({
      type: 'progress',
      progress: { stage: 'restore', bytes: 0, total: null },
    });
    ({ store: s, stream: result } = await loadBaseFile(input.base));
  } else {
    s = new FeedStore(options);
    result = await parseInto(s, input, options);
    console.log(
      `[StoreWorker] parsed in ${Math.round(performance.now() - t0)}ms`
    );
    post({
      type: 'progress',
      progress: { stage: 'index', bytes: 0, total: null },
    });
    s.finish();
  }
  store = s;
  streamResult = result;
  mirrored = new Set(options.mirror ?? []);
  const mirror: Record<string, IdRow[]> = {};
  const columns: Record<string, string[]> = {};
  for (const table of s.tableNames()) {
    columns[table] = s.columns(table);
    if (mirrored.has(table)) {
      mirror[table] = s.rows(table);
    }
  }
  const summary = feedSummary(s);
  console.log(
    `[StoreWorker] ready in ${Math.round(performance.now() - t0)}ms`,
    s.stats()
  );
  post({
    type: 'loaded',
    loaded: {
      stream: result,
      summary,
      columns,
      mirror,
      stopTimesMode: s.stopTimesMode,
    },
  });
}

/** Stream a zip into `s`, posting read progress. */
async function parseInto(
  s: FeedStore,
  input: { url: string } | { file: File },
  options: LoadOptions
): Promise<StreamResult> {
  const { stream, total, innerPaths } = await openSource(input);
  console.log(
    `[StoreWorker] reading ${'file' in input ? input.file.name : input.url}`
  );

  const progress: LoadProgress = { stage: 'read', bytes: 0, total };
  let last = 0;
  const emit = (force = false): void => {
    const now = performance.now();
    if (force || now - last >= PROGRESS_INTERVAL_MS) {
      last = now;
      post({ type: 'progress', progress: { ...progress } });
    }
  };
  emit(true);
  const result = await streamGtfsZip(stream, s.sinkFor, {
    innerPaths,
    trim: options.trim,
    onBytes: (bytes) => {
      progress.bytes = bytes;
      emit();
    },
    onTableBytes: (table, read, size) => {
      progress.table = table;
      progress.tableBytes = read;
      progress.tableSize = size;
      emit();
    },
  });
  return result;
}

/**
 * ArrayBuffers inside a result, so they move instead of being copied. Every
 * API result is freshly built, so nothing the store still uses is detached.
 */
function transferables(
  value: unknown,
  depth = 0,
  out: Transferable[] = []
): Transferable[] {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer && !out.includes(value.buffer)) {
      out.push(value.buffer);
    }
  } else if (depth < 3 && Array.isArray(value)) {
    for (const v of value) {
      transferables(v, depth + 1, out);
    }
  } else if (depth < 3 && value && typeof value === 'object') {
    for (const v of Object.values(value)) {
      transferables(v, depth + 1, out);
    }
  }
  return out;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'load') {
    try {
      await load(msg.input, msg.options);
    } catch (err) {
      console.error('[StoreWorker] load failed', err);
      post({
        type: 'load-error',
        message: err instanceof Error ? err.message : String(err),
        cancelled: err instanceof Error && err.name === 'LoadCancelledError',
      });
    }
    return;
  }
  try {
    const fn = api[msg.method] as (...a: unknown[]) => unknown;
    if (!fn) {
      throw new Error(`[StoreWorker] unknown method ${String(msg.method)}`);
    }
    const value = await fn(...msg.args);
    post({ type: 'result', id: msg.id, value }, transferables(value));
  } catch (err) {
    console.error(`[StoreWorker] ${String(msg.method)} failed`, err);
    post({
      type: 'call-error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
