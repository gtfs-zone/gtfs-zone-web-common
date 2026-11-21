/**
 * Lazy list.
 *
 * Renders a long list a page at a time: the next page is appended when a
 * sentinel under the list comes within about a screen of the visible area of
 * the nearest scrollable ancestor. This is append-on-scroll, not windowing:
 * rows stay in the DOM once drawn, so they may vary in height, hold
 * `<details>` and fill themselves in asynchronously.
 *
 * The sentinel is also the status line: "N of M" while rows remain, the
 * `noMatch` or `empty` copy when there are none to show, blank once complete.
 */

import { t } from '../i18n/messages';
import { escapeHtml } from '../util/escape-html';

/** Debounce of a list's search input. */
export const LIST_SEARCH_DEBOUNCE_MS = 150;

/** How far beyond the visible area the sentinel triggers a page, in px. */
const PRELOAD_MARGIN_PX = 800;

export interface LazyListOptions<T> {
  items: T[];
  pageSize: number;
  /** Markup for one page of rows, appended at the end of `target`. */
  renderPage(slice: T[], start: number): string | Promise<string>;
  /** Called with the elements a page appended, for per-page async fills. */
  afterAppend?(
    nodes: Element[],
    slice: T[],
    start: number
  ): void | Promise<void>;
  /** Whether an item matches a needle, already trimmed and lowercased. */
  match?(item: T, needle: string): boolean;
  /** Shown when `items` is empty. */
  empty?: string;
  /** Shown when nothing matches; defaults to the shared no-match copy. */
  noMatch?(needle: string): string;
  /** Prefix of the `[LazyList]` log lines, to tell lists apart. */
  name?: string;
}

export interface SetItemsOptions {
  /** Re-render as many rows as were shown, so an edit redraw keeps scroll. */
  keep?: boolean;
  /** Render at least through this index, so a focused row is drawn. */
  through?: number;
}

export interface LazyList<T> {
  setNeedle(needle: string): void;
  setItems(items: T[], options?: SetItemsOptions): void;
  /** Rows currently drawn. */
  shown(): number;
  /** Rows matching the current needle. */
  matching(): number;
  destroy(): void;
}

/**
 * Whether `el` scrolls vertically. A `.scroll-rows` region always does, even
 * before its first page overflows it. `overflow-x: auto` alone computes
 * `overflow-y` to `auto` as well, so a horizontal-only wrapper (a wide
 * table's) also needs a height cap or overflowing content to count.
 */
function isScrollable(el: Element): boolean {
  if (el.classList.contains('scroll-rows')) {
    return true;
  }
  const style = getComputedStyle(el);
  const overflow = style.overflowY;
  if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') {
    return false;
  }
  return style.maxHeight !== 'none' || el.scrollHeight > el.clientHeight;
}

/** The nearest scrolling ancestor of `el`, or null for the viewport. */
function scrollRoot(el: Element): Element | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (isScrollable(node)) {
      return node;
    }
  }
  return null;
}

/** Whether `el` is rendered and within the preload margin of `root`. */
function nearView(el: Element, root: Element | null): boolean {
  if (el.getClientRects().length === 0) {
    return false;
  }
  const bottom = root
    ? root.getBoundingClientRect().bottom
    : window.innerHeight;
  return el.getBoundingClientRect().top < bottom + PRELOAD_MARGIN_PX;
}

/**
 * Mounts a lazy list on `target` (a `tbody`, `ul` or `div`), replacing its
 * contents. The sentinel goes after the target's block: after its table for a
 * `tbody`, so it is not inside the table. `target` must be in the document.
 */
export function mountLazyList<T>(
  target: HTMLElement,
  options: LazyListOptions<T>
): LazyList<T> {
  const name = options.name ?? (target.id || 'list');
  const tag = `[LazyList ${name}]`;
  let items = options.items;
  let needle = '';
  let filtered = items;
  let shown = 0;
  // Bumped by every reset; a page from an older generation is dropped.
  let generation = 0;
  let loadingGeneration = -1;
  let destroyed = false;

  if (!target.isConnected) {
    console.warn(`${tag} mounted on a detached target`);
  }
  const block = target.closest('table') ?? target;
  const sentinel = document.createElement('div');
  sentinel.className = 'text-xs opacity-60 py-2';
  sentinel.dataset.lazyListStatus = '';
  block.after(sentinel);

  const onIntersect = (entries: IntersectionObserverEntry[]): void => {
    if (entries.some((entry) => entry.isIntersecting)) {
      void loadNext();
    }
  };
  let root: Element | null = null;
  let observer: IntersectionObserver | null = null;
  /**
   * Observes against the nearest scrolling ancestor. Re-run after each
   * render: an ancestor that had too little content to scroll may scroll now.
   */
  const observe = (): void => {
    const next = scrollRoot(block);
    if (observer && next === root) {
      return;
    }
    observer?.disconnect();
    root = next;
    observer = new IntersectionObserver(onIntersect, {
      root,
      rootMargin: `0px 0px ${PRELOAD_MARGIN_PX}px 0px`,
    });
    observer.observe(sentinel);
  };
  observe();

  const updateStatus = (): void => {
    let text = '';
    if (filtered.length === 0) {
      text = needle
        ? (options.noMatch?.(needle) ?? t('list.noMatch', { needle }))
        : (options.empty ?? '');
    } else if (shown < filtered.length) {
      text = t('list.status', { shown, total: filtered.length });
    }
    sentinel.innerHTML = escapeHtml(text);
  };

  const applyFilter = (): void => {
    if (!needle) {
      filtered = items;
    } else if (options.match) {
      const match = options.match;
      filtered = items.filter((item) => match(item, needle));
    } else {
      console.error(`${tag} needle set on a list with no match`);
      filtered = items;
    }
  };

  /** Detached target: stop observing for good. */
  const checkAttached = (): boolean => {
    if (!destroyed && !target.isConnected) {
      console.log(`${tag} target detached, destroyed`);
      destroy();
    }
    return !destroyed;
  };

  const runAfterAppend = (
    nodes: Element[],
    slice: T[],
    start: number
  ): void => {
    if (!options.afterAppend) {
      return;
    }
    Promise.resolve(options.afterAppend(nodes, slice, start)).catch(
      (error: unknown) => console.error(`${tag} afterAppend failed:`, error)
    );
  };

  /**
   * Renders rows `[shown, end)` and appends them, or, with `replace`, renders
   * rows `[0, end)` and swaps them in for the current contents in one go.
   */
  const render = async (end: number, replace: boolean): Promise<boolean> => {
    const myGeneration = generation;
    const start = replace ? 0 : shown;
    const slice = filtered.slice(start, end);
    loadingGeneration = myGeneration;
    let html: string;
    try {
      html = await options.renderPage(slice, start);
    } finally {
      if (loadingGeneration === myGeneration) {
        loadingGeneration = -1;
      }
    }
    if (myGeneration !== generation || !checkAttached()) {
      console.log(`${tag} page at ${start} dropped, list moved on`);
      return false;
    }
    const before = replace ? 0 : target.children.length;
    if (replace) {
      target.innerHTML = html;
    } else {
      target.insertAdjacentHTML('beforeend', html);
    }
    shown = start + slice.length;
    updateStatus();
    observe();
    console.log(`${tag} rows ${start}-${shown} of ${filtered.length}`);
    runAfterAppend([...target.children].slice(before), slice, start);
    return true;
  };

  /** Appends pages while the sentinel stays near the visible area. */
  async function loadNext(): Promise<void> {
    while (
      !destroyed &&
      loadingGeneration === -1 &&
      shown < filtered.length &&
      checkAttached() &&
      nearView(sentinel, root)
    ) {
      const ok = await render(
        Math.min(filtered.length, shown + options.pageSize),
        false
      );
      if (!ok) {
        return;
      }
    }
  }

  /** Redraws from the top, at least `minRows` rows, then keeps loading. */
  const reset = (minRows: number): void => {
    generation += 1;
    loadingGeneration = -1;
    const end = Math.min(filtered.length, Math.max(options.pageSize, minRows));
    render(end, true)
      .then((ok) => (ok ? loadNext() : undefined))
      .catch((error: unknown) => console.error(`${tag} render failed:`, error));
  };

  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;
    generation += 1;
    observer?.disconnect();
    sentinel.remove();
  }

  applyFilter();
  reset(0);

  return {
    setNeedle(value: string): void {
      const next = value.trim().toLowerCase();
      if (next === needle || destroyed) {
        return;
      }
      needle = next;
      applyFilter();
      console.log(`${tag} needle "${needle}": ${filtered.length} match`);
      reset(0);
    },
    setItems(next: T[], setOptions: SetItemsOptions = {}): void {
      if (destroyed) {
        return;
      }
      const kept = setOptions.keep ? shown : 0;
      items = next;
      applyFilter();
      reset(Math.max(kept, (setOptions.through ?? -1) + 1));
    },
    shown: () => shown,
    matching: () => filtered.length,
    destroy,
  };
}

/**
 * Calls `onNeedle` with the input's value, debounced. Several lists may share
 * one input by calling each from `onNeedle`. Returns the unbinding function.
 */
export function bindListSearch(
  input: HTMLInputElement,
  onNeedle: (needle: string) => void
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onInput = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => onNeedle(input.value), LIST_SEARCH_DEBOUNCE_MS);
  };
  input.addEventListener('input', onInput);
  return () => {
    clearTimeout(timer);
    input.removeEventListener('input', onInput);
  };
}
