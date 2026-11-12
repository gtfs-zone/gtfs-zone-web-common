/**
 * Main-thread handle on a feed held by a store worker.
 *
 * One client per loaded feed. `load` spawns the worker; `release` terminates
 * it, which is what frees the feed. A caller replacing a feed releases the
 * old client before loading the new one, so two feeds are never in memory
 * together.
 *
 * Mirrored tables are kept here as plain rows for synchronous reads; edits
 * made through `call` update them and fire `mirrorchange`.
 */

import { LoadCancelledError } from '../feed-download';
import type { IdRow, Row } from './feed-store';
import type {
  LoadOptions,
  LoadProgress,
  Loaded,
  MirrorChange,
  StoreApi,
  StoreInput,
  WorkerReply,
  WorkerRequest,
} from './store.worker';

export type {
  LoadOptions,
  LoadProgress,
  StoreInput,
  MirrorChange,
} from './store.worker';
export type {
  FeedSummary,
  RouteGeometry,
  RouteTrips,
  TripsInfo,
} from './feed-queries';
export type { IdRow, Row, TripStop, StopTimesMode } from './feed-store';

/** Edits whose worker result is `{ value, change }`. */
const MIRROR_EDITS = new Set<keyof StoreApi>([
  'insertRow',
  'updateRow',
  'deleteRow',
]);

type Unwrap<T> = T extends { value: infer V; change: unknown } ? V : T;
type Result<K extends keyof StoreApi> = Unwrap<
  Awaited<ReturnType<StoreApi[K]>>
>;

export interface LoadHooks {
  onProgress?: (p: LoadProgress) => void;
  /** Aborting terminates the worker: download and parse both stop. */
  signal?: AbortSignal;
}

export class FeedStoreClient extends EventTarget {
  /** Mirrored tables by name, rows by id. */
  readonly mirror = new Map<string, Map<number, Row>>();
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      method: string;
    }
  >();
  private nextId = 1;
  private released = false;

  private constructor(
    private worker: Worker,
    readonly loaded: Loaded
  ) {
    super();
    for (const [table, rows] of Object.entries(loaded.mirror)) {
      this.mirror.set(table, new Map(rows.map((r: IdRow) => [r.id, r.row])));
    }
    // The mirror now owns the rows; drop the duplicate reference.
    loaded.mirror = {};
    worker.onmessage = (e: MessageEvent<WorkerReply>) => this.onReply(e.data);
    worker.onerror = (e) =>
      this.failAll(new Error(`[StoreClient] worker error: ${e.message}`));
  }

  static load(
    input: StoreInput,
    options: LoadOptions = {},
    hooks: LoadHooks = {}
  ): Promise<FeedStoreClient> {
    const worker = new Worker(new URL('./store.worker.ts', import.meta.url), {
      type: 'module',
    });
    console.log('[StoreClient] load started');
    return new Promise<FeedStoreClient>((resolve, reject) => {
      const onAbort = (): void => {
        worker.terminate();
        console.log('[StoreClient] load cancelled; worker terminated');
        reject(new LoadCancelledError());
      };
      if (hooks.signal?.aborted) {
        onAbort();
        return;
      }
      hooks.signal?.addEventListener('abort', onAbort, { once: true });
      const settle = (): void =>
        hooks.signal?.removeEventListener('abort', onAbort);

      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          hooks.onProgress?.(msg.progress);
        } else if (msg.type === 'loaded') {
          settle();
          console.log('[StoreClient] load finished', msg.loaded.stream.rows);
          resolve(new FeedStoreClient(worker, msg.loaded));
        } else if (msg.type === 'load-error') {
          settle();
          worker.terminate();
          reject(
            msg.cancelled ? new LoadCancelledError() : new Error(msg.message)
          );
        }
      };
      worker.onerror = (e) => {
        settle();
        worker.terminate();
        // A worker that fails to start or is killed for memory reports no
        // message; say what is known.
        reject(
          new Error(
            `The feed could not be loaded: ${e.message || 'the loader stopped without an error (it failed to start, or ran out of memory)'}`
          )
        );
      };
      const req: WorkerRequest = { type: 'load', input, options };
      worker.postMessage(req);
    });
  }

  /** Run a store method in the worker. */
  call<K extends keyof StoreApi>(
    method: K,
    ...args: Parameters<StoreApi[K]>
  ): Promise<Result<K>> {
    if (this.released) {
      return Promise.reject(new Error(`[StoreClient] ${method} after release`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        method,
      });
      const req: WorkerRequest = { type: 'call', id, method, args };
      this.worker.postMessage(req);
    });
  }

  /** Terminate the worker and drop the feed. Pending calls reject. */
  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.worker.terminate();
    this.mirror.clear();
    this.failAll(new Error('[StoreClient] released'));
    console.log('[StoreClient] released');
  }

  private onReply(msg: WorkerReply): void {
    if (msg.type !== 'result' && msg.type !== 'call-error') {
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) {
      return;
    }
    this.pending.delete(msg.id);
    if (msg.type === 'call-error') {
      p.reject(new Error(msg.message));
      return;
    }
    if (MIRROR_EDITS.has(p.method as keyof StoreApi)) {
      const { value, change } = msg.value as {
        value: unknown;
        change: MirrorChange | null;
      };
      if (change) {
        this.applyMirror(change);
      }
      p.resolve(value);
      return;
    }
    p.resolve(msg.value);
  }

  private applyMirror(change: MirrorChange): void {
    const rows = this.mirror.get(change.table);
    if (!rows) {
      return;
    }
    if (change.row) {
      rows.set(change.id, change.row);
    } else {
      rows.delete(change.id);
    }
    this.dispatchEvent(
      new CustomEvent<MirrorChange>('mirrorchange', { detail: change })
    );
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) {
      p.reject(err);
    }
    this.pending.clear();
  }
}
