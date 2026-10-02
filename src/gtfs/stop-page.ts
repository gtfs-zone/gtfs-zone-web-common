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
import type { Stop } from './scheduled';
import { alertsForStop } from './alerts';
import { stopTypeLabel } from '../ui/breadcrumb-trail';
import { zoneLabel } from './feed-time';
import type { RtIndex } from './rt-index';
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
  missing,
  pageHeader,
  predictionTooltip,
  primaryEvent,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  section,
  stopTimeRelationshipMark,
  vehicleDisplayName,
} from './entity-render';
import { entityRow, entityRowList, rowSection } from './entity-row';
import { renderAlertList } from './alert-page';
import type { RtPageHooks, RtPageRef } from './rt-page';
import { vehiclesTitle } from './rt-page';

export interface StopPageHooks<
  S extends PageRef,
  V extends VehiclePosition,
> extends RtPageHooks<S, V> {
  /** The page a departure links to; unlinked when absent or undefined. */
  tripLink?: (tripId: string, routeId: string | undefined) => S | undefined;
  /**
   * Sections after the platforms. `serviceIds` are the stops whose service the
   * page shows: the stop itself, or a station's boardable platforms.
   */
  stopExtra?: (stop: Stop, serviceIds: string[]) => string;
}

type Ctx<S extends PageRef> = RenderContext<S | RtPageRef>;

const MAX_DEPARTURES = 20;

/** A platform's rider-facing label: platform_code, then platform_name, then id. */
function platformLabel(stop: Stop): string {
  return (
    (stop.raw.platform_code || stop.raw.platform_name || stop.id).trim() ||
    stop.id
  );
}

/** The muted "this came from a child stop" tag every aggregated row carries. */
function fromChild(ctx: RenderContext<RtPageRef>, stopId: string): string {
  return `<span class="opacity-50 text-xs whitespace-nowrap">@ ${escHtml(
    childName(ctx, stopId)
  )}</span>`;
}

/** The same name as plain text, for a row's sublabel. */
function childName(ctx: RenderContext<RtPageRef>, stopId: string): string {
  const stop = ctx.session.scheduledFeed!.stops.get(stopId);
  return stop ? platformLabel(stop) : stopId;
}

function aggregationNote(count: number): string {
  return `<p class="text-xs opacity-50">Aggregated across ${count} platform${
    count === 1 ? '' : 's'
  } - these rows come from child stops in <span class="font-mono">stop_times</span>, not this station id.</p>`;
}

// --- Routes -----------------------------------------------------------------

function renderRoutes(
  ctx: RenderContext<RtPageRef>,
  serviceIds: string[],
  isStation: boolean
): string {
  const feed = ctx.session.scheduledFeed!;
  // route_id -> the platforms that serve it
  const routePlatforms = new Map<string, Set<string>>();
  for (const id of serviceIds) {
    for (const routeId of feed.routesByStop.get(id) ?? []) {
      let set = routePlatforms.get(routeId);
      if (!set) {
        routePlatforms.set(routeId, (set = new Set()));
      }
      set.add(id);
    }
  }
  if (routePlatforms.size === 0) {
    return '';
  }

  if (!isStation) {
    return section(
      'Routes serving this stop',
      `<div class="flex flex-wrap gap-1">${[...routePlatforms.keys()]
        .map((id) => {
          const route = feed.routes.get(id);
          return route
            ? routeBadge(ctx, route)
            : `<span class="badge badge-ghost badge-sm">${escHtml(id)}</span>`;
        })
        .join('')}</div>`
    );
  }

  const rows = [...routePlatforms.entries()]
    .map(([routeId, platforms]) => {
      const route = feed.routes.get(routeId);
      const badge = route
        ? routeBadge(ctx, route)
        : `<span class="badge badge-ghost badge-sm">${escHtml(routeId)}</span>`;
      const platformTags = [...platforms]
        .map((id) => fromChild(ctx, id))
        .join('<span class="opacity-30">-</span> ');
      return `<div class="flex items-center gap-2 flex-wrap">${badge}${platformTags}</div>`;
    })
    .join('');

  return section(
    'Routes serving this station',
    `${aggregationNote(new Set(serviceIds).size)}<div class="space-y-1">${rows}</div>`
  );
}

// --- Departures -------------------------------------------------------------

function renderDepartures<S extends PageRef, V extends VehiclePosition>(
  ctx: Ctx<S>,
  rt: RtIndex<V>,
  hooks: StopPageHooks<S, V>,
  serviceIds: string[],
  isStation: boolean
): string {
  const feed = ctx.session.scheduledFeed!;
  const upcoming = isStation
    ? rt.upcomingAtStops(serviceIds, MAX_DEPARTURES)
    : rt.upcomingAtStop(serviceIds[0], MAX_DEPARTURES);
  if (upcoming.length === 0) {
    return section(
      'Upcoming departures',
      '<p class="text-xs opacity-60">No trip updates reference this stop.</p>'
    );
  }

  const rows = upcoming.map((p) => {
    const trip = feed.trips.get(p.trip_id);
    const route = trip ? feed.routes.get(trip.route_id) : undefined;
    const ev = primaryEvent(p);
    const skipped = p.scheduleRelationship === 1;

    // Scheduled time, and the platform it leaves from where that is not the
    // page's own stop. Both are what tells two departures of one route apart.
    const detail = [
      `sched ${formatScheduledTime(ev.scheduledText, false)}`,
      isStation ? `@ ${childName(ctx, p.stop_id)}` : '',
    ].filter(Boolean);

    // Calculated values are italic; a skipped stop shows only its badge. The
    // hover is the prediction row's.
    const times = skipped
      ? ''
      : `<span class="tabular-nums${derivedClass(ev.timeFrom)}">${escHtml(
          ev.time === undefined ? '-' : formatEpochTime(ev.time, false)
        )}</span>
        <span class="${derivedClass(ev.delayFrom).trim()}">${formatDelay(ev.delay)}</span>`;

    return entityRow(ctx, {
      state: hooks.tripLink?.(p.trip_id, trip?.route_id),
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
  });

  const body = `${entityRowList(rows, 'No trip updates reference this stop.')}
    <p class="text-xs opacity-50">Predicted times are in ${escHtml(zoneLabel())}.</p>`;

  return rowSection(
    'Upcoming departures',
    upcoming.length,
    isStation ? `${aggregationNote(new Set(serviceIds).size)}${body}` : body
  );
}

// --- Vehicles here now ------------------------------------------------------

function renderVehiclesHere<S extends PageRef, V extends VehiclePosition>(
  ctx: Ctx<S>,
  rt: RtIndex<V>,
  hooks: RtPageHooks<S, V>,
  serviceIds: string[],
  isStation: boolean
): string {
  const rows: string[] = [];
  for (const id of serviceIds) {
    for (const v of rt.vehiclesAtStop.get(id) ?? []) {
      rows.push(
        entityRow(ctx, {
          state: hooks.vehicleLink(v),
          label: vehicleDisplayName(ctx.session.scheduledFeed, v),
          sublabel: isStation ? `@ ${childName(ctx, id)}` : undefined,
          badge: VEHICLE_STATUS_LABELS[v.currentStatus ?? -1] ?? '',
        })
      );
    }
  }
  if (rows.length === 0) {
    return '';
  }
  return rowSection(
    `${vehiclesTitle(hooks.vehicleNoun)} here now`,
    rows.length,
    `${isStation ? aggregationNote(new Set(serviceIds).size) : ''}${entityRowList(
      rows,
      'Nothing is reporting from this stop.'
    )}`
  );
}

// --- Alerts -----------------------------------------------------------------

/** Alerts naming the station or any descendant, deduped, each marked. */
function renderStationAlerts(
  ctx: RenderContext<RtPageRef>,
  ids: string[]
): string {
  const seen = new Set<string>();
  const records: AlertRecord[] = [];
  for (const id of ids) {
    for (const record of alertsForStop(ctx.session, id)) {
      if (seen.has(record.id)) {
        continue;
      }
      seen.add(record.id);
      records.push(record);
    }
  }
  return renderAlertList(ctx, records, 'Alerts at this station');
}

// --- Platforms and related stops --------------------------------------------

/**
 * The station's own structure: boardable platforms first, each with its code
 * and route badges, then the entrances and generic nodes collapsed so they
 * cannot bury the platforms (South Station has 131 of them over 23 platforms).
 */
function renderPlatforms(
  ctx: RenderContext<RtPageRef>,
  stopId: string
): string {
  const feed = ctx.session.scheduledFeed!;
  const children = feed
    .descendants(stopId)
    .map((id) => feed.stops.get(id)!)
    .filter(Boolean);
  if (children.length === 0) {
    return section(
      'Platforms',
      '<p class="text-xs opacity-60">No platforms in this feed.</p>'
    );
  }

  const boardable = children.filter((s) => s.location_type === 0);
  const others = children.filter((s) => s.location_type !== 0);

  const platformRow = (s: Stop): string => {
    const badges = [...(feed.routesByStop.get(s.id) ?? [])]
      .map((id) => {
        const route = feed.routes.get(id);
        return route ? routeBadge(ctx, route) : '';
      })
      .join('');
    return entityRow(ctx, {
      state: { type: 'stop', stop_id: s.id },
      label: platformLabel(s),
      sublabel: s.id,
      badgeHtml: `<span class="flex gap-1 flex-wrap">${badges}</span>`,
    });
  };

  const boardableList = entityRowList(
    boardable.map(platformRow),
    'No boardable platforms in this feed.'
  );

  const otherList = others.length
    ? `<details class="text-xs">
         <summary class="cursor-pointer opacity-60">${others.length} entrance${
           others.length === 1 ? '' : 's'
         } and generic node${others.length === 1 ? '' : 's'}</summary>
         ${entityRowList(
           others.map((s) =>
             entityRow(ctx, {
               state: { type: 'stop', stop_id: s.id },
               label: s.name || s.id,
               badge: stopTypeLabel(s.location_type),
             })
           ),
           ''
         )}
       </details>`
    : '';

  return rowSection(
    'Platforms',
    children.length,
    `${boardableList}${otherList}`
  );
}

/** For a platform: the parent's other platforms. Stations use renderPlatforms. */
function renderSiblingPlatforms(
  ctx: RenderContext<RtPageRef>,
  stop: Stop
): string {
  const feed = ctx.session.scheduledFeed!;
  if (!stop.parent_station) {
    return '';
  }
  const siblings = (feed.childrenByParent.get(stop.parent_station) ?? [])
    .filter((id) => id !== stop.id)
    .map((id) => feed.stops.get(id)!)
    .filter(Boolean);
  if (siblings.length === 0) {
    return '';
  }

  return rowSection(
    'Sibling platforms',
    siblings.length,
    entityRowList(
      siblings.map((s) =>
        entityRow(ctx, {
          state: { type: 'stop', stop_id: s.id },
          label: s.name || s.id,
          sublabel: s.id,
        })
      ),
      'No sibling platforms.'
    )
  );
}

// --- Page --------------------------------------------------------------------

export function renderStopPage<S extends PageRef, V extends VehiclePosition>(
  ctx: Ctx<S>,
  rt: RtIndex<V>,
  stopId: string,
  hooks: StopPageHooks<S, V>
): string {
  const feed = ctx.session.scheduledFeed;
  const stop = feed?.stops.get(stopId);
  if (!feed || !stop) {
    return missing(`Stop ${stopId}`);
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

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        ${pageHeader(stop.name || stop.id, stop.id)}
        ${
          parent
            ? `<p class="text-xs">Part of ${entityLink(
                ctx,
                { type: 'stop', stop_id: parent.id },
                parent.name || parent.id
              )}</p>`
            : ''
        }
      </div>

      ${
        isStation
          ? renderStationAlerts(ctx, alertIds)
          : renderAlertList(
              ctx,
              alertsForStop(ctx.session, stop.id),
              'Alerts at this stop'
            )
      }
      ${renderRoutes(ctx, serviceIds, isStation)}
      ${renderDepartures(ctx, rt, hooks, serviceIds, isStation)}
      ${renderVehiclesHere(ctx, rt, hooks, serviceIds, isStation)}
      ${isStation ? renderPlatforms(ctx, stop.id) : renderSiblingPlatforms(ctx, stop)}
      ${hooks.stopExtra?.(stop, serviceIds) ?? ''}

      ${section(
        'Properties',
        propList([
          prop(
            'Coordinates',
            escHtml(`${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`)
          ),
          prop(
            'Trips calling',
            String((feed.stopTrips.get(stop.id) ?? []).length)
          ),
        ])
      )}
      ${renderRawFields('stops.txt', stop.raw)}
    </div>`;
}
