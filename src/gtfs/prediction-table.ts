/**
 * The stop times table with realtime predictions: stop sequence, stop,
 * scheduled, expected and delay. Used by the trip and vehicle pages.
 */

import type { Prediction } from './rt-index';
import type { ResolvedEvent } from './stop-time-event';
import { clockAt, formatScheduleTime, zoneLabel } from './feed-time';
import {
  derivedClass,
  escHtml,
  formatDelay,
  formatDuration,
  predictionTooltip,
  shownEvents,
  stopTimeRelationshipMark,
} from './entity-render';
import { TOOLTIP_TRIGGER_CLASS, tooltipContentAttr } from '../ui/field-label';
import { renderNavIcon } from '../ui/nav-icons';
import { t } from '../i18n/messages';

export interface PredictionRow {
  sequence?: number;
  /** The stop cell's HTML, usually an entity link. */
  stopHtml: string;
  prediction?: Prediction;
  /** Scheduled times (HH:MM:SS) shown when there is no prediction. */
  scheduled?: { arrival?: string; departure?: string };
  /** Highlights the vehicle's current stop. */
  current?: boolean;
  /** Extra classes and attributes on the `<tr>`. */
  rowClass?: string;
  rowAttrs?: string;
}

const ICON = 'inline h-3.5 w-3.5 align-text-bottom';

function eventIcon(kind: ResolvedEvent['kind']): string {
  const title = t(
    kind === 'arrival' ? 'prediction.arrival' : 'prediction.departure'
  );
  return `<span class="opacity-50 mr-1" title="${escHtml(title)}">${renderNavIcon(
    kind === 'arrival' ? 'arrives' : 'departs',
    { sizeClass: ICON }
  )}</span>`;
}

function headerCell(label: string, tip: string): string {
  return `<th class="text-right"><span class="${TOOLTIP_TRIGGER_CLASS}" tabindex="0" ${tooltipContentAttr(tip)}>${escHtml(label)}</span></th>`;
}

function headerCells(live: boolean): string {
  const scheduled = headerCell(
    t('prediction.scheduled'),
    t('prediction.tipScheduled')
  );
  if (!live) {
    return scheduled;
  }
  return [
    scheduled,
    headerCell(t('prediction.expected'), t('prediction.tipExpected')),
    headerCell(
      t('prediction.delay'),
      `${t('prediction.tipDelay')}<br>${t('prediction.delayColours')}`
    ),
  ].join('');
}

/**
 * One prediction as three cells: scheduled, expected, delay. Calculated values
 * are italic; skipped and no-data stops carry their badge in the delay cell.
 * All three cells open the same tooltip.
 */
function predictionCells(p: Prediction): string {
  const skipped = p.scheduleRelationship === 1;
  const events = shownEvents(p);
  const label = (ev: ResolvedEvent) =>
    events.length > 1 ? eventIcon(ev.kind) : '';
  const lines = (render: (ev: ResolvedEvent) => string) =>
    events.map((ev) => `<div>${render(ev)}</div>`).join('');

  const sched = lines(
    (ev) =>
      `${label(ev)}<span class="opacity-50${skipped ? ' line-through' : ''}">${escHtml(
        ev.scheduledText ? formatScheduleTime(ev.scheduledText) : '—'
      )}</span>`
  );
  const expected = skipped
    ? ''
    : lines((ev) =>
        ev.time === undefined
          ? '<span class="opacity-30">—</span>'
          : `<span class="${derivedClass(ev.timeFrom).trim()}">${escHtml(clockAt(ev.time))}</span>`
      );
  const delay = skipped
    ? ''
    : lines(
        (ev) =>
          `<span class="${derivedClass(ev.delayFrom).trim()}">${formatDelay(ev.delay)}</span>${
            ev.uncertainty
              ? ` <span class="opacity-60" title="${escHtml(t('prediction.uncertainty'))}">±${escHtml(formatDuration(ev.uncertainty))}</span>`
              : ''
          }`
      );
  const mark = stopTimeRelationshipMark(p.scheduleRelationship);

  const attr = tooltipContentAttr(predictionTooltip(p));
  const cell = (body: string) =>
    `<td class="text-right whitespace-nowrap tabular-nums align-top ${TOOLTIP_TRIGGER_CLASS}" ${attr}>${body}</td>`;
  return cell(sched) + cell(expected) + cell(`${delay}${mark}`);
}

/** Scheduled times alone, for a stop with no prediction. */
function scheduledCells(row: PredictionRow, live: boolean): string {
  const { arrival, departure } = row.scheduled ?? {};
  const both = arrival && departure && arrival !== departure;
  const line = (kind: ResolvedEvent['kind'], value: string) =>
    `<div>${both ? eventIcon(kind) : ''}<span class="opacity-50">${escHtml(formatScheduleTime(value))}</span></div>`;
  const body = both
    ? line('arrival', arrival) + line('departure', departure)
    : arrival || departure
      ? line('departure', (departure || arrival)!)
      : '<span class="opacity-30">—</span>';
  const td = (inner: string) =>
    `<td class="text-right whitespace-nowrap tabular-nums align-top">${inner}</td>`;
  return td(body) + (live ? td('') + td('') : '');
}

/**
 * The table, with the display zone in a caption below it. Expected and delay
 * columns appear only when at least one row has a prediction.
 */
export function renderPredictionTable(rows: PredictionRow[]): string {
  const live = rows.some((r) => r.prediction);
  const sequenceTitle = escHtml(t('prediction.sequence'));
  const body = rows
    .map((row) => {
      const skipped = row.prediction?.scheduleRelationship === 1;
      const cls = [row.current ? 'bg-base-200' : '', row.rowClass ?? '']
        .join(' ')
        .trim();
      return `<tr class="${cls}" ${row.rowAttrs ?? ''}>
        <td class="text-right tabular-nums opacity-60 align-top">${escHtml(String(row.sequence ?? '—'))}</td>
        <td class="max-w-0 truncate align-top${skipped ? ' opacity-50 line-through' : ''}">${row.stopHtml}</td>
        ${row.prediction ? predictionCells(row.prediction) : scheduledCells(row, live)}
      </tr>`;
    })
    .join('');

  return `<table class="table table-xs table-fixed">
      <colgroup>
        <col style="width: 9%" />
        <col style="width: ${live ? 37 : 61}%" />
        <col style="width: ${live ? 18 : 30}%" />
        ${live ? '<col style="width: 18%" /><col style="width: 18%" />' : ''}
      </colgroup>
      <thead><tr>
        <th class="text-right"><span title="${sequenceTitle}" aria-label="${sequenceTitle}">${renderNavIcon('hashtag', { sizeClass: ICON })}</span></th>
        <th>${escHtml(t('prediction.stop'))}</th>
        ${headerCells(live)}
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="text-xs opacity-60 mt-1">${escHtml(t('prediction.zone', { zone: zoneLabel() }))}</p>`;
}
