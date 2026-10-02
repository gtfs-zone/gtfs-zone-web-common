/**
 * Breadcrumb building blocks for the schedule and the decoded GTFS-RT alerts.
 *
 * Each realtime app builds its own trail over its own page-state union; what
 * they share is how a route, a stop and its `parent_station` chain, and an
 * alert's informed entity become crumbs. The crumbs here only carry the
 * `route` and `stop` page states, which every app's union includes.
 */

import type { BreadcrumbItem } from '../ui/breadcrumb-trail';
import { stopTypeLabel } from '../ui/breadcrumb-trail';
import type { RoutePageRef } from './entity-render';
import type { AlertRecord } from './rt-types';
import type { GTFSScheduled } from './scheduled';

export interface StopPageRef {
  type: 'stop';
  stop_id: string;
}

type Feed = GTFSScheduled | null | undefined;

/**
 * Cap a crumb label's length. Some GTFS-RT producers put full sentences in an
 * alert's `header_text`, which would wrap a crumb across several lines.
 */
export function truncateCrumb(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** A route's short name, long name, or the bare id. */
function routeLabel(feed: Feed, routeId: string): string {
  const route = feed?.routes.get(routeId);
  if (!route) {
    return routeId;
  }
  return route.short_name || route.long_name || route.id;
}

function stopLabel(feed: Feed, stopId: string): string {
  return feed?.stops.get(stopId)?.name || stopId;
}

export function routeCrumb(
  feed: Feed,
  routeId: string
): BreadcrumbItem<RoutePageRef> {
  return {
    typeLabel: 'Route',
    label: truncateCrumb(routeLabel(feed, routeId)),
    pageState: { type: 'route', route_id: routeId },
  };
}

function stopCrumb(feed: Feed, stopId: string): BreadcrumbItem<StopPageRef> {
  return {
    typeLabel: stopTypeLabel(feed?.stops.get(stopId)?.location_type),
    label: truncateCrumb(stopLabel(feed, stopId)),
    pageState: { type: 'stop', stop_id: stopId },
  };
}

/**
 * The parents leading to a stop, outermost first, then the stop itself.
 *
 * `parent_station` is a single edge in practice, but the loop guards against a
 * feed with a cycle rather than hanging on one.
 */
export function stopCrumbs(
  feed: Feed,
  stopId: string
): BreadcrumbItem<StopPageRef>[] {
  const chain: string[] = [];
  const seen = new Set<string>([stopId]);
  let parent = feed?.stops.get(stopId)?.parent_station;
  while (parent && !seen.has(parent) && feed?.stops.has(parent)) {
    chain.unshift(parent);
    seen.add(parent);
    parent = feed.stops.get(parent)?.parent_station;
  }
  return [...chain, stopId].map((id) => stopCrumb(feed, id));
}

/** The crumb for the page an alert hangs off: a route or a stop. */
export function alertParentCrumb(
  feed: Feed,
  parent: RoutePageRef | StopPageRef
): BreadcrumbItem<RoutePageRef | StopPageRef> {
  return parent.type === 'route'
    ? routeCrumb(feed, parent.route_id)
    : stopCrumb(feed, parent.stop_id);
}

/** A decoded alert's first header translation, or null. */
export function rtAlertHeader(
  alerts: ReadonlyMap<string, AlertRecord>,
  alertId: string
): string | null {
  const header = alerts.get(alertId)?.alert.headerText?.translation?.[0]?.text;
  return header ? String(header) : null;
}

/** The first route or stop a decoded alert informs, or null. */
export function rtAlertParent(
  alerts: ReadonlyMap<string, AlertRecord>,
  alertId: string
): RoutePageRef | StopPageRef | null {
  for (const entity of alerts.get(alertId)?.alert.informedEntity ?? []) {
    if (entity.routeId) {
      return { type: 'route', route_id: entity.routeId };
    }
    if (entity.stopId) {
      return { type: 'stop', stop_id: entity.stopId };
    }
  }
  return null;
}
