/**
 * The page locations of the realtime apps' object tree, and their hash params.
 *
 * Each app's `PageLocation` is `TreeLocation` plus its own extras, and its
 * codec schema spreads `TREE_PAGE_SPECS` into `pages`.
 */

import type { PageSpecs } from '../ui/page-state-schema';
import type { TripUpdate, VehiclePosition } from './rt-types';
import type { GTFSScheduled } from './scheduled';

/**
 * A trip page. Keyed by trip_id plus the service day (and start time for a
 * frequency trip), or, with no trip_id, by route, direction, day and start
 * time. `entity_id` tells apart two updates that share a whole descriptor.
 * With a trip_id, `route_id` is only a crumb hint.
 */
export interface TripLocation {
  type: 'trip';
  trip_id?: string;
  start_date?: string;
  start_time?: string;
  route_id?: string;
  direction_id?: string;
  entity_id?: string;
}

export type TreeLocation =
  | { type: 'home' }
  | { type: 'schedule' }
  | { type: 'feed_info' }
  | { type: 'agency'; agency_id: string }
  | { type: 'route'; route_id: string }
  | TripLocation
  | { type: 'stop'; stop_id: string }
  | { type: 'vehicle_positions' }
  | { type: 'trip_updates' }
  | { type: 'service_alerts' }
  | { type: 'vehicle'; vehicle_key: string }
  | { type: 'alert'; alert_id: string };

export type TreePageType = Exclude<TreeLocation['type'], 'home'>;

/** Hash params of every non-home tree page. */
export const TREE_PAGE_SPECS: PageSpecs<TreeLocation, TreePageType> = {
  schedule: {},
  feed_info: {},
  agency: { agency_id: 'agency' },
  route: { route_id: 'route' },
  trip: {
    trip_id: { param: 'trip', optional: true },
    start_date: { param: 'date', optional: true },
    start_time: { param: 'time', optional: true },
    route_id: { param: 'route', optional: true },
    direction_id: { param: 'direction', optional: true },
    entity_id: { param: 'entity', optional: true },
  },
  stop: { stop_id: 'stop' },
  vehicle_positions: {},
  trip_updates: {},
  service_alerts: {},
  vehicle: { vehicle_key: 'vehicle' },
  alert: { alert_id: 'alert' },
};

/** A trip location names a trip: a trip_id, or a route and a start time. */
export function tripLocationValid(loc: TripLocation): boolean {
  return Boolean(loc.trip_id) || Boolean(loc.route_id && loc.start_time);
}

/**
 * The canonical string for a trip location. With a trip_id, the route and
 * direction are left out, since they are hints there and not identity.
 */
export function tripLocationKey(loc: TripLocation): string {
  const parts = loc.trip_id
    ? ['trip', loc.trip_id, loc.start_date, loc.start_time, loc.entity_id]
    : [
        'route',
        loc.route_id,
        loc.direction_id,
        loc.start_date,
        loc.start_time,
        loc.entity_id,
      ];
  return JSON.stringify(parts.map((p) => p ?? ''));
}

/**
 * The trip fields a TripDescriptor or a `VehiclePosition` carries. Decoded
 * strings are `''` when absent; `directionId` must already be checked with
 * `presentNumber`, since a decoded one defaults to 0.
 */
export interface TripFields {
  tripId?: string | null;
  routeId?: string | null;
  directionId?: string | number | null;
  startDate?: string | null;
  startTime?: string | null;
}

/** The fields of a decoded TripDescriptor, with an absent direction left out. */
export function descriptorFields(
  desc: (TripFields & object) | null | undefined
): TripFields {
  if (!desc) {
    return {};
  }
  const hasDirection = Object.prototype.hasOwnProperty.call(
    desc,
    'directionId'
  );
  return {
    tripId: desc.tripId,
    routeId: desc.routeId,
    directionId: hasDirection ? desc.directionId : undefined,
    startDate: desc.startDate,
    startTime: desc.startTime,
  };
}

function text(value: string | number | null | undefined): string | undefined {
  return value === null || value === undefined || value === ''
    ? undefined
    : String(value);
}

/**
 * The trip page a vehicle or trip update links to, dated by its start_date.
 * With a trip_id, `routeHint` (else the descriptor's route) is the crumb hint.
 */
export function tripLocationFor(
  fields: TripFields,
  routeHint?: string
): TripLocation | undefined {
  const tripId = text(fields.tripId);
  const routeId = text(routeHint) ?? text(fields.routeId);
  const startDate = text(fields.startDate);
  const loc: TripLocation = tripId
    ? {
        type: 'trip',
        trip_id: tripId,
        start_date: startDate,
        route_id: routeId,
      }
    : {
        type: 'trip',
        route_id: routeId,
        direction_id: text(fields.directionId),
        start_date: startDate,
        start_time: text(fields.startTime),
      };
  for (const key of Object.keys(loc) as (keyof TripLocation)[]) {
    if (loc[key] === undefined) {
      delete loc[key];
    }
  }
  return tripLocationValid(loc) ? loc : undefined;
}

/**
 * Whether trip fields name the trip at a location. A field either side leaves
 * out matches anything, so an undated location matches any service day.
 */
export function tripMatches(loc: TripLocation, fields: TripFields): boolean {
  const agrees = (
    want: string | undefined,
    have: string | number | null | undefined
  ): boolean => !want || text(have) === undefined || text(have) === want;
  if (!agrees(loc.start_date, fields.startDate)) {
    return false;
  }
  if (loc.trip_id) {
    return (
      text(fields.tripId) === loc.trip_id &&
      agrees(loc.start_time, fields.startTime)
    );
  }
  return (
    text(fields.routeId) === loc.route_id &&
    text(fields.startTime) === loc.start_time &&
    agrees(loc.direction_id, fields.directionId)
  );
}

/** The trip page a vehicle's trip links to, or undefined with no trip named. */
export function vehicleTripLocation(
  feed: GTFSScheduled | null,
  vehicle: VehiclePosition
): TripLocation | undefined {
  const routeId = vehicle.tripId
    ? feed?.trips.get(vehicle.tripId)?.route_id
    : undefined;
  return tripLocationFor(vehicle, routeId);
}

/** The trip page a trip update links to, or undefined with no trip named. */
export function updateTripLocation(
  feed: GTFSScheduled | null,
  update: TripUpdate
): TripLocation | undefined {
  const tripId = update.trip?.tripId;
  const routeId = tripId ? feed?.trips.get(tripId)?.route_id : undefined;
  return tripLocationFor(descriptorFields(update.trip), routeId);
}
