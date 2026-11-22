/**
 * The page locations of the realtime apps' object tree, and their hash params.
 *
 * Each app's `PageLocation` is `TreeLocation` plus its own extras, and its
 * codec schema spreads `TREE_PAGE_SPECS` into `pages`.
 */

import type { PageSpecs } from '../ui/page-state-schema';

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
