/**
 * The Trip page: one trip's schedule, its trip update and its vehicles. Built
 * from the scheduled trip when the schedule has it, else from the trip update
 * and vehicles that name it.
 *
 * Clock times come straight from the `stop_times` strings, since GTFS times
 * run past 24:00 on an overnight trip.
 */

import type { FeedSession } from './feed-session';
import type { Prediction, RtIndex } from './rt-index';
import type { TripUpdate, VehiclePosition } from './rt-types';
import { presentNumber } from './rt-types';
import type { GTFSScheduled, Route, Trip } from './scheduled';
import type { LinkContext, RenderContext } from './entity-render';
import type { StopPageRef } from './breadcrumbs';
import {
  TRIP_SCHEDULE_RELATIONSHIP_LABELS,
  entityLink,
  escHtml,
  formatDelay,
  formatRelative,
  optionalProp,
  prop,
  propList,
  renderRawFields,
  renderRawJson,
  routeBadge,
  tripRelationshipMark,
  vehicleDisplayName,
} from './entity-render';
import { entityRow } from './entity-row';
import { alertsForRoute, alertsForTrip } from './alerts';
import { alertListOptions } from './alert-page';
import { formatServiceDate } from './feed-time';
import { renderPredictionTable } from './prediction-table';
import { STRIP_ROW_CLASS } from './route-strip';
import { serviceSection } from './service-days';
import {
  descriptorFields,
  tripMatches,
  type TreeLocation,
  type TripLocation,
} from './tree-location';
import { listSection, type TreePage, type TreeSection } from './tree-page';
import { t } from '../i18n/messages';

type Ctx = RenderContext<TreeLocation>;

/** The first trip update in the last poll that names the trip. */
function tripUpdateFor(
  session: FeedSession,
  loc: TripLocation
): TripUpdate | undefined {
  return session.tripUpdates.find((u) =>
    tripMatches(loc, descriptorFields(u.trip))
  );
}

/** The vehicles in the last poll running the trip. */
function tripVehicles<V extends VehiclePosition>(
  session: FeedSession<V>,
  loc: TripLocation
): V[] {
  return [...session.vehicles.values()].filter((v) => tripMatches(loc, v));
}

/** Whether the last poll names the trip, in a trip update or a vehicle. */
export function tripInRealtime(
  session: FeedSession,
  loc: TripLocation
): boolean {
  return (
    tripUpdateFor(session, loc) !== undefined ||
    [...session.vehicles.values()].some((v) => tripMatches(loc, v))
  );
}

/** A prediction's stop cell: a link when the schedule has the stop. */
function stopCell(
  ctx: LinkContext<StopPageRef>,
  feed: GTFSScheduled | null,
  stopId: string
): string {
  const stop = feed?.stops.get(stopId);
  return stop
    ? entityLink(ctx, { type: 'stop', stop_id: stop.id }, stop.name || stop.id)
    : `<span class="font-mono">${escHtml(stopId)}</span>`;
}

/**
 * The trip's stop_times with its predictions laid alongside. A loop trip calls
 * at a stop twice, so a prediction is matched by stop_sequence where the
 * producer gave one, else by the first one for its stop.
 */
export function tripStopTimesTable(
  ctx: LinkContext<StopPageRef>,
  feed: GTFSScheduled,
  trip: Trip,
  predictions: Prediction[],
  currentSequence?: number
): string {
  const times = feed.stopTimesByTrip.get(trip.trip_id) ?? [];
  if (times.length === 0) {
    return `<p class="text-xs opacity-60">${t('trip.noStopTimes')}</p>`;
  }
  const bySequence = new Map<number, Prediction>();
  const byStop = new Map<string, Prediction>();
  for (const p of predictions) {
    if (p.stop_sequence !== undefined && !bySequence.has(p.stop_sequence)) {
      bySequence.set(p.stop_sequence, p);
    }
    if (!byStop.has(p.stop_id)) {
      byStop.set(p.stop_id, p);
    }
  }
  return `<div class="overflow-x-auto">${renderPredictionTable(
    times.map((time) => ({
      sequence: time.stop_sequence,
      stopHtml: stopCell(ctx, feed, time.stop_id),
      prediction:
        bySequence.get(time.stop_sequence) ?? byStop.get(time.stop_id),
      scheduled: {
        arrival: time.arrival_time || undefined,
        departure: time.departure_time || undefined,
      },
      current: time.stop_sequence === currentSequence,
      rowClass: STRIP_ROW_CLASS,
      rowAttrs: `data-stop-id="${escHtml(time.stop_id)}"`,
    }))
  )}</div>`;
}

/** The predictions alone, for a trip the schedule does not have. */
function predictionsTable(
  ctx: Ctx,
  predictions: Prediction[],
  currentSequence?: number
): string {
  if (predictions.length === 0) {
    return `<p class="text-xs opacity-60">${t('trip.noPredictions')}</p>`;
  }
  return `<div class="overflow-x-auto">${renderPredictionTable(
    predictions.map((p) => ({
      sequence: p.stop_sequence,
      stopHtml: stopCell(ctx, ctx.session.scheduledFeed, p.stop_id),
      prediction: p,
      current:
        currentSequence !== undefined && p.stop_sequence === currentSequence,
      rowClass: STRIP_ROW_CLASS,
      rowAttrs: `data-stop-id="${escHtml(p.stop_id)}"`,
    }))
  )}</div>`;
}

function mono(value: string): string {
  return `<span class="font-mono">${escHtml(value)}</span>`;
}

/** What the trip update says about the trip as a whole. */
function updateSection(update: TripUpdate | undefined): TreeSection {
  const title = t('trip.update');
  if (!update) {
    return {
      title,
      body: `<p class="text-xs opacity-60">${t('trip.noUpdate')}</p>`,
    };
  }
  const relationship = presentNumber(update.trip, 'scheduleRelationship');
  const timestamp = presentNumber(update, 'timestamp');
  const delay = presentNumber(update, 'delay');
  const props = update.tripProperties;
  return {
    title,
    body: propList([
      relationship === undefined
        ? ''
        : prop(
            t('trip.relationship'),
            escHtml(
              TRIP_SCHEDULE_RELATIONSHIP_LABELS[relationship] ??
                String(relationship)
            )
          ),
      timestamp === undefined
        ? ''
        : prop(
            t('trip.updated'),
            `<span data-since="${timestamp * 1000}">${escHtml(formatRelative(timestamp * 1000))}</span>`
          ),
      delay === undefined
        ? ''
        : prop(t('trip.delay'), escHtml(formatDelay(delay))),
      optionalProp(
        t('trip.newTripId'),
        props?.tripId ? mono(props.tripId) : ''
      ),
      optionalProp(
        t('trip.newStart'),
        escHtml(
          [
            props?.startDate ? formatServiceDate(props.startDate) : '',
            props?.startTime ?? '',
          ]
            .filter(Boolean)
            .join(' ')
        )
      ),
      optionalProp(t('trip.headsign'), escHtml(props?.tripHeadsign ?? '')),
      optionalProp(t('trip.shortName'), escHtml(props?.tripShortName ?? '')),
      optionalProp(t('trip.shape'), props?.shapeId ? mono(props.shapeId) : ''),
    ]),
  };
}

export interface TripPageOptions {
  /** First weekday of the service line, 0 for Sunday. Monday by default. */
  weekStart?: number;
  /** Sections inserted before the raw dumps. */
  extraSections?: TreeSection[];
}

/** A trip by its location: schedule, trip update and vehicles. */
export function tripPage(
  ctx: Ctx,
  rt: RtIndex,
  loc: TripLocation,
  options: TripPageOptions = {}
): TreePage {
  const session = ctx.session;
  const feed = session.scheduledFeed;
  const tripId = loc.trip_id;
  const trip = tripId ? feed?.findTrip(tripId, loc.route_id) : undefined;
  const update = tripUpdateFor(session, loc);
  const vehicles = tripVehicles(session, loc);
  const eyebrow = t('crumb.trip');
  const label =
    tripId ?? [loc.route_id, loc.start_time].filter(Boolean).join(' ');

  // The trip row and its stop_times are fetched on demand; the panel
  // re-renders on `dataloaded`.
  const loading = Boolean(feed && tripId && !feed.tripTimesLoaded(tripId));
  if (feed && tripId && loading) {
    feed.loadTripTimes(tripId).catch((err) => {
      console.error(`[TripPage] loading trip ${tripId} failed`, err);
    });
  }
  const loadingLine = `<div class="flex items-center gap-2 text-xs opacity-70">
      <span class="loading loading-spinner loading-xs"></span>
      ${t('trip.loadingStops')}
    </div>`;

  if (!trip && !update && vehicles.length === 0) {
    return {
      eyebrow,
      title: label,
      sections: [
        {
          body: loading
            ? loadingLine
            : `<p class="text-sm opacity-60">${escHtml(t('trip.missing', { id: label }))}</p>`,
        },
      ],
    };
  }

  const desc = descriptorFields(update?.trip);
  const routeId =
    trip?.route_id ||
    desc.routeId ||
    vehicles.find((v) => v.routeId)?.routeId ||
    loc.route_id;
  const route: Route | undefined = routeId
    ? feed?.routes.get(routeId)
    : undefined;
  const shortName = trip?.raw.trip_short_name?.trim() ?? '';
  const startDate = loc.start_date || desc.startDate || vehicles[0]?.startDate;
  const startTime = loc.start_time || desc.startTime || vehicles[0]?.startTime;
  const direction = trip?.direction_id ?? desc.directionId ?? loc.direction_id;
  const relationship =
    presentNumber(update?.trip, 'scheduleRelationship') ??
    vehicles[0]?.scheduleRelationship;

  // Predictions of this update only: the index keys them by trip_id, which a
  // second service day of the same trip shares.
  const predictions = (
    tripId ? (rt.predictionsByTrip.get(tripId) ?? []) : []
  ).filter((p) => p.update === update);
  const first = vehicles[0];
  const currentSequence = first
    ? rt.stopSequenceFor(first)?.sequence
    : undefined;

  const stopTimes =
    trip && feed
      ? loading
        ? loadingLine
        : tripStopTimesTable(ctx, feed, trip, predictions, currentSequence)
      : predictionsTable(ctx, predictions, currentSequence);

  const alerts = tripId
    ? alertsForTrip(session, tripId, routeId)
    : routeId
      ? alertsForRoute(session, routeId)
      : [];

  const sections: (TreeSection | null)[] = [
    trip || !feed
      ? null
      : {
          body: `<p class="text-xs opacity-60">${t('trip.notInSchedule')}</p>`,
        },
    {
      body: propList([
        prop(
          t('trip.route'),
          route
            ? entityLink(
                ctx,
                { type: 'route', route_id: route.id },
                route.short_name || route.long_name || route.id
              )
            : routeId
              ? mono(routeId)
              : `<span class="opacity-40">${t('trip.noRoute')}</span>`
        ),
        optionalProp(t('trip.headsign'), escHtml(trip?.headsign ?? '')),
        optionalProp(t('trip.shortName'), escHtml(shortName)),
        direction === undefined || direction === null || direction === ''
          ? ''
          : prop(t('trip.direction'), mono(String(direction))),
        optionalProp(
          t('trip.serviceDate'),
          startDate ? escHtml(formatServiceDate(startDate)) : ''
        ),
        optionalProp(t('trip.startTime'), escHtml(startTime ?? '')),
        optionalProp(
          t('trip.shape'),
          trip?.shape_id ? mono(trip.shape_id) : ''
        ),
      ]),
    },
    trip && feed
      ? serviceSection(feed, trip.service_id, options.weekStart)
      : null,
    listSection(t('trip.vehicles'), {
      name: 'trip-vehicles',
      items: vehicles,
      row: (v) =>
        entityRow<TreeLocation>(ctx, {
          state: { type: 'vehicle', vehicle_key: v.key },
          label:
            v.label || v.vehicleId || v.entityId || vehicleDisplayName(feed, v),
        }),
      empty: t('trip.noVehicles'),
    }),
    updateSection(update),
    { title: t('trip.stopTimes'), body: stopTimes },
    listSection(
      t('trip.alerts'),
      alertListOptions(ctx, alerts, t('alerts.noneHere'))
    ),
    ...(options.extraSections ?? []),
    trip ? { body: renderRawFields('trips.txt', trip.raw) } : null,
    update ? { body: renderRawJson(t('trip.raw'), update) } : null,
  ];

  return {
    eyebrow,
    title: shortName || trip?.headsign || label,
    id: tripId,
    titleExtra:
      `${route ? routeBadge(ctx, route) : ''} ${tripRelationshipMark(relationship)}`.trim() ||
      undefined,
    sections: sections.filter((s): s is TreeSection => s !== null),
  };
}
