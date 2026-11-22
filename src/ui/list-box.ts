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

export interface ListBox {
  destroy(): void;
}

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
  tag: string
): ListBox {
  let destroyed = false;
  const draw = (items: readonly T[]): void => {
    if (destroyed) {
      return;
    }
    target.innerHTML = renderScrollbox(
      rowList(items.map((item, i) => options.row(item, i)).join(''))
    );
  };
  const items = options.items;
  if (isPaged(items)) {
    Promise.resolve(items.page(0, items.count))
      .then(draw)
      .catch((error: unknown) => console.error(`${tag} read failed:`, error));
  } else {
    draw(items);
  }
  return {
    destroy: () => {
      destroyed = true;
    },
  };
}

function mountLazy<T>(
  target: HTMLElement,
  options: ListBoxOptions<T>,
  count: number,
  tag: string
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
    empty: options.empty,
  });

  let unbind: (() => void) | null = null;
  const input = target.querySelector<HTMLInputElement>(
    '[data-list-box-search]'
  );
  if (input) {
    unbind = bindListSearch(input, (needle) => {
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
    });
  }

  return {
    destroy: () => {
      unbind?.();
      lazy.destroy();
    },
  };
}

/** Mounts a list box on `target`, replacing its contents. */
export function mountListBox<T>(
  target: HTMLElement,
  options: ListBoxOptions<T>
): ListBox {
  const tag = `[ListBox ${options.name ?? 'list'}]`;
  const count = isPaged(options.items)
    ? options.items.count
    : options.items.length;
  if (count === 0) {
    target.innerHTML = emptyLine(options.empty);
    return { destroy: () => {} };
  }
  const lazy = options.lazy ?? count > LIST_BOX_LAZY_THRESHOLD;
  return lazy
    ? mountLazy(target, options, count, tag)
    : mountWhole(target, options, tag);
}
