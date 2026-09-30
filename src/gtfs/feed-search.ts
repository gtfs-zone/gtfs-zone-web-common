/**
 * Text search over the feed catalog, shared by every picker so a query finds
 * the same feeds in the same order in the list, the editor and the viewer.
 */

import UFuzzy from '@leeoniya/ufuzzy';
import type { CatalogFeed } from './feed-catalog';

// Same tolerance as the map search box: one inserted character inside a term,
// terms themselves in any order.
const uf = new UFuzzy({ intraIns: 1 });

// Above this many matches uFuzzy skips its ranking pass; the matches then keep
// the order they were given in.
const RANK_THRESHOLD = 1000;

function host(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * Everything a query matches a feed against: its names, its place, and the
 * host of every URL, so "cadavl" finds a feed by where it is served from.
 */
export function feedHaystack(feed: CatalogFeed): string {
  const parts = new Set<string>();
  for (const value of [
    feed.name,
    feed.subtitle,
    ...feed.altNames,
    ...feed.place,
    feed.countryCode,
  ]) {
    if (value) {
      parts.add(value);
    }
  }
  for (const urls of Object.values(feed.urls)) {
    for (const url of urls ?? []) {
      const h = host(url);
      if (h) {
        parts.add(h);
      }
    }
  }
  return [...parts].join(' ');
}

/** Ranked matches over a fixed list of feeds, remembering the last query. */
export class FeedMatcher {
  private haystack: string[];
  private lastQuery: string | null = null;
  private lastMatch: number[] | null = null;

  constructor(feeds: readonly CatalogFeed[]) {
    this.haystack = feeds.map(feedHaystack);
  }

  /** Indexes into the feeds matching `query`, best first; null for no query. */
  match(query: string): number[] | null {
    const q = query.trim();
    if (!q) {
      return null;
    }
    if (q === this.lastQuery) {
      return this.lastMatch;
    }
    const [idxs, info, order] = uf.search(this.haystack, q, 1, RANK_THRESHOLD);
    const ranked = info && order ? order.map((o) => info.idx[o]) : (idxs ?? []);
    this.lastQuery = q;
    this.lastMatch = ranked;
    return ranked;
  }
}
