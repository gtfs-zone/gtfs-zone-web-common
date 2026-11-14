/**
 * Search groups for the parsed schedule, for `SearchController`.
 *
 * The payload is a `route` or `stop` page state, which every app's union
 * includes. Each app places the two groups among its own realtime groups.
 */

import type { SearchEntry, SearchGroup } from '../ui/search-controller';
import { routeMarker, stopMarker } from '../ui/search-controller';
import { t } from '../i18n/messages';
import type { StopPageRef } from './breadcrumbs';
import type { RoutePageRef } from './entity-render';
import type { GTFSScheduled } from './scheduled';

export interface ScheduleSearchGroups {
  stops: SearchGroup<StopPageRef>;
  routes: SearchGroup<RoutePageRef>;
}

/** Non-empty values only, so the haystack has no runs of blanks to match into. */
export function searchHaystack(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Stops (stations first) and routes. Empty groups when no feed is loaded. */
export function scheduleSearchGroups(
  feed: GTFSScheduled | null
): ScheduleSearchGroups {
  const stops: SearchEntry<StopPageRef>[] = [];
  for (const stop of feed?.stops.values() ?? []) {
    stops.push({
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
      priority: Number(stop.location_type) === 1 ? 0 : 1,
    });
  }

  const routes: SearchEntry<RoutePageRef>[] = [];
  for (const route of feed?.routes.values() ?? []) {
    const primary = route.short_name || route.long_name || route.id;
    routes.push({
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
    });
  }

  return {
    stops: { label: t('search.stops'), entries: stops },
    routes: { label: t('search.routes'), entries: routes },
  };
}
