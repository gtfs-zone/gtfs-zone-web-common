/**
 * The one row shape every list on a realtime page uses: a colour dot, a label
 * over a sublabel, a right-aligned badge, and `hover:bg-base-200` over the
 * whole row.
 *
 * A row is a real `<a href>` carrying the target hash plus the `data-nav`
 * payload the panel intercepts, exactly as `entityLink` emits, so
 * middle-click and copy-link-address work on a row the same way they work on
 * a link. The anchor is built here rather than through `entityLink` because
 * the row wraps structured content (dot, two lines, badge); a row that carries
 * buttons instead links only its label, through `entityLink` itself, because
 * an `<a>` may not contain a `<button>`.
 */

import type { PageRef, RenderContext } from './entity-render';
import { entityLink, escHtml, section } from './entity-render';

export interface EntityRow<S extends PageRef = PageRef> {
  /** Where the row goes. A row with no state is text, not a link. */
  state?: S;
  label: string;
  /** The second line, under the label. Escaped. */
  sublabel?: string;
  /** A dot in this CSS colour before the label. */
  color?: string;
  /** Markup between the dot and the label: a route badge, a status badge. */
  leadHtml?: string;
  /** Right-aligned text, rendered as the standard outline badge. */
  badge?: string;
  /** Right-aligned markup, used instead of `badge` where the caller has its own. */
  badgeHtml?: string;
  /** Buttons at the end of the row. Rendered outside the anchor. */
  actionsHtml?: string;
  /** Hover text for the whole row. */
  title?: string;
}

const ROW_CLASS =
  'flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-lg transition-colors hover:bg-base-200';

function dot(color: string | undefined): string {
  if (!color) {
    return '';
  }
  return `<span class="size-2 rounded-full shrink-0 ring-1 ring-base-content/20"
    style="background:${escHtml(color)}"></span>`;
}

/** The two text lines. The sublabel is dropped rather than rendered empty. */
function text<S extends PageRef>(
  row: EntityRow<S>,
  ctx?: RenderContext<S>
): string {
  const label =
    ctx && row.state
      ? entityLink(ctx, row.state, row.label, 'link link-hover')
      : escHtml(row.label);
  return `<span class="min-w-0 flex-1">
    <span class="block truncate text-xs font-medium">${label}</span>
    ${
      row.sublabel
        ? `<span class="block truncate text-xs opacity-60">${escHtml(row.sublabel)}</span>`
        : ''
    }
  </span>`;
}

function trailing(row: EntityRow<PageRef>): string {
  if (row.badgeHtml) {
    return `<span class="shrink-0">${row.badgeHtml}</span>`;
  }
  if (row.badge === undefined) {
    return '';
  }
  return `<span class="badge badge-outline badge-xs shrink-0 tabular-nums">${escHtml(
    row.badge
  )}</span>`;
}

/**
 * One row, as an `<li>`.
 *
 * Three shapes, in order of preference: the whole row is the anchor; the row
 * carries buttons, so only its label is; the row names nothing navigable and is
 * plain text.
 */
export function entityRow<S extends PageRef>(
  ctx: RenderContext<S>,
  row: EntityRow<S>
): string {
  const titleAttr = row.title ? ` title="${escHtml(row.title)}"` : '';
  const body = `${dot(row.color)}${row.leadHtml ?? ''}`;

  if (row.state && !row.actionsHtml) {
    return `<li><a href="${escHtml(ctx.href(row.state))}" data-nav="${escHtml(
      JSON.stringify(row.state)
    )}" class="${ROW_CLASS}"${titleAttr}>${body}${text(row)}${trailing(row)}</a></li>`;
  }

  return `<li class="${ROW_CLASS}"${titleAttr}>${body}${text(row, ctx)}${trailing(row)}${
    row.actionsHtml
      ? `<span class="shrink-0 flex gap-1">${row.actionsHtml}</span>`
      : ''
  }</li>`;
}

/** The list around the rows, with its own empty state. */
export function entityRowList(rows: string[], empty: string): string {
  if (rows.length === 0) {
    return emptyState(empty);
  }
  return `<ul class="-mx-2">${rows.join('')}</ul>`;
}

/** What a list says when it has nothing in it. Every list says something. */
export function emptyState(message: string): string {
  return `<p class="text-xs opacity-60">${escHtml(message)}</p>`;
}

/** The count that sits beside a list's title. */
export function countBadge(count: number | string): string {
  return `<span class="badge badge-ghost badge-xs ml-2 tabular-nums font-normal">${escHtml(
    String(count)
  )}</span>`;
}

/** A section whose title carries a count and whose body is a row list. */
export function rowSection(
  title: string,
  count: number | string,
  body: string,
  extra = ''
): string {
  return section(title, body, `${countBadge(count)}${extra}`);
}

/** The "not everything is listed" line, shown only when something was cut. */
export function cappedNote(total: number, shown: number): string {
  if (total <= shown) {
    return '';
  }
  return `<p class="text-xs opacity-50 mt-2">${escHtml(
    `${total - shown} more not listed - use the search box.`
  )}</p>`;
}
