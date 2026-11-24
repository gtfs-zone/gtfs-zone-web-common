/**
 * List box: the one list shape a tree page uses.
 *
 * A short list (up to `LIST_BOX_LAZY_THRESHOLD` rows) renders whole in a
 * scrollbox. A longer one becomes a lazy list inside the same scrollbox, with
 * a search box when its items can be searched, and keeps the lazy list's
 * "n of m" status line. Items are an array, or a count and a page reader for
 * lists that live elsewhere (a worker); a paged list reads every item once, on
 * its first search.
 */

import { t } from '../i18n/messages';
import { escapeHtml } from '../util/escape-html';
import { bindListSearch, mountLazyList, type LazyList } from './lazy-list';
import { renderScrollbox } from './scrollbox';

/** Lists longer than this are lazy, with search. */
export const LIST_BOX_LAZY_THRESHOLD = 100;

const PAGE_SIZE = 50;

/** Items read a page at a time. */
export interface ListBoxPages<T> {
  count: number;
  /** Items `[start, end)`. */
  page(start: number, end: number): T[] | Promise<T[]>;
}

export interface ListBoxOptions<T> {
  items: readonly T[] | ListBoxPages<T>;
  /** One row's markup, an `<li>` (usually `entityRow`). */
  row(item: T, index: number): string;
  /** The text an item is searched on. Lazy boxes with it get a search box. */
  searchText?(item: T): string;
  /** Shown when there are no items. */
  empty: string;
  /** Force lazy (true) or whole (false); by default decided by the count. */
  lazy?: boolean;
  /** Prefix of the log lines. */
  name?: string;
}

/** What a reader did to a box, carried over a re-render of its page. */
export interface ListBoxSnapshot {
  needle: string;
  /** The search box had focus. */
  focused: boolean;
  /** Lazy rows drawn. */
  rows: number;
  scrollTop: number;
  /** The scrollbox's height, held until the restored rows are drawn. */
  height: number;
}

export interface ListBox {
  snapshot(): ListBoxSnapshot;
  destroy(): void;
}

const EMPTY_SNAPSHOT: ListBoxSnapshot = {
  needle: '',
  focused: false,
  rows: 0,
  scrollTop: 0,
  height: 0,
};

function isPaged<T>(
  items: readonly T[] | ListBoxPages<T>
): items is ListBoxPages<T> {
  return !Array.isArray(items);
}

function emptyLine(message: string): string {
  return `<p class="text-xs opacity-60">${escapeHtml(message)}</p>`;
}

function rowList(rows: string): string {
  return `<ul class="-mx-2">${rows}</ul>`;
}

/** Renders the whole list once its items are read. */
function mountWhole<T>(
  target: HTMLElement,
  options: ListBoxOptions<T>,
  tag: string,
  restore: ListBoxSnapshot
): ListBox {
  let destroyed = false;
  let scroller: HTMLElement | null = null;
  const draw = (items: readonly T[]): void => {
    if (destroyed) {
      return;
    }
    target.style.minHeight = '';
    target.innerHTML = renderScrollbox(
      rowList(items.map((item, i) => options.row(item, i)).join(''))
    );
    scroller = target.firstElementChild as HTMLElement | null;
    if (scroller) {
      scroller.scrollTop = restore.scrollTop;
    }
  };
  const items = options.items;
  if (isPaged(items)) {
    // Hold the old height while the read runs, so the panel's own scroll
    // offset is not clamped.
    if (restore.height > 0) {
      target.style.minHeight = `${restore.height}px`;
    }
    Promise.resolve(items.page(0, items.count))
      .then(draw)
      .catch((error: unknown) => console.error(`${tag} read failed:`, error));
  } else {
    draw(items);
  }
  return {
    snapshot: () => ({
      ...EMPTY_SNAPSHOT,
      scrollTop: scroller?.scrollTop ?? restore.scrollTop,
      height: scroller?.offsetHeight ?? restore.height,
    }),
    destroy: () => {
      destroyed = true;
    },
  };
}

function mountLazy<T>(
  target: HTMLElement,
  options: ListBoxOptions<T>,
  count: number,
  tag: string,
  restore: ListBoxSnapshot
): ListBox {
  const source = options.items;
  const searchText = options.searchText;
  // Every item, once read: the array itself, or a paged list's first search.
  let all: readonly T[] | null = isPaged(source) ? null : source;
  const read = async (start: number, end: number): Promise<T[]> =>
    all
      ? all.slice(start, end)
      : await (source as ListBoxPages<T>).page(start, end);

  target.innerHTML = `${
    searchText
      ? `<input type="search" class="input input-sm w-full mb-2" placeholder="${escapeHtml(
          t('list.search')
        )}" data-list-box-search>`
      : ''
  }${renderScrollbox(rowList(''))}`;
  const ul = target.querySelector<HTMLElement>('ul')!;
  const scroller = ul.parentElement!;
  const input = target.querySelector<HTMLInputElement>(
    '[data-list-box-search]'
  );
  // A paged list can only filter once every item is read, so its needle is
  // applied after that read instead of at mount.
  const startNeedle = input && all ? restore.needle : '';
  // Hold the old height so the panel's own scroll offset is not clamped
  // while the first page renders.
  let restorePending = restore.height > 0 || restore.scrollTop > 0;
  if (restore.height > 0) {
    scroller.style.minHeight = `${restore.height}px`;
  }

  const lazy: LazyList<number> = mountLazyList<number>(ul, {
    name: options.name,
    items: Array.from({ length: count }, (_, i) => i),
    pageSize: PAGE_SIZE,
    renderPage: async (slice) => {
      if (slice.length === 0) {
        return '';
      }
      // A filtered slice is not contiguous; it only happens once `all` is read.
      const loaded = all
        ? slice.map((i) => all![i])
        : await read(slice[0], slice[0] + slice.length);
      return loaded.map((item, k) => options.row(item, slice[k])).join('');
    },
    match: searchText
      ? (i, needle) => {
          const item = all?.[i];
          return (
            item !== undefined &&
            searchText(item).toLowerCase().includes(needle)
          );
        }
      : undefined,
    afterAppend: () => {
      if (restorePending) {
        restorePending = false;
        scroller.style.minHeight = '';
        scroller.scrollTop = restore.scrollTop;
      }
    },
    empty: options.empty,
    initialNeedle: startNeedle,
    initialRows: startNeedle === restore.needle ? restore.rows : 0,
  });

  let unbind: (() => void) | null = null;
  if (input) {
    input.value = restore.needle;
    if (restore.focused) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    const onNeedle = (needle: string): void => {
      if (all || needle.trim() === '') {
        lazy.setNeedle(needle);
        return;
      }
      read(0, count)
        .then((loaded) => {
          all = loaded;
          lazy.setNeedle(needle);
        })
        .catch((error: unknown) =>
          console.error(`${tag} reading items for search failed:`, error)
        );
    };
    unbind = bindListSearch(input, onNeedle);
    if (restore.needle !== startNeedle) {
      onNeedle(restore.needle);
    }
  }

  return {
    snapshot: () => ({
      needle: input?.value ?? '',
      focused: input !== null && document.activeElement === input,
      rows: lazy.shown(),
      scrollTop: scroller.scrollTop,
      height: scroller.offsetHeight,
    }),
    destroy: () => {
      unbind?.();
      lazy.destroy();
    },
  };
}

/**
 * Mounts a list box on `target`, replacing its contents. `restore` is the
 * snapshot of the same box before its page re-rendered.
 */
export function mountListBox<T>(
  target: HTMLElement,
  options: ListBoxOptions<T>,
  restore: ListBoxSnapshot = EMPTY_SNAPSHOT
): ListBox {
  const tag = `[ListBox ${options.name ?? 'list'}]`;
  const count = isPaged(options.items)
    ? options.items.count
    : options.items.length;
  if (count === 0) {
    target.innerHTML = emptyLine(options.empty);
    return { snapshot: () => restore, destroy: () => {} };
  }
  const lazy = options.lazy ?? count > LIST_BOX_LAZY_THRESHOLD;
  return lazy
    ? mountLazy(target, options, count, tag, restore)
    : mountWhole(target, options, tag, restore);
}
