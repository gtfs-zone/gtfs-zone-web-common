/**
 * Main-thread handle on a feed held by a store worker.
 *
 * One client per loaded feed. `load` spawns the worker; `release` terminates
 * it, which is what frees the feed. A caller replacing a feed releases the
 * old client before loading the new one, so two feeds are never in memory
 * together.
 *
 * Mirrored tables are kept here as plain rows for synchronous reads. Every
 * reply carries the mirror changes its call made, which are applied before
 * the call resolves and announced as `mirrorchange` (one row) or
 * `mirrorreset` (whole tables, after the store was replaced).
 *
 * An app worker built on `serveStore` passes its own factory and API type:
 * `FeedStoreClient.load<EditorApi>(input, options, hooks, () => new Worker(...))`.
 */

import { LoadCancelledError } from '../feed-download';
import type { IdRow, Row } from './feed-store';
import type {
  LoadOptions,
  LoadProgress,
  Loaded,
  MirrorChange,
  MirrorUpdate,
  StoreApi,
  StoreInput,
  WorkerReply,
  WorkerRequest,
} from './store-worker-core';

export type {
  LoadOptions,
  LoadProgress,
  StoreInput,
  MirrorChange,
  StoreApi,
  SourceValidators,
} from './store-worker-core';
export type {
  FeedSummary,
  RouteGeometry,
  RouteTrips,
  TripsInfo,
} from './feed-queries';
export type { IdRow, Row, TripStop, StopTimesMode } from './feed-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => unknown;
type Api = Record<string, AnyFn>;

export interface LoadHooks {
  onProgress?: (p: LoadProgress) => void;
  /** Aborting terminates the worker: download and parse both stop. */
  signal?: AbortSignal;
}

export class FeedStoreClient<A extends Api = StoreApi> extends EventTarget {
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

  static load<A extends Api = StoreApi>(
    input: StoreInput,
    options: LoadOptions = {},
    hooks: LoadHooks = {},
    createWorker: () => Worker = () =>
      new Worker(new URL('./store.worker.ts', import.meta.url), {
        type: 'module',
      })
  ): Promise<FeedStoreClient<A & StoreApi>> {
    const worker = createWorker();
    console.log('[StoreClient] load started');
    return new Promise<FeedStoreClient<A & StoreApi>>((resolve, reject) => {
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
          resolve(new FeedStoreClient<A & StoreApi>(worker, msg.loaded));
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
  call<K extends keyof A & string>(
    method: K,
    ...args: Parameters<A[K]>
  ): Promise<Awaited<ReturnType<A[K]>>> {
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
    if (msg.mirror) {
      this.applyMirror(msg.mirror);
    }
    if (msg.type === 'call-error') {
      p.reject(new Error(msg.message));
      return;
    }
    p.resolve(msg.value);
  }

  private applyMirror(update: MirrorUpdate): void {
    if (update.reset) {
      this.mirror.clear();
      for (const [table, rows] of Object.entries(update.reset)) {
        this.mirror.set(table, new Map(rows.map((r) => [r.id, r.row])));
      }
      console.log('[StoreClient] mirror reset');
      this.dispatchEvent(new Event('mirrorreset'));
    }
    for (const change of update.changes) {
      // The worker sends changes for mirrored tables only, including tables
      // created after the load.
      let rows = this.mirror.get(change.table);
      if (!rows) {
        rows = new Map();
        this.mirror.set(change.table, rows);
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
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) {
      p.reject(err);
    }
    this.pending.clear();
  }
}
