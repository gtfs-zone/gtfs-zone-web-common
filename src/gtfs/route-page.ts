/**
 * The route page: a vertical transit-map strip with live vehicles sitting in
 * the gaps between stops.
 *
 * The strip is a two-column CSS grid - rail, then content. Only the rail is an
 * SVG, and only one per row: the lines have to branch and merge, which CSS
 * cannot draw, but everything readable stays real HTML, so stop names are
 * selectable and every stop and vehicle is a real link. Row heights are
 * content-driven and unknown at render time, so each row's SVG stretches a
 * fixed 100-unit viewBox over whatever height it gets. Circles would come out
 * as ellipses under that scale, which is why the dots are HTML spans.
 */

import type { AlertRecord, TripUpdate, VehiclePosition } from './rt-types';
import { presentNumber } from './rt-types';
import type { GTFSScheduled, Route, Trip } from './scheduled';
import { alertsForRoute, alertsForRouteStop, feedWideAlerts } from './alerts';
import { renderTriangleIcon, renderWarningIcon } from '../ui/modal-utils';
import { GTFSScheduledRouteSource } from './scheduled-route-source';
import { routeGraph } from './route-graph';
import type { Prediction, RtIndex, VehicleStopSequence } from './rt-index';
import type { DirectionInfo, RouteSequence, StopStats } from './route-sequence';
import { directionsForRoute, routeSequence } from './route-sequence';
import {
  endpointNote,
  endpointThreshold,
  gutterWidth,
  isEndpoint,
  isMinority,
  railCell,
  renderCoverage,
  renderDirectionSections,
  rowPaths,
  STRIP_ROW_CLASS,
} from './route-strip';
import type { RowDot } from './route-strip';
import { TOOLTIP_TRIGGER_CLASS, tooltipContentAttr } from '../ui/field-label';
import type { PageRef, RenderContext } from './entity-render';
import {
  OCCUPANCY_LABELS,
  TRIP_SCHEDULE_RELATIONSHIP_LABELS,
  VEHICLE_STATUS_LABELS,
  derivedClass,
  entityLink,
  escHtml,
  formatDelay,
  formatDuration,
  formatEpochTime,
  formatScheduledTime,
  predictionTooltip,
  primaryEvent,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  routeTypeLabel,
  stopSequenceMark,
  tripRelationshipMark,
  vehicleDisplayName,
} from './entity-render';
import { entityRow, entityRowList } from './entity-row';
import { alertListOptions } from './alert-page';
import type { RtPageHooks, RtPageRef } from './rt-page';
import { feedServiceDate, formatServiceDate } from './feed-time';
import {
  descriptorFields,
  tripLocationFor,
  updateTripLocation,
  type TripLocation,
} from './tree-location';
import { listSection, type TreePage, type TreeSection } from './tree-page';
import { t } from '../i18n/messages';

export interface RoutePageOptions<
  S extends PageRef,
  V extends VehiclePosition,
> extends RtPageHooks<S, V> {
  /** The page the route's agency links to; plain text when absent. */
  agencyLink?: (agencyId: string) => S;
  /** Appended to each direction's strip. */
  directionExtra?: (routeId: string, directionId: string) => string;
  /** Sections inserted before the raw dump. */
  extraSections?: (route: Route) => TreeSection[];
}

/** The context every renderer here shares. */
interface Page<S extends PageRef, V extends VehiclePosition> {
  ctx: RenderContext<S | RtPageRef>;
  rt: RtIndex<V>;
  hooks: RoutePageOptions<S, V>;
}

/** A vehicle that could not be put on the strip, and why not. */
interface Unplaced<V extends VehiclePosition> {
  vehicle: V;
  reason: string;
  /** Trip schedule_relationship, when the feed gave one that explains the placement. */
  relationship?: number;
}

interface PlacedVehicle<V extends VehiclePosition> {
  vehicle: V;
  position: number;
  /** STOPPED_AT sits on the stop; everything else sits in the gap before it. */
  atStop: boolean;
  /** Where the stop_sequence behind this position came from. */
  current: VehicleStopSequence;
}

// --- Vehicle placement --------------------------------------------------------

/**
 * Put each of the route's vehicles on the strip.
 *
 * The subtle part: a vehicle reports `current_stop_sequence` in its *own
 * trip's* numbering, while the strip is numbered by the supersequence. The
 * value has to be looked up in the trip's `stop_times` to get an index, then
 * that index mapped through the alignment of the trip's pattern. Skipping
 * either step puts vehicles at plausible-looking but wrong stops.
 *
 * A vehicle that never reported the field can still be placed from the `stop_id`
 * it did report, or failing that from its trip's predictions - see
 * `RtIndex.stopSequenceFor`. The resolution rides along on each placement so the
 * chip can say where the position came from.
 */
function placeVehicles<S extends PageRef, V extends VehiclePosition>(
  { ctx, rt }: Page<S, V>,
  sequence: RouteSequence,
  routeId: string,
  directionId: string
): { placed: PlacedVehicle<V>[]; unplaced: Unplaced<V>[] } {
  const feed = ctx.session.scheduledFeed;
  const placed: PlacedVehicle<V>[] = [];
  const unplaced: Unplaced<V>[] = [];

  for (const vehicle of rt.vehiclesByRoute.get(routeId) ?? []) {
    const trip = vehicle.tripId ? feed?.trips.get(vehicle.tripId) : undefined;

    if (trip && (trip.direction_id ?? '') !== directionId) {
      continue;
    }
    if (!trip) {
      // A vehicle whose trip we cannot resolve might belong to either
      // direction, so it is listed rather than guessed onto this one.
      const relationship = vehicle.scheduleRelationship;
      const reported =
        relationship !== undefined && relationship !== 0
          ? (TRIP_SCHEDULE_RELATIONSHIP_LABELS[relationship] ??
            String(relationship))
          : '';
      unplaced.push({
        vehicle,
        reason: !vehicle.tripId
          ? t('route.unplacedNoTrip')
          : reported
            ? t('route.unplacedTripReported', {
                trip: vehicle.tripId,
                relationship: reported,
              })
            : t('route.unplacedTrip', { trip: vehicle.tripId }),
        relationship,
      });
      continue;
    }

    const current = rt.stopSequenceFor(vehicle);
    if (!current) {
      unplaced.push({
        vehicle,
        reason: t('route.unplacedNoSequence'),
      });
      continue;
    }

    const times = feed?.stopTimesByTrip.get(trip.trip_id) ?? [];
    const stopIndex = times.findIndex(
      (t) => t.stop_sequence === current.sequence
    );
    if (stopIndex < 0) {
      unplaced.push({
        vehicle,
        reason: t('route.unplacedSequence', { sequence: current.sequence }),
      });
      continue;
    }

    const position = sequence.positionOf(trip.trip_id, stopIndex);
    if (position === null) {
      unplaced.push({
        vehicle,
        reason: t('route.unplacedPattern'),
      });
      continue;
    }

    placed.push({
      vehicle,
      position,
      atStop: vehicle.currentStatus === 1,
      current,
    });
  }

  return { placed, unplaced };
}

// --- Strip rendering ----------------------------------------------------------

/**
 * `stopId` marks the row as a stop row rather than a vehicle-chip gap row, so
 * hovering it scales that stop's dot. The stop name is already a link, so the
 * dot itself stays decoration here.
 */
function stripRow(
  railHtml: string,
  content: string,
  laneCount: number,
  stopId?: string
): string {
  const rowAttrs = stopId ? ` data-stop-id="${escHtml(stopId)}"` : '';
  return `<div class="grid gap-2 items-stretch ${
    stopId ? STRIP_ROW_CLASS : ''
  }" style="grid-template-columns:${gutterWidth(laneCount)}px 1fr"${rowAttrs}>
    ${railHtml}
    <div class="py-1 min-h-8 flex flex-col justify-center">${content}</div>
  </div>`;
}

/**
 * "2m" until the predicted time, or the clock time when it is further out, and
 * the delay. Calculated values are italic; the hover is the prediction row's.
 */
function eta(prediction: Prediction | undefined): string {
  if (!prediction) {
    return '';
  }
  const ev = primaryEvent(prediction);
  const parts: string[] = [];
  if (ev.time !== undefined) {
    const secs = ev.time - Date.now() / 1000;
    const cls = `tabular-nums${derivedClass(ev.timeFrom)}`;
    parts.push(
      secs < 0
        ? `<span class="${cls} opacity-60">${escHtml(t('route.ago', { duration: formatDuration(secs) }))}</span>`
        : secs < 3600
          ? `<span class="${cls}">${escHtml(formatDuration(secs))}</span>`
          : `<span class="${cls}">${escHtml(formatEpochTime(ev.time))}</span>`
    );
  }
  if (ev.delay !== undefined) {
    parts.push(
      `<span class="${derivedClass(ev.delayFrom).trim()}">${formatDelay(ev.delay)}</span>`
    );
  }
  return parts.length
    ? `<span class="text-xs flex gap-2 shrink-0 ${TOOLTIP_TRIGGER_CLASS}" tabindex="0" ${tooltipContentAttr(
        predictionTooltip(prediction)
      )}>${parts.join('')}</span>`
    : '';
}

function vehicleChip<S extends PageRef, V extends VehiclePosition>(
  { ctx, hooks }: Page<S, V>,
  vehicle: V,
  current: VehicleStopSequence
): string {
  const label = vehicleDisplayName(ctx.session.scheduledFeed, vehicle);
  const status =
    vehicle.currentStatus === undefined
      ? ''
      : `<span class="opacity-60">${escHtml(VEHICLE_STATUS_LABELS[vehicle.currentStatus] ?? String(vehicle.currentStatus))}</span>`;
  const occupancy =
    vehicle.occupancyStatus === undefined
      ? ''
      : `<span class="opacity-60">${escHtml(
          OCCUPANCY_LABELS[vehicle.occupancyStatus] ??
            String(vehicle.occupancyStatus)
        )}</span>`;
  return `<div class="text-xs flex items-center gap-1 flex-wrap">
    <span class="badge badge-xs badge-neutral">${renderTriangleIcon('h-2 w-2')}</span>
    ${entityLink(ctx, hooks.vehicleLink(vehicle), label, 'link link-hover font-medium')}
    ${status ? `<span class="opacity-40">-</span>${status}` : ''}
    ${occupancy ? `<span class="opacity-40">-</span>${occupancy}` : ''}
    ${stopSequenceMark(vehicle, current)}
    ${tripRelationshipMark(vehicle.scheduleRelationship)}
  </div>`;
}

function alertPips(
  ctx: RenderContext<RtPageRef>,
  alerts: AlertRecord[]
): string {
  if (alerts.length === 0) {
    return '';
  }
  const first = alerts[0];
  const label = t('route.alertCount', { count: alerts.length });
  return entityLink(
    ctx,
    { type: 'alert', alert_id: first.id },
    label,
    'badge badge-warning badge-xs shrink-0 gap-1',
    renderWarningIcon('h-3 w-3')
  );
}

function endpointNoteHtml(stats: StopStats, threshold: number): string {
  const note = endpointNote(stats, threshold);
  return note
    ? `<span class="text-xs opacity-60 tabular-nums shrink-0">${escHtml(note)}</span>`
    : '';
}

function renderStrip<S extends PageRef, V extends VehiclePosition>(
  page: Page<S, V>,
  route: Route,
  sequence: RouteSequence,
  directionId: string,
  placed: PlacedVehicle<V>[]
): string {
  const { ctx, rt } = page;
  const feed = ctx.session.scheduledFeed;
  if (sequence.stops.length === 0) {
    return `<p class="text-sm opacity-60">${t('route.noStripTrips')}</p>`;
  }

  const before = new Map<number, PlacedVehicle<V>[]>();
  const at = new Map<number, PlacedVehicle<V>[]>();
  for (const p of placed) {
    const bucket = p.atStop ? at : before;
    const list = bucket.get(p.position);
    if (list) {
      list.push(p);
    } else {
      bucket.set(p.position, [p]);
    }
  }

  const graph = routeGraph(sequence);

  // Rows are collected first so the terminal caps can be put on whichever rows
  // actually end up at the ends - a vehicle above the first stop pushes the cap
  // down onto its own row.
  const rows: Array<{
    dot: RowDot;
    paths: string[];
    content: string;
    stopId?: string;
  }> = [];

  const threshold = endpointThreshold(sequence.totalTrips);

  sequence.stops.forEach((stop, index) => {
    const chipsBefore = before.get(index) ?? [];
    const chipsAt = at.get(index) ?? [];
    chipsBefore.forEach((p, n) => {
      rows.push({
        dot: { kind: 'none' },
        paths: rowPaths(graph, index, {
          kind: 'gap',
          side: 'above',
          last: n === 0,
        }),
        content: vehicleChip(page, p.vehicle, p.current),
      });
    });

    // Every strip element is a stop ref here: the realtime apps ingest no flex tables.
    const stopId = stop.ref.id;
    const name = feed?.stops.get(stopId)?.name || stopId;
    // The strip shows stations; the realtime feed talks about platforms. Ask
    // for the station and everything under it, the same split the station page
    // makes between boardable descendants (service) and all of them (alerts).
    const serviceIds = [stopId, ...(feed?.boardableDescendants(stopId) ?? [])];
    const alertIds = [stopId, ...(feed?.descendants(stopId) ?? [])];
    const prediction = rt.nextAtStopsForRoute(
      serviceIds,
      route.id,
      directionId,
      feed ?? null
    );
    const stopAlerts = alertsForRouteStop(ctx.session, route.id, alertIds);

    const stats = sequence.stopStats[index];
    const endpoint = isEndpoint(stats, threshold);
    const minority = isMinority(stats, sequence.totalTrips);

    rows.push({
      stopId: stopId,
      dot: { kind: endpoint ? 'solid' : 'open', lane: graph.rows[index].lane },
      paths: rowPaths(graph, index, {
        kind: 'stop',
        leadIn: chipsBefore.length > 0,
        leadOut: chipsAt.length > 0,
      }),
      content: `<div class="flex items-center gap-2" title="${escHtml(
        t('route.servedBy', {
          serves: stats.serves,
          total: sequence.totalTrips,
        })
      )}">
        <span class="flex-1 min-w-0 truncate text-sm${minority ? ' opacity-60' : ''}">${entityLink(
          ctx,
          { type: 'stop', stop_id: stopId },
          name
        )}${
          stop.occurrence > 0
            ? `<span class="opacity-50 text-xs ml-1">${escHtml(t('route.visit', { n: stop.occurrence + 1 }))}</span>`
            : ''
        }</span>
        ${endpointNoteHtml(stats, threshold)}
        ${
          minority
            ? `<span class="text-xs opacity-50 tabular-nums shrink-0">${escHtml(
                t('route.servesOf', {
                  serves: stats.serves,
                  total: sequence.totalTrips,
                })
              )}</span>`
            : ''
        }
        ${alertPips(ctx, stopAlerts)}
        ${eta(prediction)}
      </div>`,
    });

    chipsAt.forEach((p, n) => {
      rows.push({
        dot: { kind: 'none' },
        paths: rowPaths(graph, index, {
          kind: 'gap',
          side: 'below',
          last: n === chipsAt.length - 1,
        }),
        content: vehicleChip(page, p.vehicle, p.current),
      });
    });
  });

  return `<div class="-mx-1">${rows
    .map((row) =>
      stripRow(
        railCell(route.color, graph.laneCount, row.paths, row.dot),
        row.content,
        graph.laneCount,
        row.stopId
      )
    )
    .join('')}</div>`;
}

// --- Unplaced notes -----------------------------------------------------------

function renderUnplaced<S extends PageRef, V extends VehiclePosition>(
  { ctx, hooks }: Page<S, V>,
  unplaced: Unplaced<V>[]
): string {
  if (unplaced.length === 0) {
    return '';
  }
  return `<div class="space-y-1">
    <p class="text-xs opacity-60">${t('route.unplaced')}</p>
    ${entityRowList(
      unplaced.map((u) =>
        entityRow(ctx, {
          state: hooks.vehicleLink(u.vehicle),
          label: vehicleDisplayName(ctx.session.scheduledFeed, u.vehicle),
          sublabel: u.reason,
          badgeHtml: tripRelationshipMark(u.relationship),
        })
      ),
      ''
    )}
  </div>`;
}

// --- Trips --------------------------------------------------------------------

/** One row of a direction's Trips list. */
interface TripRow {
  tripId: string;
  trip?: Trip;
  /** First departure, `HH:MM:SS`; empty for a trip outside the schedule. */
  departure: string;
  update?: TripUpdate;
  loc?: TripLocation;
}

/** The update for a trip on `date`: an undated update counts for any day. */
function updateOn(
  rt: RtIndex,
  tripId: string,
  date: string
): TripUpdate | undefined {
  const update = rt.updateByTrip.get(tripId);
  const startDate = update?.trip?.startDate;
  return update && (!startDate || startDate === date) ? update : undefined;
}

/** The trip-level delay, else the delay at the trip's next predicted stop. */
function tripDelay(
  rt: RtIndex,
  tripId: string,
  update: TripUpdate
): number | undefined {
  const delay = presentNumber(update, 'delay');
  if (delay !== undefined) {
    return delay;
  }
  const now = Date.now() / 1000;
  for (const p of rt.predictionsByTrip.get(tripId) ?? []) {
    if (p.update !== update) {
      continue;
    }
    const ev = primaryEvent(p);
    if (ev.delay !== undefined && (ev.time === undefined || ev.time >= now)) {
      return ev.delay;
    }
  }
  return undefined;
}

/** Canceled, added and the like, then the delay. */
function realtimeMark(rt: RtIndex, row: TripRow): string {
  if (!row.update) {
    return '';
  }
  const relationship = presentNumber(row.update.trip, 'scheduleRelationship');
  const delay =
    relationship === CANCELED
      ? undefined
      : tripDelay(rt, row.tripId, row.update);
  return `<span class="flex items-center gap-1 text-xs whitespace-nowrap">${tripRelationshipMark(
    relationship
  )}${formatDelay(delay)}</span>`;
}

/** TripDescriptor.ScheduleRelationship CANCELED. */
const CANCELED = 3;

/**
 * The route's trips on the service day, per direction, plus the trip updates
 * on the route whose trip the schedule does not have (added trips).
 */
function tripRows(
  feed: GTFSScheduled,
  rt: RtIndex,
  route: Route,
  date: string,
  directions: DirectionInfo[]
): Map<string, TripRow[]> | null {
  const day = feed.routeDay(route.id, date);
  if (!day) {
    return null;
  }
  const byDirection = new Map<string, TripRow[]>(
    directions.map((d) => [d.direction_id, []])
  );
  const fallback = directions[0]?.direction_id ?? '';
  const push = (directionId: string, row: TripRow): void => {
    let list = byDirection.get(directionId) ?? byDirection.get(fallback);
    if (!list) {
      byDirection.set(fallback, (list = []));
    }
    list.push(row);
  };
  for (const { trip_id, departure } of day) {
    const trip = feed.findTrip(trip_id, route.id);
    push(trip?.direction_id ?? '', {
      tripId: trip_id,
      trip,
      departure,
      update: updateOn(rt, trip_id, date),
      loc: tripLocationFor({ tripId: trip_id, startDate: date }, route.id),
    });
  }
  for (const update of rt.updateByTrip.values()) {
    const desc = descriptorFields(update.trip);
    if (
      desc.routeId !== route.id ||
      !desc.tripId ||
      feed.findTrip(desc.tripId, route.id)
    ) {
      continue;
    }
    push(
      desc.directionId === undefined || desc.directionId === null
        ? fallback
        : String(desc.directionId),
      {
        tripId: desc.tripId,
        departure: '',
        update,
        loc: updateTripLocation(feed, update),
      }
    );
  }
  return byDirection;
}

function loadingLine(text: string): string {
  return `<div class="flex items-center gap-2 text-xs opacity-70">
      <span class="loading loading-spinner loading-xs"></span>
      ${escHtml(text)}
    </div>`;
}

function tripListSection<S extends PageRef, V extends VehiclePosition>(
  { ctx, rt, hooks }: Page<S, V>,
  title: string,
  key: string,
  rows: TripRow[] | null
): TreeSection {
  if (rows === null) {
    return { key, title, body: loadingLine(t('route.loadingTrips')) };
  }
  return listSection(
    title,
    {
      name: 'route-trips',
      items: rows,
      row: (row) =>
        entityRow<S>(ctx, {
          state: row.loc ? hooks.tripLink?.(row.loc) : undefined,
          leadHtml: `<span class="text-xs tabular-nums opacity-70 w-10 shrink-0">${escHtml(
            row.departure ? formatScheduledTime(row.departure, false) : ''
          )}</span>`,
          label: row.trip?.headsign || row.tripId,
          sublabel: row.trip?.raw.trip_short_name?.trim() || undefined,
          badgeHtml: realtimeMark(rt, row) || undefined,
        }),
      searchText: (row) =>
        `${row.departure} ${row.trip?.headsign ?? ''} ${row.trip?.raw.trip_short_name ?? ''} ${row.tripId}`,
      empty: t('route.noTrips'),
    },
    { key }
  );
}

// --- Page ---------------------------------------------------------------------

/** The Mode row value: the vocab label, or the raw route_type when the code is unknown. */
function modeLabel(routeType: number): string {
  const label = routeTypeLabel(routeType);
  if (label === undefined) {
    console.warn(
      `[RoutePage] Unknown route_type ${routeType}, showing the raw code`
    );
    return t('route.typeCode', { code: routeType });
  }
  return label;
}

/** Alerts on the route, then those naming no route, stop or trip. */
function routeAlerts<S extends PageRef>(
  ctx: RenderContext<S | RtPageRef>,
  routeId: string
): AlertRecord[] {
  const own = alertsForRoute(ctx.session, routeId);
  const ids = new Set(own.map((r) => r.id));
  return [...own, ...feedWideAlerts(ctx.session).filter((r) => !ids.has(r.id))];
}

/** A route: its strip with live vehicles, the day's trips, vehicles and alerts. */
export function routePage<S extends PageRef, V extends VehiclePosition>(
  ctx: RenderContext<S | RtPageRef>,
  rt: RtIndex<V>,
  routeId: string,
  options: RoutePageOptions<S, V>
): TreePage {
  const feed = ctx.session.scheduledFeed;
  const route = feed?.routes.get(routeId);
  const eyebrow = t('crumb.route');
  if (!feed || !route) {
    return {
      eyebrow,
      title: routeId,
      sections: [
        {
          body: `<p class="text-sm opacity-60">${escHtml(t('route.missing', { id: routeId }))}</p>`,
        },
      ],
    };
  }
  const page: Page<S, V> = { ctx, rt, hooks: options };
  const date = feedServiceDate(Date.now());

  // Both reads fire `dataloaded`, which re-renders the page.
  const loaded = feed.routeLoaded(route.id);
  if (!loaded) {
    feed.loadRoute(route.id).catch((err) => {
      console.error(`[RoutePage] loading route ${route.id} failed`, err);
    });
  }
  if (!feed.routeDay(route.id, date)) {
    feed.loadRouteDay(route.id, date).catch((err) => {
      console.error(
        `[RoutePage] loading route ${route.id} trips on ${date} failed`,
        err
      );
    });
  }

  const agency =
    feed.agencies.find((a) => a.id === route.agency_id) ??
    (feed.agencies.length === 1 ? feed.agencies[0] : undefined);
  const agencyName = agency ? agency.name || agency.id : '';

  const source = new GTFSScheduledRouteSource(feed);
  const directions = loaded ? directionsForRoute(source, route.id) : [];
  const strip = loaded
    ? renderDirectionSections(directions, (d) => {
        const sequence = routeSequence(source, route.id, d.direction_id);
        const { placed, unplaced } = placeVehicles(
          page,
          sequence,
          route.id,
          d.direction_id
        );
        return `
          ${renderCoverage(sequence)}
          ${renderStrip(page, route, sequence, d.direction_id, placed)}
          ${renderUnplaced(page, unplaced)}
          ${options.directionExtra?.(route.id, d.direction_id) ?? ''}`;
      })
    : loadingLine(t('route.loadingStops'));

  const rows = loaded ? tripRows(feed, rt, route, date, directions) : null;
  const tripsTitle = t('route.tripsOn', { date: formatServiceDate(date) });
  const tripSections =
    rows === null || directions.length <= 1
      ? [
          tripListSection(
            page,
            tripsTitle,
            'route-trips',
            rows && [...rows.values()].flat()
          ),
        ]
      : directions.map((d) =>
          tripListSection(
            page,
            `${tripsTitle} - ${d.label}`,
            `route-trips-${d.direction_id}`,
            rows.get(d.direction_id) ?? []
          )
        );

  const vehicles = rt.vehiclesByRoute.get(route.id) ?? [];

  return {
    eyebrow,
    title: route.long_name || route.short_name || route.id,
    id: route.id,
    titleExtra: routeBadge(ctx, route),
    sections: [
      {
        body: propList([
          prop(t('route.mode'), escHtml(modeLabel(route.type))),
          agency
            ? prop(
                t('route.agency'),
                options.agencyLink
                  ? entityLink(ctx, options.agencyLink(agency.id), agencyName)
                  : escHtml(agencyName)
              )
            : '',
        ]),
      },
      { title: t('route.stops'), body: strip },
      ...tripSections,
      listSection(t('route.vehicles'), {
        name: 'route-vehicles',
        items: vehicles,
        row: (v) =>
          entityRow<S>(ctx, {
            state: options.vehicleLink(v),
            label: vehicleDisplayName(feed, v),
            sublabel: v.tripId
              ? feed.findTrip(v.tripId, route.id)?.headsign || v.tripId
              : undefined,
            badge:
              v.currentStatus === undefined
                ? undefined
                : VEHICLE_STATUS_LABELS[v.currentStatus],
            leadHtml: tripRelationshipMark(v.scheduleRelationship) || undefined,
          }),
        empty: t('route.noVehicles'),
      }),
      listSection(
        t('route.alerts'),
        alertListOptions(ctx, routeAlerts(ctx, route.id), t('alerts.noneHere'))
      ),
      ...(options.extraSections?.(route) ?? []),
      { body: renderRawFields('routes.txt', route.raw) },
    ],
  };
}
