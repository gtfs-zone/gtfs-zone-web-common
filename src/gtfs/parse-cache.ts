/**
 * Parsed schedules kept in OPFS, so loading the same feed again restores it
 * instead of parsing the zip.
 *
 * Each entry is one base file, named by the entry id, plus a record in a
 * small localStorage index. A URL load hands the worker the entry for that
 * URL; the worker restores it when the response's ETag or Last-Modified still
 * match and parses otherwise. Picking an entry under "Your feeds" restores it
 * without asking the server. Uploads are parsed and never stored: there is
 * no URL to check them against.
 *
 * The storage rule for apps that do not edit: only the feed in use is kept,
 * so every load deletes the other entries.
 */

import {
  GTFSScheduled,
  type LoadHooks,
  type ScheduledOptions,
} from './scheduled';
import { LoadCancelledError } from './feed-download';
import { deleteBaseFile, sweepBaseFiles } from './store/opfs-base';
import type { StoredFeedOffer } from '../ui/load-modal';
import { isQuotaError } from '../util/storage';
import { t } from '../i18n/messages';

export interface CachedFeed {
  /** Also the base file's name. */
  id: string;
  /** The URL fetched, proxy included. */
  url: string;
  /** The schedule URL without the proxy, matched to the catalog. */
  sourceUrl: string;
  label: string;
  lastModified: string | null;
  etag: string | null;
  bytes: number;
  routes: number;
  stops: number;
  trips: number;
  savedAt: number;
  lastOpened: number;
  /** App data stored with the feed (JSON), e.g. its realtime half. */
  extra?: unknown;
}

/** What to load: a URL, an uploaded file, or a stored entry by id. */
export type CacheInput = { url: string } | { file: File } | { stored: string };

export interface CacheMeta {
  label: string;
  /** The schedule URL without the proxy; defaults to the fetched URL. */
  sourceUrl?: string;
  extra?: unknown;
}

export interface CachedLoad {
  feed: GTFSScheduled;
  /** The stored entry for this feed, or null when it is not stored. */
  entry: CachedFeed | null;
  /** Restored from a stored copy rather than parsed. */
  restored: boolean;
  /** Why the parsed feed could not be stored; the feed loaded anyway. */
  storeError: string | null;
}

const VERSION = 1;

function newBaseName(): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `cache-${Date.now().toString(36)}-${rand}.bin`;
}

/** An HTTP date as YYYY-MM-DD, or undefined. */
function isoDay(httpDate: string | null): string | undefined {
  if (!httpDate) {
    return undefined;
  }
  const ms = Date.parse(httpDate);
  if (Number.isNaN(ms)) {
    console.warn(`[ParseCache] unparseable Last-Modified: ${httpDate}`);
    return undefined;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

export class ParseCache {
  private readonly key: string;

  /** `app` names the localStorage key, so apps sharing an origin stay apart. */
  constructor(app: string) {
    this.key = `${app}:parse-cache`;
  }

  /** Every stored entry, most recently opened first. */
  list(): CachedFeed[] {
    let raw: string | null;
    try {
      raw = localStorage.getItem(this.key);
    } catch (err) {
      console.warn('[ParseCache] index unreadable', err);
      return [];
    }
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as { v?: number; feeds?: CachedFeed[] };
      if (parsed.v !== VERSION || !Array.isArray(parsed.feeds)) {
        console.warn('[ParseCache] index has another version; ignored');
        return [];
      }
      return [...parsed.feeds].sort((a, b) => b.lastOpened - a.lastOpened);
    } catch (err) {
      console.warn('[ParseCache] index is not valid JSON; ignored', err);
      return [];
    }
  }

  get(id: string): CachedFeed | undefined {
    return this.list().find((e) => e.id === id);
  }

  /** The entries as "Your feeds" rows; `activeId` is the one open now. */
  offers(activeId: string | null): StoredFeedOffer[] {
    return this.list().map((e) => ({
      id: e.id,
      name: e.label,
      routes: e.routes,
      stops: e.stops,
      trips: e.trips,
      bytes: e.bytes,
      lastOpened: e.lastOpened,
      active: e.id === activeId,
      sourceUrl: e.sourceUrl,
      sourceModified: isoDay(e.lastModified),
    }));
  }

  /** Delete an entry and its base file. */
  async delete(id: string): Promise<void> {
    await deleteBaseFile(id);
    this.write(this.list().filter((e) => e.id !== id));
    console.log(`[ParseCache] deleted ${id}`);
  }

  /**
   * Load a schedule through the cache. A stored entry that cannot be
   * restored is deleted and the error rethrown. A parsed URL feed is stored;
   * a failure to store it is returned as `storeError`, not thrown.
   */
  async load(
    input: CacheInput,
    meta: CacheMeta,
    options: ScheduledOptions = {},
    hooks: LoadHooks = {}
  ): Promise<CachedLoad> {
    if ('stored' in input) {
      return this.loadStored(input.stored, meta, options, hooks);
    }
    if ('file' in input) {
      const feed = await GTFSScheduled.load(input, options, hooks);
      await this.keepOnly(null);
      return { feed, entry: null, restored: false, storeError: null };
    }

    const known = this.list().find((e) => e.url === input.url);
    const feed = await GTFSScheduled.load(
      {
        url: input.url,
        reuse: known && {
          base: known.id,
          lastModified: known.lastModified,
          etag: known.etag,
        },
      },
      options,
      hooks
    );
    const { restored, source } = feed.store.loaded;
    if (restored && known) {
      console.log(`[ParseCache] ${input.url} unchanged; restored ${known.id}`);
      const entry = this.touch(known, meta);
      await this.keepOnly(entry.id);
      return { feed, entry, restored: true, storeError: null };
    }

    const id = newBaseName();
    try {
      const bytes = await feed.store.call('saveBase', id);
      const c = feed.counts();
      const now = Date.now();
      const entry: CachedFeed = {
        id,
        url: input.url,
        sourceUrl: meta.sourceUrl ?? input.url,
        label: meta.label,
        lastModified: source?.lastModified ?? null,
        etag: source?.etag ?? null,
        bytes,
        routes: c.routes,
        stops: c.stops,
        trips: c.trips,
        savedAt: now,
        lastOpened: now,
        extra: meta.extra,
      };
      this.write([entry, ...this.list().filter((e) => e.id !== id)]);
      console.log(`[ParseCache] stored ${input.url} as ${id} (${bytes} bytes)`);
      await this.keepOnly(id);
      return { feed, entry, restored: false, storeError: null };
    } catch (err) {
      console.error(`[ParseCache] storing ${input.url} failed`, err);
      // The previous feed is still dropped: it is no longer the one in use,
      // and its space may be what the next attempt needs.
      await this.keepOnly(null);
      const reason = isQuotaError(err)
        ? t('cache.quota')
        : err instanceof Error
          ? err.message
          : String(err);
      return {
        feed,
        entry: null,
        restored: false,
        storeError: t('cache.storeFailed', { reason }),
      };
    }
  }

  private async loadStored(
    id: string,
    meta: CacheMeta,
    options: ScheduledOptions,
    hooks: LoadHooks
  ): Promise<CachedLoad> {
    const known = this.get(id);
    if (!known) {
      throw new Error(t('cache.missing', { name: meta.label }));
    }
    let feed: GTFSScheduled;
    try {
      feed = await GTFSScheduled.load({ base: id }, options, hooks);
    } catch (err) {
      if (err instanceof LoadCancelledError) {
        throw err;
      }
      console.error(`[ParseCache] restoring ${id} failed; deleting it`, err);
      await this.delete(id).catch((e: unknown) =>
        console.warn(`[ParseCache] deleting ${id} failed`, e)
      );
      throw err;
    }
    console.log(`[ParseCache] restored ${id}`);
    const entry = this.touch(known, { ...meta, extra: known.extra });
    await this.keepOnly(id);
    return { feed, entry, restored: true, storeError: null };
  }

  /** Mark an entry opened now, with the label and extra of this load. */
  private touch(entry: CachedFeed, meta: CacheMeta): CachedFeed {
    const next: CachedFeed = {
      ...entry,
      label: meta.label,
      lastOpened: Date.now(),
      extra: meta.extra,
    };
    this.write(this.list().map((e) => (e.id === entry.id ? next : e)));
    return next;
  }

  /**
   * Delete every entry but `id`, then every base file no entry names.
   * Failures are logged: a file another tab is still reading is retried by
   * the next sweep.
   */
  private async keepOnly(id: string | null): Promise<void> {
    const entries = this.list();
    for (const e of entries) {
      if (e.id !== id) {
        await deleteBaseFile(e.id).catch((err: unknown) =>
          console.warn(`[ParseCache] deleting ${e.id} failed`, err)
        );
      }
    }
    const kept = entries.filter((e) => e.id === id);
    this.write(kept);
    try {
      const gone = await sweepBaseFiles(kept.map((e) => e.id));
      if (gone.length > 0) {
        console.log(`[ParseCache] swept ${gone.join(', ')}`);
      }
    } catch (err) {
      console.warn('[ParseCache] sweep failed', err);
    }
  }

  private write(feeds: CachedFeed[]): void {
    try {
      localStorage.setItem(this.key, JSON.stringify({ v: VERSION, feeds }));
    } catch (err) {
      // The base files are swept on the next load, so a lost index only
      // costs a parse.
      console.error('[ParseCache] index write failed', err);
    }
  }
}
