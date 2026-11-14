/**
 * The map search box.
 *
 * Deliberately knows nothing about GTFS, the database, or page state: the app
 * supplies grouped entries through `getGroups()` and receives an opaque payload
 * back through `onSelect()`. That is what lets one implementation serve apps
 * whose data layer and `PageState` union differ.
 *
 * Each group is matched on its own and rendered as a section under its label,
 * capped at its `limit`, in the order the app returns them. Groups without a
 * match are hidden. `getGroups()` runs on every (debounced) query, so an app
 * with a large feed memoizes its groups; the haystacks of an `entries` array
 * are cached against that array, so a memoized group costs no rebuild here.
 *
 * An app may also supply `getRemoteEntries()`, a server-side search (places,
 * say). Its results come last under a "Places" heading, unfiltered, since the
 * server already matched them.
 */

import uFuzzy from '@leeoniya/ufuzzy';
import { t } from '../i18n/messages';

export interface SearchEntry<T> {
  /** Handed back to `onSelect` untouched, the app's own focus descriptor. */
  payload: T;
  /** Marker HTML, from the helpers below. */
  icon: string;
  primary: string;
  secondary?: string;
  /** Everything worth matching against, joined with spaces. */
  haystack: string;
  /** Lower sorts first within its group. Entries without one are treated as 0. */
  priority?: number;
}

/** One section of the results, matched and capped on its own. */
export interface SearchGroup<T> {
  /** Section heading. */
  label: string;
  /** Kept by identity: the same array reuses its cached haystacks. */
  entries: readonly SearchEntry<T>[];
  /** Most matches shown. Defaults to `groupLimit`. */
  limit?: number;
}

export interface SearchControllerOptions<T> {
  getGroups: () => SearchGroup<T>[] | Promise<SearchGroup<T>[]>;
  /** Server-side matches for the query. Aborted when a newer query starts. */
  getRemoteEntries?: (
    query: string,
    signal: AbortSignal
  ) => Promise<SearchEntry<T>[]>;
  onSelect: (payload: T) => void;
  /** Most matches per group without a `limit`. Defaults to 8. */
  groupLimit?: number;
  /** Most remote matches shown. Defaults to 5. */
  remoteLimit?: number;
  minQueryLength?: number;
  /** Shortest query sent to `getRemoteEntries`. Defaults to 3. */
  remoteMinQueryLength?: number;
}

type RemoteState = 'idle' | 'pending' | 'done' | 'error';

// `intraIns: 1` tolerates one inserted character inside a term; terms
// themselves are already allowed to be far apart, so "Charles MGH" finds
// "Charles/MGH" without any special casing.
const uf = new uFuzzy({ intraIns: 1 });

const DEBOUNCE_MS = 200;

// Haystack arrays per entries array, so a memoized group is not remapped on
// every keystroke.
const haystackCache = new WeakMap<readonly SearchEntry<unknown>[], string[]>();

function haystacksOf<T>(entries: readonly SearchEntry<T>[]): string[] {
  let haystacks = haystackCache.get(entries);
  if (!haystacks) {
    haystacks = entries.map((e) => e.haystack);
    haystackCache.set(entries, haystacks);
  }
  return haystacks;
}

/** The group's matches, by priority then match quality, capped at `limit`. */
function matchGroup<T>(
  entries: readonly SearchEntry<T>[],
  query: string,
  limit: number
): SearchEntry<T>[] {
  const [idxs, info, order] = uf.search(haystacksOf(entries), query);
  // `info.idx` maps an info slot back to its haystack index, and `order` is
  // those slots in rank order, so `info.idx[order[i]]` is the entry index.
  const ranked = info && order ? order.map((o) => info.idx[o]) : (idxs ?? []);
  // Stable sort: entries with equal priority keep uFuzzy's quality order.
  const matches = ranked.map((i) => entries[i]);
  matches.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  return matches.slice(0, limit);
}

interface MatchedGroup<T> {
  label: string;
  matches: SearchEntry<T>[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Markers ──────────────────────────────────────────────────────────────────
//
// These mirror how the map paints the same objects, see the `circle-color`
// expressions in `layer-manager.ts`, which is the source of truth for the
// palette. Change one, change the other. Every marker carries a hairline ring
// because feed colors (and the white station fill) routinely collide with the
// page background.

const RING = 'box-shadow:0 0 0 1px rgba(128,128,128,0.45)';

/** Stop circle, colored by `location_type` exactly as the map does. */
export function stopMarker(location_type?: string | number): string {
  const type = Number(location_type ?? 0);
  if (type === 1) {
    // Station: white circle with the black inner dot from `stops-station-dot`.
    return `<span class="inline-flex items-center justify-center shrink-0 rounded-full" style="width:11px;height:11px;background:#ffffff;${RING}"><span style="width:4px;height:4px;border-radius:9999px;background:#111111"></span></span>`;
  }
  const fill =
    type === 2
      ? '#f59e0b' // entrance
      : type === 3
        ? '#8b5cf6' // generic node
        : type === 4
          ? '#10b981' // boarding area
          : '#ffffff'; // plain stop / platform
  return dotMarker(fill);
}

/** A plain filled circle: plain stops, and realtime vehicles in route color. */
export function dotMarker(color: string): string {
  return `<span class="inline-block shrink-0 rounded-full" style="width:11px;height:11px;background:${esc(color)};${RING}"></span>`;
}

/** Route bar, in `route_color`, echoing the route line on the map. */
export function routeMarker(color?: string): string {
  const fill = color
    ? color.startsWith('#')
      ? color
      : `#${color}`
    : '#3b82f6';
  return `<span class="inline-block shrink-0 rounded-sm" style="width:14px;height:5px;background:${esc(fill)};${RING}"></span>`;
}

/** For objects with no map counterpart (agencies): a neutral outlined circle. */
export function neutralMarker(): string {
  return `<span class="inline-block shrink-0 rounded-full" style="width:11px;height:11px;background:transparent;${RING}"></span>`;
}

// ─── Controller ───────────────────────────────────────────────────────────────

export class SearchController<T> {
  private opts: SearchControllerOptions<T>;
  private input: HTMLInputElement | null = null;
  private dropdown: HTMLElement | null = null;
  /** Every selectable row, in the order rendered: groups, then remote. */
  private matches: SearchEntry<T>[] = [];
  private localGroups: MatchedGroup<T>[] = [];
  private remoteMatches: SearchEntry<T>[] = [];
  private remoteState: RemoteState = 'idle';
  private remoteAbort: AbortController | null = null;
  private activeIndex = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a slow `getGroups()` overwriting a newer query. */
  private requestId = 0;

  constructor(opts: SearchControllerOptions<T>) {
    this.opts = opts;
  }

  initialize(): void {
    const input = document.getElementById(
      'map-search'
    ) as HTMLInputElement | null;
    const card = document.getElementById('map-search-card');
    if (!input || !card) {
      console.warn('[Search] #map-search or #map-search-card missing');
      return;
    }

    this.input = input;
    this.dropdown = document.createElement('div');
    this.dropdown.id = 'search-results';
    this.dropdown.className =
      'hidden absolute top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-80 overflow-y-auto z-50';
    card.appendChild(this.dropdown);

    input.addEventListener('input', () => this.queueSearch());
    input.addEventListener('focus', () => this.queueSearch());
    input.addEventListener('keydown', (e) => this.onKeyDown(e));

    document.addEventListener('click', (e) => {
      if (!(e.target as Element | null)?.closest('#map-search-card')) {
        this.hide();
      }
    });
  }

  clearSearch(): void {
    if (this.input) {
      this.input.value = '';
    }
    this.hide();
  }

  private queueSearch(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.search(this.input?.value.trim() ?? '');
    }, DEBOUNCE_MS);
  }

  private async search(query: string): Promise<void> {
    this.remoteAbort?.abort();
    this.remoteAbort = null;
    const id = ++this.requestId;

    if (query.length < (this.opts.minQueryLength ?? 2)) {
      this.hide();
      return;
    }

    let groups: SearchGroup<T>[];
    try {
      groups = await this.opts.getGroups();
    } catch (error) {
      console.error('[Search] Failed to build entries:', error);
      this.renderMessage(t('search.failed'));
      return;
    }
    if (id !== this.requestId) {
      return; // a newer query is already in flight
    }

    const groupLimit = this.opts.groupLimit ?? 8;
    this.localGroups = groups
      .map((group) => ({
        label: group.label,
        matches: matchGroup(group.entries, query, group.limit ?? groupLimit),
      }))
      .filter((group) => group.matches.length > 0);
    this.remoteMatches = [];
    this.activeIndex = 0;

    const getRemote = this.opts.getRemoteEntries;
    if (!getRemote || query.length < (this.opts.remoteMinQueryLength ?? 3)) {
      this.remoteState = 'idle';
      this.render(query);
      return;
    }

    this.remoteState = 'pending';
    this.render(query);

    const abort = new AbortController();
    this.remoteAbort = abort;
    try {
      const remote = await getRemote(query, abort.signal);
      if (id !== this.requestId || abort.signal.aborted) {
        return;
      }
      this.remoteMatches = remote.slice(0, this.opts.remoteLimit ?? 5);
      this.remoteState = 'done';
    } catch (error) {
      if (id !== this.requestId || abort.signal.aborted) {
        return;
      }
      console.warn('[Search] Remote search failed:', error);
      this.remoteState = 'error';
    }
    this.remoteAbort = null;
    this.render(query);
  }

  private render(query: string): void {
    if (!this.dropdown) {
      return;
    }
    this.matches = [
      ...this.localGroups.flatMap((group) => group.matches),
      ...this.remoteMatches,
    ];
    if (this.matches.length === 0 && this.remoteState !== 'pending') {
      if (this.remoteState === 'error') {
        this.renderMessage(t('search.noFeedResults'));
      } else {
        this.renderMessage(t('search.noResults', { query: esc(query) }));
      }
      return;
    }

    this.dropdown.innerHTML = '';
    let index = 0;
    for (const group of this.localGroups) {
      this.appendHeading(group.label);
      for (const entry of group.matches) {
        this.appendRow(entry, index++);
      }
    }
    if (this.remoteState !== 'idle') {
      this.appendHeading(
        this.remoteState === 'pending'
          ? t('search.searchingPlaces')
          : this.remoteState === 'error'
            ? t('search.placesUnavailable')
            : t('search.places')
      );
      for (const entry of this.remoteMatches) {
        this.appendRow(entry, index++);
      }
    }

    this.show();
    this.setActive(
      Math.max(0, Math.min(this.activeIndex, this.matches.length - 1))
    );
  }

  /** A section heading. Carries no `data-index`, so it is not selectable. */
  private appendHeading(label: string): void {
    const heading = document.createElement('div');
    heading.className =
      'px-3 pt-2 pb-1 text-xs font-semibold opacity-60 border-b border-base-200';
    heading.textContent = label;
    this.dropdown!.appendChild(heading);
  }

  private appendRow(entry: SearchEntry<T>, index: number): void {
    const row = document.createElement('div');
    row.dataset.index = String(index);
    row.className =
      'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-200 border-b border-base-200 last:border-0';
    row.innerHTML = `
      ${entry.icon}
      <span class="min-w-0 flex-1 truncate text-sm">${esc(entry.primary)}</span>
      ${entry.secondary ? `<span class="min-w-0 max-w-[50%] truncate text-right text-xs opacity-60" title="${esc(entry.secondary)}">${esc(entry.secondary)}</span>` : ''}
    `;
    row.addEventListener('mouseenter', () => this.setActive(index));
    row.addEventListener('click', () => this.select(index));
    this.dropdown!.appendChild(row);
  }

  private renderMessage(html: string): void {
    if (!this.dropdown) {
      return;
    }
    this.matches = [];
    this.localGroups = [];
    this.remoteMatches = [];
    this.dropdown.innerHTML = `<div class="px-3 py-4 text-center text-sm opacity-60">${html}</div>`;
    this.show();
  }

  private setActive(index: number): void {
    this.activeIndex = index;
    if (!this.dropdown) {
      return;
    }
    const rows = this.dropdown.querySelectorAll<HTMLElement>('[data-index]');
    rows.forEach((row) => {
      row.classList.toggle('bg-base-200', Number(row.dataset.index) === index);
    });
    rows[index]?.scrollIntoView({ block: 'nearest' });
  }

  private select(index: number): void {
    const entry = this.matches[index];
    if (!entry) {
      return;
    }
    this.hide();
    this.input?.blur();
    this.opts.onSelect(entry.payload);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.hide();
      this.input?.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.select(this.activeIndex);
    } else if (e.key === 'ArrowDown' && this.matches.length > 0) {
      e.preventDefault();
      this.setActive((this.activeIndex + 1) % this.matches.length);
    } else if (e.key === 'ArrowUp' && this.matches.length > 0) {
      e.preventDefault();
      this.setActive(
        (this.activeIndex - 1 + this.matches.length) % this.matches.length
      );
    }
  }

  private show(): void {
    this.dropdown?.classList.remove('hidden');
  }

  private hide(): void {
    this.remoteAbort?.abort();
    this.remoteAbort = null;
    this.dropdown?.classList.add('hidden');
  }
}
