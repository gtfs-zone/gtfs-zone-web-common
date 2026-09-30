/**
 * geometry-car's feed catalog: one entry per logical feed, from `search.json`.
 *
 * `search.json` is `feeds.json` cut down, with short keys, to what a picker
 * lists and searches. Both are listed in `manifest.json` with their hash, and
 * the file is fetched with that hash in the query string so a browser cache
 * never serves yesterday's catalog. A manifest without `search.json` (a
 * pipeline that has not published it yet) falls back to `feeds.json`.
 *
 * The labels here are the words every app uses for a feed's state and its
 * roles, so a feed reads the same in the list, the editor and the viewer.
 */

import { moduleState } from '../util/module-state';
import { DATA_ORIGIN } from './data-origin';

/** geometry-car's last check of one role: whether any of its URLs answered. */
export type RoleState = 'up' | 'down' | 'unknown';

/**
 * The feed as a whole, led by its schedule: partial is a schedule that
 * answers with a realtime role that does not.
 */
export type FeedState = 'up' | 'partial' | 'down' | 'unknown';

/** `realtime` is an endpoint whose entity types its catalog does not declare. */
export type Role =
  'scheduled' | 'vehicles' | 'trip_updates' | 'alerts' | 'realtime';

export const RT_ROLES: readonly Role[] = [
  'vehicles',
  'trip_updates',
  'alerts',
  'realtime',
];

export const FEED_STATE_LABELS: Record<FeedState, string> = {
  up: 'Up',
  partial: 'Partial',
  down: 'Down',
  unknown: 'Inaccessible',
};

export const ROLE_LABELS: Record<Role, string> = {
  scheduled: 'Schedule',
  vehicles: 'Vehicle positions',
  trip_updates: 'Trip updates',
  alerts: 'Service alerts',
  realtime: 'Realtime (type not declared)',
};

/** Chip text for a role. */
export const ROLE_SHORT: Record<Role, string> = {
  scheduled: 'GTFS',
  vehicles: 'VP',
  trip_updates: 'TU',
  alerts: 'SA',
  realtime: 'RT',
};

export interface CatalogFeed {
  feedId: string;
  name: string;
  /** What tells the feed apart from others of its name, e.g. "Rail". */
  subtitle?: string;
  /** Every other name the feed goes by: rows', operators', agencies'. */
  altNames: string[];
  /** Municipality, subdivision, country; whichever are known. */
  place: string[];
  countryCode?: string;
  lat?: number;
  lon?: number;
  state: FeedState;
  roleState: Partial<Record<Role, RoleState>>;
  /** Role to URLs, best first: the first is the one to load. */
  urls: Partial<Record<Role, string[]>>;
  /** Roles whose every URL needs an API key we do not hold. */
  auth?: Role[];
  staticBytes?: number;
  /** The schedule's Last-Modified date, YYYY-MM-DD. */
  lastModified?: string;
  /** The date the feed's state was reached, YYYY-MM-DD. */
  since?: string;
}

/** One search.json entry, as published. */
interface SearchEntry {
  i: string;
  n: string;
  s?: string;
  a?: string[];
  p?: string[];
  cc?: string;
  ll?: [number, number];
  st: FeedState;
  rs: Partial<Record<Role, RoleState>>;
  u: Partial<Record<Role, string[]>>;
  au?: Role[];
  b?: number;
  m?: string;
  since?: string;
}

/** One feeds.json entry: only the fields read by the fallback. */
interface FeedsEntry {
  feedId: string;
  name: string;
  subtitle?: string;
  state: FeedState;
  roleState: Partial<Record<Role, RoleState>>;
  urls: Partial<Record<Role, string[]>>;
  auth?: Role[];
  staticBytes?: number;
  lastModified?: string;
  since?: string;
  municipality?: string;
  subdivision?: string;
  country?: string;
  country_code?: string;
  lat?: number;
  lon?: number;
}

function fromSearchEntry(e: SearchEntry): CatalogFeed {
  return {
    feedId: e.i,
    name: e.n,
    subtitle: e.s,
    altNames: e.a ?? [],
    place: e.p ?? [],
    countryCode: e.cc,
    lat: e.ll?.[0],
    lon: e.ll?.[1],
    state: e.st,
    roleState: e.rs,
    urls: e.u,
    auth: e.au,
    staticBytes: e.b,
    lastModified: e.m,
    since: e.since,
  };
}

function fromFeedsEntry(e: FeedsEntry): CatalogFeed {
  return {
    feedId: e.feedId,
    name: e.name,
    subtitle: e.subtitle,
    altNames: [],
    place: [e.municipality, e.subdivision, e.country ?? e.country_code].filter(
      (part): part is string => Boolean(part)
    ),
    countryCode: e.country_code,
    lat: e.lat,
    lon: e.lon,
    state: e.state,
    roleState: e.roleState,
    urls: e.urls,
    auth: e.auth,
    staticBytes: e.staticBytes,
    lastModified: e.lastModified?.slice(0, 10),
    since: e.since?.slice(0, 10),
  };
}

/** Parse a fetched search.json body. */
export function parseSearchDocument(doc: unknown): CatalogFeed[] {
  const feeds = (doc as { feeds?: SearchEntry[] }).feeds ?? [];
  return feeds.map(fromSearchEntry);
}

interface Manifest {
  artifacts: Record<string, { sha256: string; bytes: number } | undefined>;
}

const shared = moduleState('gtfs/feed-catalog', () => ({
  cached: null as Promise<CatalogFeed[]> | null,
  loaded: null as CatalogFeed[] | null,
}));

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  }
  return res.json();
}

async function fetchCatalog(): Promise<CatalogFeed[]> {
  const manifest = (await fetchJson(`${DATA_ORIGIN}/manifest.json`, {
    cache: 'no-cache',
  })) as Manifest;
  const search = manifest.artifacts['search.json'];
  if (search) {
    const doc = await fetchJson(
      `${DATA_ORIGIN}/search.json?v=${search.sha256.slice(0, 16)}`
    );
    return parseSearchDocument(doc);
  }
  const feeds = manifest.artifacts['feeds.json'];
  const doc = (await fetchJson(
    `${DATA_ORIGIN}/feeds.json${feeds ? `?v=${feeds.sha256.slice(0, 16)}` : ''}`
  )) as { feeds?: FeedsEntry[] };
  return (doc.feeds ?? []).map(fromFeedsEntry);
}

/** The catalog, fetched once per session. Rejects when it cannot be fetched. */
export function loadFeedCatalog(): Promise<CatalogFeed[]> {
  shared.cached ??= fetchCatalog()
    .then((feeds) => {
      shared.loaded = feeds;
      return feeds;
    })
    .catch((err) => {
      // Not cached on failure, so the next caller retries rather than seeing
      // the catalog as unavailable for the rest of the session.
      shared.cached = null;
      throw err;
    });
  return shared.cached;
}

/**
 * The catalog feed whose URL for any role is `url`, from a catalog already
 * loaded this session. Null before it has loaded, or when none lists it.
 */
export function feedByUrl(url: string): CatalogFeed | null {
  return (
    shared.loaded?.find((feed) =>
      Object.values(feed.urls).some((urls) => urls?.includes(url))
    ) ?? null
  );
}

/** "Portland, Maine, United States": the feed's place, most specific first. */
export function placeLine(feed: CatalogFeed): string {
  return feed.place.join(', ');
}

/** The first URL to load for a role, unless only a key we lack opens it. */
export function usableUrl(feed: CatalogFeed, role: Role): string | undefined {
  return feed.auth?.includes(role) ? undefined : feed.urls[role]?.[0];
}

/**
 * The three typed realtime slots a feed fills. An endpoint of undeclared type
 * takes the first empty slot, in the same order as geometry-car's viewer link.
 */
export function realtimeSlots(feed: CatalogFeed): {
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
} {
  const slots = {
    vehiclesUrl: usableUrl(feed, 'vehicles'),
    tripUpdatesUrl: usableUrl(feed, 'trip_updates'),
    alertsUrl: usableUrl(feed, 'alerts'),
  };
  const untyped = usableUrl(feed, 'realtime');
  if (untyped) {
    const empty = (
      ['vehiclesUrl', 'tripUpdatesUrl', 'alertsUrl'] as const
    ).find((key) => !slots[key]);
    if (empty) {
      slots[empty] = untyped;
    }
  }
  return slots;
}

/** The realtime roles a feed lists, in display order. */
export function realtimeRoles(feed: CatalogFeed): Role[] {
  return RT_ROLES.filter((role) => feed.urls[role]?.length);
}
