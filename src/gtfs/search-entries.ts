/**
 * Search entries for the parsed schedule, for `SearchController`.
 *
 * The payload is a `route` or `stop` page state, which every app's union
 * includes. Each app adds its own realtime entries and sets the priorities
 * that place the schedule among them.
 */

import type { SearchEntry } from '../ui/search-controller';
import { routeMarker, stopMarker } from '../ui/search-controller';
import type { StopPageRef } from './breadcrumbs';
import type { RoutePageRef } from './entity-render';
import type { GTFSScheduled } from './scheduled';

/** Lower sorts first. */
export interface ScheduleSearchPriorities {
  station: number;
  route: number;
  stop: number;
}

/** Non-empty values only, so the haystack has no runs of blanks to match into. */
export function searchHaystack(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function scheduleSearchEntries(
  feed: GTFSScheduled | null,
  priorities: ScheduleSearchPriorities
): SearchEntry<RoutePageRef | StopPageRef>[] {
  const entries: SearchEntry<RoutePageRef | StopPageRef>[] = [];

  for (const stop of feed?.stops.values() ?? []) {
    entries.push({
      payload: { type: 'stop', stop_id: stop.id },
      icon: stopMarker(stop.location_type),
      primary: stop.name || stop.id,
      secondary: stop.raw['stop_code'] || stop.id,
      haystack: searchHaystack(
        stop.name,
        stop.id,
        stop.raw['stop_code'],
        stop.raw['stop_desc']
      ),
      priority:
        Number(stop.location_type) === 1 ? priorities.station : priorities.stop,
    });
  }

  for (const route of feed?.routes.values() ?? []) {
    const primary = route.short_name || route.long_name || route.id;
    entries.push({
      payload: { type: 'route', route_id: route.id },
      icon: routeMarker(route.color),
      primary,
      secondary:
        route.long_name && route.long_name !== primary
          ? route.long_name
          : route.id,
      haystack: searchHaystack(
        route.short_name,
        route.long_name,
        route.id,
        route.raw['route_desc']
      ),
      priority: priorities.route,
    });
  }

  return entries;
}
