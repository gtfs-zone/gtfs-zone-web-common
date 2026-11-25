/**
 * Parsed schedules kept in OPFS, so loading the same feed again restores it
 * instead of parsing the zip.
 *
 * Each entry is one base file, named by the entry id, plus a record in a
 * small localStorage index. A URL load hands the worker the entry for that
 * URL; the worker restores it when the response's ETag or Last-Modified still
 * match and parses otherwise. An upload is matched by `uploadKey` (name,
 * size, modified time), so picking the same zip again restores it. Picking an
 * entry under "Your feeds" restores it without asking the server.
 *
 * The storage rule for apps that do not edit: only the feeds in use are kept,
 * so every load deletes the other entries. An app that parses in its own
 * worker (diff) saves the bases there with `saveBaseFile` and records them
 * here with `add` and `keepOnly`.
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
  kind: 'url' | 'upload';
  /** The URL fetched, proxy included; empty for an upload. */
  url: string;
  /** The schedule URL without the proxy, matched to the catalog; empty for an upload. */
  sourceUrl: string;
  /** The upload's `uploadKey`; empty for a URL. */
  uploadKey: string;
  /** The URL feed's name, or the uploaded file's name. */
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

const VERSION = 2;

/** A new, unused base file name. */
export function newBaseName(): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `cache-${Date.now().toString(36)}-${rand}.bin`;
}

/** Identifies an uploaded zip without reading it: name, size and modified time. */
export function uploadKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
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

/** Why a base could not be stored, for the user. */
function storeErrorText(err: unknown): string {
  const reason = isQuotaError(err)
    ? t('cache.quota')
    : err instanceof Error
      ? err.message
      : String(err);
  return t('cache.storeFailed', { reason });
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

  /** The entry stored for a URL, proxy included. */
  forUrl(url: string): CachedFeed | undefined {
    return this.list().find((e) => e.kind === 'url' && e.url === url);
  }

  /** The entry stored for an uploaded zip, matched by `uploadKey`. */
  forUpload(file: File): CachedFeed | undefined {
    const key = uploadKey(file);
    return this.list().find((e) => e.kind === 'upload' && e.uploadKey === key);
  }

  /** Record an entry whose base file is already written, replacing its id. */
  add(entry: CachedFeed): void {
    this.write([entry, ...this.list().filter((e) => e.id !== entry.id)]);
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
      sourceUrl: e.sourceUrl || undefined,
      sourceModified: isoDay(e.lastModified),
      uploaded: e.kind === 'upload',
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
   * restored is deleted and the error rethrown. A parsed feed is stored; a
   * failure to store it is returned as `storeError`, not thrown.
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
      return this.loadUpload(input.file, meta, options, hooks);
    }

    const known = this.forUrl(input.url);
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
      await this.keepOnly([entry.id]);
      return { feed, entry, restored: true, storeError: null };
    }
    return this.store(feed, {
      kind: 'url',
      url: input.url,
      sourceUrl: meta.sourceUrl ?? input.url,
      uploadKey: '',
      label: meta.label,
      lastModified: source?.lastModified ?? null,
      etag: source?.etag ?? null,
      extra: meta.extra,
    });
  }

  /** Restore an upload stored earlier, or parse and store it. */
  private async loadUpload(
    file: File,
    meta: CacheMeta,
    options: ScheduledOptions,
    hooks: LoadHooks
  ): Promise<CachedLoad> {
    const known = this.forUpload(file);
    if (known) {
      try {
        return await this.loadStored(known.id, meta, options, hooks);
      } catch (err) {
        if (err instanceof LoadCancelledError) {
          throw err;
        }
        console.warn(
          `[ParseCache] ${file.name}: stored copy unusable; parsing`
        );
      }
    }
    const feed = await GTFSScheduled.load({ file }, options, hooks);
    return this.store(feed, {
      kind: 'upload',
      url: '',
      sourceUrl: '',
      uploadKey: uploadKey(file),
      label: meta.label,
      lastModified: null,
      etag: null,
      extra: meta.extra,
    });
  }

  /** Save a parsed feed's base and make it the only entry kept. */
  private async store(
    feed: GTFSScheduled,
    fields: Pick<
      CachedFeed,
      | 'kind'
      | 'url'
      | 'sourceUrl'
      | 'uploadKey'
      | 'label'
      | 'lastModified'
      | 'etag'
      | 'extra'
    >
  ): Promise<CachedLoad> {
    const id = newBaseName();
    const what = fields.url || fields.label;
    try {
      const bytes = await feed.store.call('saveBase', id);
      const c = feed.counts();
      const now = Date.now();
      const entry: CachedFeed = {
        id,
        ...fields,
        bytes,
        routes: c.routes,
        stops: c.stops,
        trips: c.trips,
        savedAt: now,
        lastOpened: now,
      };
      this.add(entry);
      console.log(`[ParseCache] stored ${what} as ${id} (${bytes} bytes)`);
      await this.keepOnly([id]);
      return { feed, entry, restored: false, storeError: null };
    } catch (err) {
      console.error(`[ParseCache] storing ${what} failed`, err);
      // The previous feed is still dropped: it is no longer the one in use,
      // and its space may be what the next attempt needs.
      await this.keepOnly([]);
      return {
        feed,
        entry: null,
        restored: false,
        storeError: storeErrorText(err),
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
    await this.keepOnly([id]);
    return { feed, entry, restored: true, storeError: null };
  }

  /** Mark an entry opened now, with the label and extra of this load. */
  touch(entry: CachedFeed, meta: CacheMeta): CachedFeed {
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
   * Delete every entry not in `ids`, then every base file no kept entry
   * names. Failures are logged: a file another tab is still reading is
   * retried by the next sweep.
   */
  async keepOnly(ids: string[]): Promise<void> {
    const keep = new Set(ids);
    const entries = this.list();
    for (const e of entries) {
      if (!keep.has(e.id)) {
        await deleteBaseFile(e.id).catch((err: unknown) =>
          console.warn(`[ParseCache] deleting ${e.id} failed`, err)
        );
      }
    }
    const kept = entries.filter((e) => keep.has(e.id));
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
