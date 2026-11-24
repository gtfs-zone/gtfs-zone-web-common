/**
 * The stop page. For a platform (or a plain stop) this is what serves it, what
 * is predicted to arrive, and what is sitting at it now. For a *station* it is
 * the same questions answered over the whole place - every boardable platform
 * beneath it - because a station never appears in `stop_times` itself; its
 * services are named by its platforms.
 *
 * Aggregation is always labelled as aggregation: every merged row names the
 * child stop it came from, so nothing reads as though the station id appeared
 * in `stop_times`.
 */

import type { AlertRecord, VehiclePosition } from './rt-types';
import type { GTFSScheduled, Route, Stop } from './scheduled';
import { alertsForStop } from './alerts';
import { stopTypeLabel } from '../ui/breadcrumb-trail';
import { zoneLabel } from './feed-time';
import type { Prediction, RtIndex } from './rt-index';
import { TOOLTIP_TRIGGER_CLASS, tooltipContentAttr } from '../ui/field-label';
import type { PageRef, RenderContext } from './entity-render';
import {
  VEHICLE_STATUS_LABELS,
  derivedClass,
  entityLink,
  escHtml,
  formatDelay,
  formatEpochTime,
  formatScheduledTime,
  predictionTooltip,
  primaryEvent,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  stopTimeRelationshipMark,
  vehicleDisplayName,
} from './entity-render';
import { entityRow } from './entity-row';
import { alertListOptions } from './alert-page';
import type { RtPageHooks, RtPageRef } from './rt-page';
import { updateTripLocation } from './tree-location';
import { listSection, type TreePage, type TreeSection } from './tree-page';
import { t } from '../i18n/messages';

export interface StopPageOptions<
  S extends PageRef,
  V extends VehiclePosition,
> extends RtPageHooks<S, V> {
  /**
   * Sections inserted before the raw dump. `serviceIds` are the stops whose
   * service the page shows: the stop itself, or a station's boardable platforms.
   */
  extraSections?: (stop: Stop, serviceIds: string[]) => TreeSection[];
}

type Ctx<S extends PageRef> = RenderContext<S | RtPageRef>;

/** Departures read from the index; more than any service day at one stop. */
const MAX_DEPARTURES = 2000;

/** A platform's rider-facing label: platform_code, then platform_name, then id. */
function platformLabel(stop: Stop): string {
  return (
    (stop.raw.platform_code || stop.raw.platform_name || stop.id).trim() ||
    stop.id
  );
}

/** "Platform 3" for a child stop of the station, by id. */
function platformName(feed: GTFSScheduled, stopId: string): string {
  const stop = feed.stops.get(stopId);
  return t('stop.platform', { name: stop ? platformLabel(stop) : stopId });
}

function aggregationNote(count: number): string {
  return `<p class="text-xs opacity-50">${t('stop.aggregated', { count })}</p>`;
}

// --- Routes -----------------------------------------------------------------

interface RouteRow {
  routeId: string;
  route?: Route;
  /** The platforms serving it, on a station. */
  platforms: string[];
}

function routeRows(feed: GTFSScheduled, serviceIds: string[]): RouteRow[] {
  const byRoute = new Map<string, Set<string>>();
  for (const id of serviceIds) {
    for (const routeId of feed.routesByStop.get(id) ?? []) {
      let set = byRoute.get(routeId);
      if (!set) {
        byRoute.set(routeId, (set = new Set()));
      }
      set.add(id);
    }
  }
  return [...byRoute.entries()].map(([routeId, platforms]) => ({
    routeId,
    route: feed.routes.get(routeId),
    platforms: [...platforms],
  }));
}

function routesSection<S extends PageRef>(
  ctx: Ctx<S>,
  feed: GTFSScheduled,
  serviceIds: string[],
  isStation: boolean
): TreeSection {
  return listSection(
    t('stop.routes'),
    {
      name: 'stop-routes',
      items: routeRows(feed, serviceIds),
      row: (row) =>
        entityRow<RtPageRef>(ctx, {
          state: { type: 'route', route_id: row.routeId },
          label: row.route?.short_name || row.route?.long_name || row.routeId,
          sublabel: isStation
            ? row.platforms.map((id) => platformName(feed, id)).join(', ')
            : row.route?.short_name
              ? row.route.long_name
              : undefined,
          color: row.route?.color,
        }),
      searchText: (row) =>
        `${row.route?.short_name ?? ''} ${row.route?.long_name ?? ''} ${row.routeId}`,
      empty: t('stop.noRoutes'),
    },
    isStation ? { body: aggregationNote(new Set(serviceIds).size) } : {}
  );
}

// --- Departures -------------------------------------------------------------

function departureRow<S extends PageRef, V extends VehiclePosition>(
  ctx: Ctx<S>,
  feed: GTFSScheduled,
  hooks: StopPageOptions<S, V>,
  p: Prediction,
  isStation: boolean
): string {
  const trip = feed.trips.get(p.trip_id);
  const route = trip ? feed.routes.get(trip.route_id) : undefined;
  const ev = primaryEvent(p);
  const skipped = p.scheduleRelationship === 1;

  // Scheduled time, and the platform it leaves from where that is not the
  // page's own stop. Both are what tells two departures of one route apart.
  const detail = [
    ev.scheduledText
      ? t('stop.scheduledAt', {
          time: formatScheduledTime(ev.scheduledText, false),
        })
      : '',
    isStation ? platformName(feed, p.stop_id) : '',
  ].filter(Boolean);

  // Calculated values are italic; a skipped stop shows only its badge. The
  // hover is the prediction row's.
  const times = skipped
    ? ''
    : `<span class="tabular-nums${derivedClass(ev.timeFrom)}">${escHtml(
        ev.time === undefined ? '-' : formatEpochTime(ev.time, false)
      )}</span>
      <span class="${derivedClass(ev.delayFrom).trim()}">${formatDelay(ev.delay)}</span>`;

  const loc = updateTripLocation(feed, p.update);
  return entityRow(ctx, {
    state: loc ? hooks.tripLink?.(loc) : undefined,
    leadHtml: route
      ? routeBadge(ctx, route)
      : `<span class="badge badge-ghost badge-sm">${escHtml(p.update.trip?.routeId ?? '?')}</span>`,
    label: trip?.headsign || p.trip_id,
    sublabel: detail.join(' - '),
    badgeHtml: `<span class="text-xs flex items-center gap-2 whitespace-nowrap ${TOOLTIP_TRIGGER_CLASS}" tabindex="0" ${tooltipContentAttr(
      predictionTooltip(p)
    )}>
      ${times}${stopTimeRelationshipMark(p.scheduleRelationship)}
    </span>`,
  });
}

function departuresSection<S extends PageRef, V extends VehiclePosition>(
  ctx: Ctx<S>,
  rt: RtIndex<V>,
  hooks: StopPageOptions<S, V>,
  serviceIds: string[],
  isStation: boolean
): TreeSection {
  const feed = ctx.session.scheduledFeed!;
  const upcoming = isStation
    ? rt.upcomingAtStops(serviceIds, MAX_DEPARTURES)
    : rt.upcomingAtStop(serviceIds[0], MAX_DEPARTURES);
  const notes = [
    isStation ? aggregationNote(new Set(serviceIds).size) : '',
    upcoming.length
      ? `<p class="text-xs opacity-50">${escHtml(t('stop.timesIn', { zone: zoneLabel() }))}</p>`
      : '',
  ].join('');
  return listSection(
    t('stop.departures'),
    {
      name: 'stop-departures',
      items: upcoming,
      row: (p) => departureRow(ctx, feed, hooks, p, isStation),
      searchText: (p) => {
        const trip = feed.trips.get(p.trip_id);
        const route = trip ? feed.routes.get(trip.route_id) : undefined;
        return `${route?.short_name ?? ''} ${route?.long_name ?? ''} ${trip?.headsign ?? ''} ${p.trip_id}`;
      },
      empty: t('stop.noDepartures'),
    },
    notes ? { body: notes } : {}
  );
}

// --- Vehicles at the stop ---------------------------------------------------

function vehiclesSection<S extends PageRef, V extends VehiclePosition>(
  ctx: Ctx<S>,
  rt: RtIndex<V>,
  hooks: StopPageOptions<S, V>,
  serviceIds: string[],
  isStation: boolean
): TreeSection {
  const feed = ctx.session.scheduledFeed!;
  const here: { vehicle: V; stopId: string }[] = [];
  for (const id of serviceIds) {
    for (const vehicle of rt.vehiclesAtStop.get(id) ?? []) {
      here.push({ vehicle, stopId: id });
    }
  }
  return listSection(t('stop.vehicles'), {
    name: 'stop-vehicles',
    items: here,
    row: ({ vehicle, stopId }) =>
      entityRow<S>(ctx, {
        state: hooks.vehicleLink(vehicle),
        label: vehicleDisplayName(feed, vehicle),
        sublabel: isStation ? platformName(feed, stopId) : undefined,
        badge:
          vehicle.currentStatus === undefined
            ? undefined
            : VEHICLE_STATUS_LABELS[vehicle.currentStatus],
      }),
    empty: t('stop.noVehicles'),
  });
}

// --- Alerts -----------------------------------------------------------------

/** Alerts naming the stop or any descendant, deduped. */
function stopAlerts<S extends PageRef>(
  ctx: Ctx<S>,
  ids: string[]
): AlertRecord[] {
  const seen = new Set<string>();
  const records: AlertRecord[] = [];
  for (const id of ids) {
    for (const record of alertsForStop(ctx.session, id)) {
      if (!seen.has(record.id)) {
        seen.add(record.id);
        records.push(record);
      }
    }
  }
  return records;
}

// --- Platforms --------------------------------------------------------------

/**
 * The station's own structure: boardable platforms first, each with its route
 * badges, then the entrances and generic nodes.
 */
function platformsSection<S extends PageRef>(
  ctx: Ctx<S>,
  feed: GTFSScheduled,
  stopId: string
): TreeSection {
  const children = feed
    .descendants(stopId)
    .map((id) => feed.stops.get(id))
    .filter((s): s is Stop => s !== undefined);
  const boardable = children.filter((s) => s.location_type === 0);
  const others = children.filter((s) => s.location_type !== 0);
  return listSection(t('stop.platforms'), {
    name: 'stop-platforms',
    items: [...boardable, ...others],
    row: (s) => {
      const state: RtPageRef = { type: 'stop', stop_id: s.id };
      if (s.location_type !== 0) {
        return entityRow<RtPageRef>(ctx, {
          state,
          label: s.name || s.id,
          badge: stopTypeLabel(s.location_type),
        });
      }
      const badges = [...(feed.routesByStop.get(s.id) ?? [])]
        .map((id) => {
          const route = feed.routes.get(id);
          return route ? routeBadge(ctx, route) : '';
        })
        .join('');
      return entityRow<RtPageRef>(ctx, {
        state,
        label: platformName(feed, s.id),
        sublabel: s.name && s.name !== platformLabel(s) ? s.name : s.id,
        badgeHtml: badges
          ? `<span class="flex gap-1 flex-wrap">${badges}</span>`
          : undefined,
      });
    },
    searchText: (s) =>
      `${platformLabel(s)} ${s.name} ${s.id} ${s.raw.platform_code ?? ''}`,
    empty: t('stop.noPlatforms'),
  });
}

// --- Page --------------------------------------------------------------------

/** A stop or station: its routes, departures, vehicles at it and alerts. */
export function stopPage<S extends PageRef, V extends VehiclePosition>(
  ctx: Ctx<S>,
  rt: RtIndex<V>,
  stopId: string,
  options: StopPageOptions<S, V>
): TreePage {
  const feed = ctx.session.scheduledFeed;
  const stop = feed?.stops.get(stopId);
  if (!feed || !stop) {
    return {
      eyebrow: stopTypeLabel(undefined),
      title: stopId,
      sections: [
        {
          body: `<p class="text-sm opacity-60">${escHtml(t('stop.missing', { id: stopId }))}</p>`,
        },
      ],
    };
  }

  const parent = stop.parent_station
    ? feed.stops.get(stop.parent_station)
    : undefined;

  // A station aggregates over its boardable descendants; anything else answers
  // for itself. Include self in the service set so a plain stop still works and
  // a station that happens to carry its own stop_times is not dropped.
  const boardable = feed.boardableDescendants(stop.id);
  const isStation = boardable.length > 0;
  const serviceIds = isStation ? [...boardable, stop.id] : [stop.id];
  const alertIds = [stop.id, ...feed.descendants(stop.id)];
  const code = stop.raw.platform_code?.trim() ?? '';

  return {
    eyebrow: stopTypeLabel(stop.location_type),
    title: stop.name || stop.id,
    id: stop.id,
    sections: [
      {
        body: propList([
          parent
            ? prop(
                t('stop.station'),
                entityLink(
                  ctx,
                  { type: 'stop', stop_id: parent.id },
                  parent.name || parent.id
                )
              )
            : '',
          code ? prop(t('stop.platformCode'), escHtml(code)) : '',
          prop(
            t('stop.coordinates'),
            escHtml(`${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`)
          ),
        ]),
      },
      ...(isStation ? [platformsSection(ctx, feed, stop.id)] : []),
      routesSection(ctx, feed, serviceIds, isStation),
      departuresSection(ctx, rt, options, serviceIds, isStation),
      vehiclesSection(ctx, rt, options, serviceIds, isStation),
      listSection(
        t('stop.alerts'),
        alertListOptions(ctx, stopAlerts(ctx, alertIds), t('alerts.noneHere'))
      ),
      ...(options.extraSections?.(stop, serviceIds) ?? []),
      { body: renderRawFields('stops.txt', stop.raw) },
    ],
  };
}
