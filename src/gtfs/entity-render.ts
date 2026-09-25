/**
 * Shared furniture for the object pages: escaping, entity links, the raw column
 * table, and the handful of formatters that have to agree across pages.
 *
 * Pages are rendered as HTML strings and mounted in one go, so every link is a
 * real `<a href>` carrying the target page's hash — middle-click and
 * copy-link-address work — plus a `data-nav` payload that the panel renderer
 * intercepts to navigate without a reload.
 */

import type { GTFSScheduled, RawRow, Route } from './scheduled';
import type { VehiclePosition } from './rt-types';
import type { FeedSession } from './feed-session';
import type { Prediction, VehicleStopSequence } from './rt-index';
import type { ResolvedEvent, StopTimeUpdate } from './stop-time-event';
import { presentNumber } from './rt-types';
import {
  clockAt,
  feedTimezone,
  formatScheduleTime,
  zoneLabel,
} from './feed-time';
import { escapeHtml } from '../util/escape-html';
import { TOOLTIP_TRIGGER_CLASS, tooltipContentAttr } from '../ui/field-label';

/**
 * The escaper every renderer here goes through, under the short name the pages
 * call it by. `escapeHtml` also escapes `'`, which the apps' own copy did not;
 * the rendered output is identical either way.
 */
export const escHtml = escapeHtml;

/**
 * A page identity, as far as these renderers are concerned: opaque apart from
 * its `type`. They hand it back to `href` and serialize it into `data-nav`;
 * what the variants are is the app's business.
 */
export interface PageRef {
  type: string;
}

/** The one page a renderer here builds a link to on its own, in `routeBadge`. */
export interface RoutePageRef {
  type: 'route';
  route_id: string;
}

/**
 * What a page renderer is handed: the session to read and the app's hash
 * builder.
 *
 * `S` is the app's own page-state union and `F` its own session class, both
 * wider than anything here reads. Each app aliases the pair once rather than
 * writing the parameters at every call site.
 */
export interface RenderContext<
  S extends PageRef = PageRef,
  F extends FeedSession = FeedSession,
> {
  session: F;
  /** The full hash for a page, supplied by AppState. */
  href: (state: S | RoutePageRef) => string;
}

/**
 * A link that navigates the panel rather than reloading the page.
 *
 * `iconHtml` is emitted raw before the label, for callers that need an svg icon
 * inside the anchor. The label itself is always escaped.
 */
export function entityLink<S extends PageRef>(
  ctx: RenderContext<S>,
  state: S,
  label: string,
  className = 'link link-hover',
  iconHtml = ''
): string {
  return `<a href="${escHtml(ctx.href(state))}" data-nav="${escHtml(
    JSON.stringify(state)
  )}" class="${className}">${iconHtml}${escHtml(label)}</a>`;
}

/**
 * A route's colored badge. `route_color` is feed-supplied and routinely
 * collides with the page background — white on light, black on dark — so every
 * badge carries a neutral hairline outline regardless of the color chosen.
 */
export function routeBadge<S extends PageRef>(
  ctx: RenderContext<S>,
  route: Route
): string {
  const label = route.short_name || route.long_name || route.id;
  return `<a href="${escHtml(ctx.href({ type: 'route', route_id: route.id }))}"
    data-nav="${escHtml(JSON.stringify({ type: 'route', route_id: route.id }))}"
    class="badge badge-sm font-semibold border-0 ring-1 ring-base-content/20"
    style="background:${escHtml(route.color)};color:${escHtml(route.text_color)}"
    >${escHtml(label)}</a>`;
}

export function section(title: string, body: string, extra = ''): string {
  if (!body) {
    return '';
  }
  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">${escHtml(title)}${extra}</h3>
      ${body}
    </section>`;
}

/**
 * Every column of the source row, verbatim.
 *
 * Empty values are shown as an explicit marker rather than omitted: "this
 * column exists and is blank" and "this column is absent" are different facts
 * about a feed, and the whole point of the table is to tell them apart.
 */
export function renderRawFields(
  title: string,
  raw: RawRow,
  open = false
): string {
  const rows = Object.entries(raw)
    .map(
      ([k, v]) =>
        `<tr><td class="opacity-60 align-top whitespace-nowrap">${escHtml(k)}</td><td class="break-all">${
          v ? escHtml(v) : '<span class="opacity-30">(empty)</span>'
        }</td></tr>`
    )
    .join('');
  return `
    <details class="text-xs rounded-lg border border-base-300 p-2" data-detail="raw:${escHtml(title)}"${
      open ? ' open' : ''
    }>
      <summary class="cursor-pointer font-medium">${escHtml(title)}</summary>
      <table class="table table-xs mt-1"><tbody>${rows}</tbody></table>
    </details>`;
}

/** The decoded protobuf entity, pretty-printed. */
export function renderRawJson(title: string, value: unknown): string {
  return `
    <details class="text-xs rounded-lg border border-base-300 p-2" data-detail="json:${escHtml(title)}">
      <summary class="cursor-pointer font-medium">${escHtml(title)}</summary>
      <pre class="mt-1 overflow-x-auto bg-base-200 rounded p-2">${escHtml(
        JSON.stringify(value, null, 2)
      )}</pre>
    </details>`;
}

// ─── Time ─────────────────────────────────────────────────────────────────────

/**
 * Clock time from a GTFS-RT epoch-seconds value, in the feed's zone (see
 * `feed-time.ts`) and labelled with it, so a time can never be read against
 * the wrong clock. Pass `withZone: false` where the surrounding text already
 * establishes the zone.
 */
export function formatEpochTime(
  seconds: number | undefined,
  withZone = true
): string {
  if (seconds === undefined) {
    return '—';
  }
  const clock = clockAt(seconds);
  return withZone ? `${clock} ${zoneLabel(seconds * 1000)}` : clock;
}

/** A scheduled `stop_times` clock time, formatted to match `formatEpochTime`. */
export function formatScheduledTime(
  value: string | undefined,
  withZone = true
): string {
  const clock = formatScheduleTime(value);
  if (!withZone || clock === '—') {
    return clock;
  }
  return `${clock} ${zoneLabel()}`;
}

export function formatAbsolute(seconds: number | undefined): string {
  if (seconds === undefined) {
    return '—';
  }
  const ms = seconds * 1000;
  return `${new Date(ms).toLocaleString([], { timeZone: feedTimezone() ?? undefined })} ${zoneLabel(ms)}`;
}

/** "12s ago" / "3m ago" — driven by the panel's shared ticker. */
export function formatRelative(ms: number): string {
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 0) {
    return `in ${formatDuration(-secs)}`;
  }
  if (secs < 60) {
    return `${secs}s ago`;
  }
  return `${formatDuration(secs)} ago`;
}

export function formatDuration(secs: number): string {
  const s = Math.abs(Math.round(secs));
  if (s < 60) {
    return `${s}s`;
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m`;
  }
  if (s < 86400) {
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/** A timestamp that also states its own age, refreshed in place by the ticker. */
export function timestampWithAge(seconds: number | undefined): string {
  if (seconds === undefined) {
    return '<span class="opacity-40">not reported</span>';
  }
  const ms = seconds * 1000;
  return `${escHtml(formatEpochTime(seconds))} <span class="opacity-60" data-since="${ms}">${escHtml(
    formatRelative(ms)
  )}</span>`;
}

// ─── Delay ────────────────────────────────────────────────────────────────────

/**
 * Signed delay, "+3m" / "-45s". Never rounded to "on time": a feed that says
 * 45 seconds late said 45 seconds late. Colour carries the judgement: under a
 * minute either way is green, five minutes late is where a rider would call it
 * late.
 */
export function formatDelay(seconds: number | undefined): string {
  if (seconds === undefined) {
    return '';
  }
  const cls =
    Math.abs(seconds) < 60
      ? 'text-success'
      : seconds < 0
        ? 'text-info'
        : seconds < 300
          ? 'text-warning'
          : 'text-error';
  return `<span class="${cls}">${escHtml(signedDuration(seconds))}</span>`;
}

function signedDuration(seconds: number): string {
  return `${seconds < 0 ? '-' : '+'}${formatDuration(seconds)}`;
}

/** "+3m 59s": the unrounded delay, for hovers. */
function exactDelay(seconds: number): string {
  const a = Math.abs(Math.round(seconds));
  const sign = seconds < 0 ? '-' : '+';
  if (a < 60) {
    return `${sign}${a}s`;
  }
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const rest = `${m}m ${a % 60}s`;
  return `${sign}${h ? `${h}h ` : ''}${rest}`;
}

// ─── Predictions ──────────────────────────────────────────────────────────────

/**
 * The events a prediction row shows: departure, or arrival where the feed
 * sent nothing for departure. Both when the feed sent both and they differ.
 * With nothing sent at all, the one carrying a schedule.
 */
function shownEvents(p: Prediction): ResolvedEvent[] {
  const a = p.arrivalEvent;
  const d = p.departureEvent;
  if (a.reported && d.reported && (a.time !== d.time || a.delay !== d.delay)) {
    return [a, d];
  }
  if (d.reported) {
    return [d];
  }
  if (a.reported) {
    return [a];
  }
  return [d.scheduledText ? d : a];
}

/** The one event a compact display shows: departure over arrival. */
export function primaryEvent(p: Prediction): ResolvedEvent {
  const events = shownEvents(p);
  return events[events.length - 1];
}

/** Classes marking a value as calculated rather than sent. */
export function derivedClass(from: ResolvedEvent['timeFrom']): string {
  return from === 'derived' ? ' italic opacity-70' : '';
}

const DELAY_COLOURS =
  '<span class="text-success">green</span> under 1m either way, <span class="text-warning">yellow</span> 1m to 5m late, <span class="text-error">red</span> 5m or more late, <span class="text-info">blue</span> 1m or more early';

const HEADER_TIPS = {
  sched:
    'Scheduled time from <code>stop_times.txt</code>, matched by <code>stop_sequence</code>. Struck through when the feed marks the stop SKIPPED.',
  pred: 'Predicted time. Plain when the feed sent <code>time</code>. <i>Italic</i> when the feed sent only <code>delay</code> and the time was calculated as scheduled + delay.',
  delay: `Delay, + late and - early, never rounded. Plain when the feed sent <code>delay</code>. <i>Italic</i> when the feed sent only <code>time</code> and the delay was calculated as predicted - scheduled.<br>${DELAY_COLOURS}.`,
};

function headerCell(label: string, tip: string): string {
  return `<th class="text-right"><span class="${TOOLTIP_TRIGGER_CLASS}" tabindex="0" ${tooltipContentAttr(tip)}>${escHtml(label)}</span></th>`;
}

/** The three header cells matching `predictionCells`, each explaining its column on hover. */
export function predictionHeaders(): string {
  const zone = zoneLabel();
  return [
    headerCell(`Sched ${zone}`, HEADER_TIPS.sched),
    headerCell(`Pred ${zone}`, HEADER_TIPS.pred),
    headerCell('Delay', HEADER_TIPS.delay),
  ].join('');
}

/**
 * One prediction as three table cells: scheduled, predicted, delay. Calculated
 * values are italic; skipped and no-data stops carry their badge in the delay
 * cell. All three cells open the same tooltip (`predictionTooltip`).
 */
export function predictionCells(p: Prediction): string {
  const skipped = p.scheduleRelationship === 1;
  const events = shownEvents(p);
  const label = (ev: ResolvedEvent) =>
    events.length > 1
      ? `<span class="opacity-50 mr-1">${ev.kind === 'arrival' ? 'arr' : 'dep'}</span>`
      : '';
  const lines = (render: (ev: ResolvedEvent) => string) =>
    events.map((ev) => `<div>${render(ev)}</div>`).join('');

  const sched = lines(
    (ev) =>
      `${label(ev)}<span class="opacity-50${skipped ? ' line-through' : ''}">${escHtml(
        ev.scheduledText ? formatScheduleTime(ev.scheduledText) : '—'
      )}</span>`
  );
  const pred = skipped
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
              ? ` <span class="opacity-60">+/-${escHtml(formatDuration(ev.uncertainty))}</span>`
              : ''
          }`
      );
  const mark = stopTimeRelationshipMark(p.scheduleRelationship);

  const tip = TOOLTIP_TRIGGER_CLASS;
  const attr = tooltipContentAttr(predictionTooltip(p));
  const cell = (body: string) =>
    `<td class="text-right whitespace-nowrap tabular-nums align-top ${tip}" ${attr}>${body}</td>`;
  return cell(sched) + cell(pred) + cell(`${delay}${mark}`);
}

function originNote(from: ResolvedEvent['timeFrom'], how: string): string {
  return from === 'derived'
    ? `<i>calculated: ${escHtml(how)}</i>`
    : 'from feed';
}

function tipRow(name: string, value: string, note: string): string {
  return `<tr><td class="opacity-70 pr-3">${escHtml(name)}</td><td class="pr-3 whitespace-nowrap">${value}</td><td class="opacity-70">${note}</td></tr>`;
}

function eventTooltip(ev: ResolvedEvent): string {
  const rows = [
    tipRow(
      'Scheduled',
      ev.scheduledText ? escHtml(formatScheduleTime(ev.scheduledText)) : 'none',
      ev.scheduledText
        ? `stop_times ${ev.kind}_time <code>${escHtml(ev.scheduledText)}</code>`
        : 'no matching stop_times row'
    ),
    tipRow(
      'Predicted',
      ev.time === undefined ? 'none' : escHtml(formatEpochTime(ev.time)),
      ev.time === undefined
        ? 'not sent'
        : originNote(ev.timeFrom, 'scheduled + delay, feed sent delay only')
    ),
    tipRow(
      'Delay',
      ev.delay === undefined ? 'none' : escHtml(exactDelay(ev.delay)),
      ev.delay === undefined
        ? 'not sent'
        : originNote(ev.delayFrom, 'predicted - scheduled, feed sent time only')
    ),
  ];
  if (ev.uncertainty !== undefined) {
    rows.push(tipRow('Uncertainty', `${ev.uncertainty}s`, 'from feed'));
  }
  return `<div class="font-semibold">${ev.kind === 'arrival' ? 'Arrival' : 'Departure'}</div><table>${rows.join('')}</table>`;
}

/**
 * The hover behind a prediction row: every value and where it came from, any
 * assumption made to calculate one, and the StopTimeUpdate as sent.
 */
export function predictionTooltip(p: Prediction): string {
  const events = [p.arrivalEvent, p.departureEvent].filter(
    (ev) => ev.reported || ev.scheduledText
  );
  const notes: string[] = [];
  const derived = events.some(
    (ev) => ev.timeFrom === 'derived' || ev.delayFrom === 'derived'
  );
  if (derived && p.schedule.serviceDateInferred) {
    notes.push(
      'The trip update has no <code>start_date</code>; the service date nearest the prediction was assumed.'
    );
  }
  if (p.schedule.ambiguousStop) {
    notes.push(
      `No <code>stop_sequence</code> sent and the trip calls at ${escHtml(p.stop_id)} more than once; the first visit was assumed.`
    );
  }
  const rel = p.scheduleRelationship;
  if (rel) {
    notes.push(
      `Stop is ${escHtml(STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS[rel] ?? String(rel))}: nothing calculated.`
    );
  } else if (p.tripScheduleRelationship) {
    notes.push(
      `Trip is ${escHtml(
        TRIP_SCHEDULE_RELATIONSHIP_LABELS[p.tripScheduleRelationship] ??
          String(p.tripScheduleRelationship)
      )}: nothing calculated.`
    );
  }
  return `<div class="space-y-2">${events.map(eventTooltip).join('')}${notes
    .map((n) => `<p>${n}</p>`)
    .join(
      ''
    )}<div class="font-semibold">Sent by the feed</div>${stopTimeUpdateFields(p.stu)}</div>`;
}

/**
 * The StopTimeUpdate fields exactly as sent. Absent fields say so rather than
 * showing the proto2 default.
 */
function stopTimeUpdateFields(stu: StopTimeUpdate): string {
  const absent = '<span class="opacity-50">absent</span>';
  const value = (msg: object | null | undefined, field: string): string => {
    const n = presentNumber(msg, field);
    return n === undefined ? absent : escHtml(String(n));
  };
  const time = (msg: object | null | undefined): string => {
    const n = presentNumber(msg, 'time');
    return n === undefined
      ? absent
      : `${escHtml(String(n))} <span class="opacity-70">${escHtml(formatEpochTime(n))}</span>`;
  };
  const rel = presentNumber(stu, 'scheduleRelationship');
  const rows: [string, string][] = [
    ['stop_sequence', value(stu, 'stopSequence')],
    ['stop_id', stu.stopId ? escHtml(stu.stopId) : absent],
    ['arrival.time', time(stu.arrival)],
    ['arrival.delay', value(stu.arrival, 'delay')],
    ['arrival.uncertainty', value(stu.arrival, 'uncertainty')],
    ['departure.time', time(stu.departure)],
    ['departure.delay', value(stu.departure, 'delay')],
    ['departure.uncertainty', value(stu.departure, 'uncertainty')],
    [
      'schedule_relationship',
      rel === undefined
        ? absent
        : escHtml(
            `${rel} ${STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS[rel] ?? ''}`.trim()
          ),
    ],
  ];
  return `<table class="font-mono">${rows
    .map(
      ([k, v]) => `<tr><td class="opacity-70 pr-3">${k}</td><td>${v}</td></tr>`
    )
    .join('')}</table>`;
}

// ─── Enum labels ──────────────────────────────────────────────────────────────

export const VEHICLE_STATUS_LABELS: Record<number, string> = {
  0: 'incoming at',
  1: 'stopped at',
  2: 'in transit to',
};

export const OCCUPANCY_LABELS: Record<number, string> = {
  0: 'Empty',
  1: 'Many seats available',
  2: 'Few seats available',
  3: 'Standing room only',
  4: 'Crushed standing room only',
  5: 'Full',
  6: 'Not accepting passengers',
  7: 'No data available',
  8: 'Not boardable',
};

export const TRIP_SCHEDULE_RELATIONSHIP_LABELS: Record<number, string> = {
  0: 'SCHEDULED',
  1: 'ADDED',
  2: 'UNSCHEDULED',
  3: 'CANCELED',
  4: 'REPLACEMENT',
  5: 'DUPLICATED',
  6: 'DELETED',
};

export const STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS: Record<number, string> = {
  0: 'SCHEDULED',
  1: 'SKIPPED',
  2: 'NO_DATA',
  3: 'UNSCHEDULED',
};

export const ROUTE_TYPE_LABELS: Record<number, string> = {
  0: 'Tram / light rail',
  1: 'Subway / metro',
  2: 'Rail',
  3: 'Bus',
  4: 'Ferry',
  5: 'Cable tram',
  6: 'Aerial lift',
  7: 'Funicular',
  11: 'Trolleybus',
  12: 'Monorail',
};

/**
 * The header every entity page opens with: the name, then the feed's own id
 * for it. One shape across pages, so the id is always in the same place and
 * the facts about the entity live in its properties region instead.
 *
 * `extra` is for a marker that has to sit with the name, e.g. a route badge.
 */
export function pageHeader(title: string, id: string, extra = ''): string {
  const heading = `<h2 class="text-lg font-semibold leading-tight whitespace-pre-wrap">${escHtml(
    title
  )}</h2>`;
  return `
    <div class="space-y-1">
      ${extra ? `<div class="flex items-center gap-2">${extra}${heading}</div>` : heading}
      <p class="text-xs opacity-60 font-mono break-words">${escHtml(id)}</p>
    </div>`;
}

/** A definition list row, used by every page's properties region. */
export function prop(label: string, valueHtml: string): string {
  return `
    <div class="flex justify-between gap-3">
      <dt class="opacity-60 shrink-0">${escHtml(label)}</dt>
      <dd class="text-right break-words">${valueHtml}</dd>
    </div>`;
}

export function propList(rows: string[]): string {
  const body = rows.filter(Boolean).join('');
  return body ? `<dl class="text-xs space-y-1">${body}</dl>` : '';
}

export function missing(what: string): string {
  return `<p class="text-sm opacity-60">${escHtml(what)} is not in the loaded feed.</p>`;
}

/**
 * Marks a value the app worked out from the feed rather than one the feed
 * reported. These tools exist to show what a feed says, so anything inferred
 * has to carry this wherever it is shown.
 */
export function badgeMark(label: string, title: string): string {
  return `<span class="badge badge-ghost badge-xs align-middle" title="${escHtml(title)}">${escHtml(label)}</span>`;
}

/**
 * Marks a fact the feed reported, as against `badgeMark`'s inferred values. The two
 * must stay visually distinct: a reader has to be able to tell what the producer said
 * from what the app worked out.
 */
export function feedMark(label: string, title: string): string {
  return `<span class="badge badge-outline badge-xs align-middle" title="${escHtml(title)}">${escHtml(label)}</span>`;
}

/** One explanation per trip relationship, so the wording is written once. */
const TRIP_RELATIONSHIP_TITLES: Record<number, string> = {
  1: 'The feed reports this trip as ADDED: it is not in the static schedule by design, not by omission.',
  2: 'The feed reports this trip as UNSCHEDULED: a frequency-based trip with exact_times=0.',
  3: 'The feed reports this trip as CANCELED: it will not run.',
  4: 'The feed reports this trip as REPLACEMENT: it replaces a scheduled trip (experimental).',
  5: 'The feed reports this trip as DUPLICATED: it duplicates a scheduled trip at a new time (experimental).',
  6: 'The feed reports this trip as DELETED: the producer states it should not be shown to users (experimental).',
};

/** One explanation per stop-time relationship. */
const STOP_TIME_RELATIONSHIP_TITLES: Record<number, string> = {
  1: 'The feed reports this stop as SKIPPED: the vehicle will not call there, so the times on this row are not times anyone can catch.',
  2: 'The feed reports NO_DATA for this stop: no prediction is given, and any time shown comes from the schedule.',
  3: 'The feed reports this stop as UNSCHEDULED: it is not in the static schedule for this trip (experimental).',
};

/** The badge for a trip's schedule_relationship, or '' when it is SCHEDULED or unreported. */
export function tripRelationshipMark(relationship: number | undefined): string {
  if (relationship === undefined || relationship === 0) {
    return '';
  }
  const label =
    TRIP_SCHEDULE_RELATIONSHIP_LABELS[relationship] ?? String(relationship);
  const title =
    TRIP_RELATIONSHIP_TITLES[relationship] ??
    `The feed reports this trip's schedule_relationship as ${label}.`;
  return feedMark(label, title);
}

/** The badge for a stop_time_update's schedule_relationship, or '' when SCHEDULED or unreported. */
export function stopTimeRelationshipMark(
  relationship: number | undefined
): string {
  if (relationship === undefined || relationship === 0) {
    return '';
  }
  const label =
    STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS[relationship] ??
    String(relationship);
  const title =
    STOP_TIME_RELATIONSHIP_TITLES[relationship] ??
    `The feed reports this stop's schedule_relationship as ${label}.`;
  return feedMark(label, title);
}

/** The standard explanation behind every derived `current_stop_sequence`. */
export const DERIVED_STOP_SEQUENCE_TITLE =
  'The feed reported no current_stop_sequence. This position comes from the soonest still-future stop_time_update on the same trip.';

/**
 * How a vehicle's position was arrived at, when that is worth saying.
 *
 * A `stop_id` the feed reported is not a guess and gets no mark — GTFS-RT lets a
 * producer name the current stop that way. The exception is a trip that calls at
 * that stop more than once, where choosing a visit *is* a guess and the reader
 * deserves to know which way it went.
 */
export function stopSequenceMark(
  v: VehiclePosition,
  current: VehicleStopSequence
): string {
  if (current.source === 'derived') {
    return badgeMark('derived', DERIVED_STOP_SEQUENCE_TITLE);
  }
  if (current.source === 'stop_id' && current.ambiguous) {
    return badgeMark(
      'ambiguous',
      `The feed reported no current_stop_sequence, only stop_id ${v.stopId}. This trip calls there more than once; the first visit was assumed.`
    );
  }
  return '';
}

/**
 * The name to *display* for a vehicle. Prefers the scheduled trip's
 * `trip_short_name` — for Amtrak this is the train number — then the trip
 * headsign, then the feed's `vehicle.label`, then the id. This is display-layer
 * only: the raw dump and the id field still show exactly what the feed sent.
 *
 * A feed that sets one `vehicle.label` for its whole fleet names nothing, which
 * is common enough to plan for; `trip_short_name` distinguishes them either way.
 */
export function vehicleDisplayName(
  feed: GTFSScheduled | null | undefined,
  v: VehiclePosition
): string {
  const trip = v.tripId ? feed?.trips.get(v.tripId) : undefined;
  const shortName = trip?.raw?.trip_short_name?.trim();
  if (shortName) {
    return shortName;
  }
  if (trip?.headsign) {
    return trip.headsign;
  }
  if (v.label) {
    return v.label;
  }
  return v.vehicleId || v.key;
}
