/**
 * The core of a worker that owns one loaded feed.
 *
 * It streams a zip (or restores a saved base) into a `FeedStore`, posts the
 * mirrored tables and the summary, then serves reads and edits by RPC until
 * the client terminates it. Terminating is the release: it is the only thing
 * that hands the whole heap back.
 *
 * `serveStore` runs the message loop. An app worker passes extra methods,
 * which see the store through a `StoreContext`. Every row change a call
 * makes to a mirrored table is sent back with its reply, so the main-thread
 * mirror stays in step whatever method made the change.
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
  /**
   * Tables sent whole to the main thread for synchronous reads: a list, or
   * every table but `except` (tables created later included).
   */
  mirror?: string[] | { except: string[] };
  /** Keep non-`.txt` entries' contents (`fileNames`, `file`, saved bases). */
  keepFiles?: boolean;
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
  /** The response's validators for a URL load; null otherwise. */
  source: SourceValidators | null;
}

/** HTTP validators of a downloaded feed, as the server sent them. */
export interface SourceValidators {
  lastModified: string | null;
  etag: string | null;
}

/** A mirrored row that changed: `row` is null when it was deleted. */
export interface MirrorChange {
  table: string;
  id: number;
  row: Row | null;
}

/** What a call's reply carries for the mirror besides its value. */
export interface MirrorUpdate {
  changes: MirrorChange[];
  /** Whole mirrored tables, when the store was replaced (row ids changed). */
  reset: Record<string, IdRow[]> | null;
}

let store: FeedStore | null = null;
let streamResult: StreamResult | null = null;
let isMirrored: (table: string) => boolean = () => false;
/** Mirrored rows touched by the current call, as `table` -> ids. */
let touched = new Map<string, Set<number>>();
let resetPending = false;

function requireStore(): FeedStore {
  if (!store) {
    throw new Error('[StoreWorker] no feed loaded');
  }
  return store;
}

function install(s: FeedStore, result: StreamResult): void {
  if (store) {
    store.onRowChange = null;
  }
  store = s;
  streamResult = result;
  s.onRowChange = (table, id) => {
    if (isMirrored(table)) {
      let ids = touched.get(table);
      if (!ids) {
        ids = new Set();
        touched.set(table, ids);
      }
      ids.add(id);
    }
  };
}

function mirrorRows(s: FeedStore): Record<string, IdRow[]> {
  const out: Record<string, IdRow[]> = {};
  for (const table of s.tableNames()) {
    if (isMirrored(table)) {
      out[table] = s.rows(table);
    }
  }
  return out;
}

/** The store as an app worker's extra methods see it. */
export interface StoreContext {
  store(): FeedStore;
  /** The parse result of the feed (kept across restores and folds). */
  stream(): StreamResult;
  /**
   * Swap in a new store (e.g. a fold). Mirrors are resent whole with the
   * current call's reply, since row ids change.
   */
  replaceStore(s: FeedStore): void;
}

const context: StoreContext = {
  store: requireStore,
  stream: () => {
    if (!streamResult) {
      throw new Error('[StoreWorker] no feed loaded');
    }
    return streamResult;
  },
  replaceStore: (s) => {
    install(s, streamResult!);
    resetPending = true;
    console.log('[StoreWorker] store replaced');
  },
};

const baseApi = {
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
  findKey: (table: string, cols: string[], values: string[]) =>
    requireStore().findKey(table, cols, values),
  insertRow: (table: string, row: Row) => requireStore().insertRow(table, row),
  updateRow: (table: string, id: number, row: Row) =>
    requireStore().updateRow(table, id, row),
  deleteRow: (table: string, id: number) => requireStore().deleteRow(table, id),
  setTripStopTimes: (tripId: string, rows: Row[]) =>
    requireStore().setTripStopTimes(tripId, rows),
  setShape: (shapeId: string, rows: Row[]) =>
    requireStore().setShape(shapeId, rows),
  hasEdits: () => requireStore().hasEdits(),
  fileNames: () => requireStore().fileNames(),
  /** A copy of a non-table entry's contents (transferred), or null. */
  file: (name: string) => requireStore().file(name)?.slice() ?? null,
  setFile: (name: string, bytes: Uint8Array | null) =>
    requireStore().setFile(name, bytes),
  /** Write the unedited base to a new OPFS file. Resolves to its size. */
  saveBase: (name: string) => saveBaseFile(requireStore(), streamResult!, name),
};

export type StoreApi = typeof baseApi;

/** Methods an app worker adds; they must not reuse a base method's name. */
type ApiMethods = Record<string, (...args: never[]) => unknown>;

/** Collect the mirror changes of the call that just ran, and clear them. */
function takeMirrorUpdate(): MirrorUpdate | null {
  if (resetPending) {
    resetPending = false;
    touched = new Map();
    return { changes: [], reset: mirrorRows(requireStore()) };
  }
  if (touched.size === 0) {
    return null;
  }
  const s = requireStore();
  const changes: MirrorChange[] = [];
  for (const [table, ids] of touched) {
    for (const id of ids) {
      changes.push({ table, id, row: s.row(table, id) });
    }
  }
  touched = new Map();
  return { changes, reset: null };
}

export type WorkerRequest =
  | { type: 'load'; input: StoreInput; options: LoadOptions }
  | { type: 'call'; id: number; method: string; args: unknown[] };

export type WorkerReply =
  | { type: 'progress'; progress: LoadProgress }
  | { type: 'loaded'; loaded: Loaded }
  | { type: 'load-error'; message: string; cancelled: boolean }
  | {
      type: 'result';
      id: number;
      value: unknown;
      mirror: MirrorUpdate | null;
    }
  | {
      type: 'call-error';
      id: number;
      message: string;
      mirror: MirrorUpdate | null;
    };

const post = (msg: WorkerReply, transfer: Transferable[] = []): void =>
  (self as unknown as Worker).postMessage(msg, transfer);

const PROGRESS_INTERVAL_MS = 100;

async function openSource(input: { url: string } | { file: File }): Promise<{
  stream: ReadableStream<Uint8Array>;
  total: number | null;
  innerPaths: string[];
  validators: SourceValidators | null;
}> {
  if ('file' in input) {
    return {
      stream: input.file.stream(),
      total: input.file.size,
      innerPaths: [],
      validators: null,
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
  return {
    stream: res.body,
    total: len ? Number(len) : null,
    innerPaths,
    validators: {
      lastModified: res.headers.get('Last-Modified'),
      etag: res.headers.get('ETag'),
    },
  };
}

async function load(input: StoreInput, options: LoadOptions): Promise<void> {
  if (store) {
    throw new Error('[StoreWorker] a feed is already loaded; use a new worker');
  }
  const t0 = performance.now();
  let s: FeedStore;
  let result: StreamResult;
  let source: SourceValidators | null = null;
  if ('base' in input) {
    post({
      type: 'progress',
      progress: { stage: 'restore', bytes: 0, total: null },
    });
    ({ store: s, stream: result } = await loadBaseFile(input.base));
  } else {
    s = new FeedStore(options);
    ({ result, source } = await parseInto(s, input, options));
    console.log(
      `[StoreWorker] parsed in ${Math.round(performance.now() - t0)}ms`
    );
    post({
      type: 'progress',
      progress: { stage: 'index', bytes: 0, total: null },
    });
    s.finish();
  }
  const m = options.mirror ?? [];
  if (Array.isArray(m)) {
    const set = new Set(m);
    isMirrored = (t) => set.has(t);
  } else {
    // stop_times and shapes have no row ids, so they are never mirrored.
    const except = new Set([...m.except, 'stop_times', 'shapes']);
    isMirrored = (t) => !except.has(t);
  }
  install(s, result);
  const mirror = mirrorRows(s);
  const columns: Record<string, string[]> = {};
  for (const table of s.tableNames()) {
    columns[table] = s.columns(table);
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
      source,
    },
  });
}

/** Stream a zip into `s`, posting read progress. */
async function parseInto(
  s: FeedStore,
  input: { url: string } | { file: File },
  options: LoadOptions
): Promise<{ result: StreamResult; source: SourceValidators | null }> {
  const { stream, total, innerPaths, validators } = await openSource(input);
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
    onOtherFile: options.keepFiles ? s.addFile : undefined,
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
  return { result, source: validators };
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

/**
 * Run the worker's message loop. `extend` adds app methods next to the base
 * API; call it once, at the top level of the worker module.
 */
export function serveStore<E extends ApiMethods>(
  extend: (ctx: StoreContext) => E
): void {
  const extra = extend(context);
  for (const name of Object.keys(extra)) {
    if (name in baseApi) {
      throw new Error(`[StoreWorker] ${name} is already a store method`);
    }
  }
  const api = { ...baseApi, ...extra } as unknown as Record<
    string,
    (...a: unknown[]) => unknown
  >;

  // Calls run one at a time, in arrival order: an async method (an
  // IndexedDB write, a save) must not interleave with another call's store
  // changes, or their mirror updates would mix.
  let queue: Promise<void> = Promise.resolve();

  const runCall = async (
    msg: Extract<WorkerRequest, { type: 'call' }>
  ): Promise<void> => {
    try {
      const fn = api[msg.method];
      if (!fn) {
        throw new Error(`[StoreWorker] unknown method ${msg.method}`);
      }
      const value = await fn(...msg.args);
      post(
        { type: 'result', id: msg.id, value, mirror: takeMirrorUpdate() },
        transferables(value)
      );
    } catch (err) {
      console.error(`[StoreWorker] ${msg.method} failed`, err);
      // Changes made before the failure are real; the mirror still needs them.
      post({
        type: 'call-error',
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
        mirror: takeMirrorUpdate(),
      });
    }
  };

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
    queue = queue.then(() => runCall(msg));
  };
}
