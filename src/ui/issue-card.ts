/**
 * Feed issue card.
 *
 * A warning card listing data-quality problems as label/count rows with an
 * optional explanatory note. Renders nothing when every count is zero, so a
 * clean feed does not leave an empty card as furniture.
 *
 * A row may also carry the offending items, as a count and a page reader. When
 * it does the row becomes an expandable <details> block; opening it mounts a
 * lazy list of the items in a capped-height scroller (`attachIssueCard`), with
 * a search box once there is more than one page. Without items it renders
 * exactly as a plain label/count row. Items carry opaque data attributes so
 * the host app can attach its own delegated click handler: the card itself
 * knows nothing about navigation.
 *
 * Deliberately generic: no GTFS types and no app types, escaping only. The
 * card is markup and arithmetic over rows the caller assembles.
 */

import { escapeHtml } from '../util/escape-html';
import { t } from '../i18n/messages';
import { bindListSearch, mountLazyList } from './lazy-list';

/** Items an open row draws per page. */
const ISSUE_PAGE_SIZE = 50;

export interface IssueItem {
  /** Plain text shown for this item. Escaped here, so pass raw text. */
  label: string;
  /** Optional secondary text, shown dimmed after the label. */
  detail?: string;
  /** Data attribute names/values, without the `data-` prefix. */
  data?: Record<string, string>;
}

/**
 * A button in the row header, for a fix that applies to the whole row rather
 * than to one item. The card only renders it and stamps the data attributes;
 * the host app attaches its own delegated click handler, as it does for items.
 */
export interface IssueAction {
  label: string;
  /** Value of the `data-issue-action` attribute the host delegates on. */
  dataAction: string;
}

/** A row's items, read a page at a time when the row is opened. */
export interface IssueItems {
  count: number;
  /** Items `[start, end)`. */
  page(start: number, end: number): IssueItem[] | Promise<IssueItem[]>;
}

export interface IssueRow {
  label: string;
  count: number;
  note?: string;
  items?: IssueItems;
  actions?: IssueAction[];
  /**
   * Stamped as `data-issue-key` on the row and on each of its buttons, so a
   * delegated click can tell which row it came from.
   */
  key?: string;
}

function keyAttr(row: IssueRow): string {
  return row.key === undefined
    ? ''
    : ` data-issue-key="${escapeHtml(row.key)}"`;
}

function renderItem(item: IssueItem): string {
  const attrs = Object.entries(item.data ?? {})
    .map(([name, value]) => ` data-${name}="${escapeHtml(value)}"`)
    .join('');
  const clickable = item.data && Object.keys(item.data).length > 0;
  const classes = clickable
    ? 'link link-hover cursor-pointer'
    : 'opacity-70 cursor-default';
  const detail = item.detail
    ? ` <span class="opacity-50">${escapeHtml(item.detail)}</span>`
    : '';
  return `<li><span class="${classes}"${attrs}>${escapeHtml(item.label)}</span>${detail}</li>`;
}

function renderActions(row: IssueRow): string {
  if (!row.actions || row.actions.length === 0) {
    return '';
  }
  const buttons = row.actions
    .map(
      (action) =>
        `<button type="button" class="btn btn-xs btn-warning btn-outline" data-issue-action="${escapeHtml(action.dataAction)}"${keyAttr(row)}>${escapeHtml(action.label)}</button>`
    )
    .join('');
  return `<span class="flex flex-wrap items-center gap-1">${buttons}</span>`;
}

function renderHeader(row: IssueRow): string {
  return `
    <span>${escapeHtml(row.label)}</span>
    <span class="flex items-center gap-2 shrink-0">
      ${renderActions(row)}
      <span class="tabular-nums font-semibold">${row.count}</span>
    </span>
  `;
}

function renderNote(row: IssueRow): string {
  return row.note
    ? `<p class="text-xs opacity-50">${escapeHtml(row.note)}</p>`
    : '';
}

function renderRow(row: IssueRow, index: number): string {
  if (!row.items || row.items.count === 0) {
    return `
      <div${keyAttr(row)}>
        <div class="flex justify-between gap-2 text-xs">${renderHeader(row)}</div>
        ${renderNote(row)}
      </div>
    `;
  }

  const search =
    row.items.count > ISSUE_PAGE_SIZE
      ? `<input type="search" class="input input-xs w-full max-w-xs mt-1" data-issue-search placeholder="${escapeHtml(t('list.search'))}" />`
      : '';

  return `
    <details data-issue-row="${index}"${keyAttr(row)}>
      <summary class="flex justify-between gap-2 text-xs cursor-pointer">${renderHeader(row)}</summary>
      ${renderNote(row)}
      ${search}
      <div class="mt-1 max-h-64 overflow-y-auto">
        <ul class="ml-3 space-y-0.5 text-xs list-disc list-inside" data-issue-list></ul>
      </div>
    </details>
  `;
}

export function renderIssueCard(title: string, rows: IssueRow[]): string {
  const present = rows.filter((row) => row.count > 0);
  if (present.length === 0) {
    return '';
  }

  const body = rows
    .map((row, index) => (row.count > 0 ? renderRow(row, index) : ''))
    .join('');

  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">${escapeHtml(title)}</h3>
      <div class="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
        ${body}
      </div>
    </section>
  `;
}

/** The lazy list of one opened row, with its search box if it has one. */
function mountRowList(details: HTMLDetailsElement, items: IssueItems): void {
  const list = details.querySelector<HTMLElement>('[data-issue-list]');
  if (!list) {
    return;
  }
  // Filled on the first search, so an unsearched row reads only its pages.
  let cache: IssueItem[] | null = null;
  const lazy = mountLazyList<number>(list, {
    name: `issue ${details.dataset.issueKey ?? details.dataset.issueRow}`,
    items: Array.from({ length: items.count }, (_, i) => i),
    pageSize: ISSUE_PAGE_SIZE,
    renderPage: async (slice) => {
      if (slice.length === 0) {
        return '';
      }
      const known = cache;
      const loaded = known
        ? slice.map((i) => known[i])
        : await items.page(slice[0], slice[0] + slice.length);
      return loaded.map(renderItem).join('');
    },
    match: (i, needle) => {
      const item = cache?.[i];
      return (
        item !== undefined &&
        `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(needle)
      );
    },
  });

  const input = details.querySelector<HTMLInputElement>('[data-issue-search]');
  if (input) {
    bindListSearch(input, (needle) => {
      const apply = (): void => lazy.setNeedle(needle);
      if (cache || needle.trim() === '') {
        apply();
        return;
      }
      Promise.resolve(items.page(0, items.count))
        .then((loaded) => {
          cache = loaded;
          apply();
        })
        .catch((error: unknown) =>
          console.error('[IssueCard] reading items for search failed:', error)
        );
    });
  }
}

/**
 * Wires a rendered card: each row with items mounts its lazy list the first
 * time it is opened. `rows` is the array the card was rendered from.
 */
export function attachIssueCard(root: HTMLElement, rows: IssueRow[]): void {
  root
    .querySelectorAll<HTMLDetailsElement>('details[data-issue-row]')
    .forEach((details) => {
      const items = rows[Number(details.dataset.issueRow)]?.items;
      if (!items) {
        return;
      }
      details.addEventListener('toggle', () => {
        if (details.open && details.dataset.issueMounted === undefined) {
          details.dataset.issueMounted = '';
          mountRowList(details, items);
        }
      });
    });
}
