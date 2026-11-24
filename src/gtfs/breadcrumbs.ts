/**
 * Breadcrumb building blocks for the schedule and the decoded GTFS-RT alerts.
 *
 * Each realtime app builds its own trail over its own page-state union; what
 * they share is how a route, a stop and its `parent_station` chain, and an
 * alert's informed entity become crumbs. The crumbs here only carry the
 * `route` and `stop` page states, which every app's union includes.
 */

import { t } from '../i18n/messages';
import type { BreadcrumbItem } from '../ui/breadcrumb-trail';
import { stopTypeLabel } from '../ui/breadcrumb-trail';
import type { RoutePageRef } from './entity-render';
import type { AlertRecord } from './rt-types';
import type { GTFSScheduled } from './scheduled';
import type { TreeLocation, TripLocation } from './tree-location';
import { tripLocationValid } from './tree-location';

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
    typeLabel: t('crumb.route'),
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

/** The schedule-side pages the shared tree chain knows about. */
export type TreeCrumbLocation = Extract<
  TreeLocation,
  { type: 'feed_info' | 'agency' | 'route' | 'trip' | 'stop' }
>;

/** The crumbs a chain is built from, other than the page's own. */
type ChainLocation = Exclude<TreeCrumbLocation, TripLocation>;

/**
 * Labels and parents for the tree chain, from whatever holds the feed: the
 * loaded schedule, or a read from a worker. A lookup that returns null leaves
 * that crumb's label at the bare id and stops the chain above it.
 */
export interface TreeCrumbSource {
  agency(agencyId: string): { label: string } | null;
  /** `agency_id` is the route's agency, else the sole agency, else null. */
  route(routeId: string): { label: string; agency_id: string | null } | null;
  /** `routeId` is a hint where to look first. */
  trip(
    tripId: string,
    routeId?: string
  ): { label: string; route_id: string } | null;
  stop(stopId: string): {
    label: string;
    location_type?: number;
    parent_station?: string;
  } | null;
}

function agencyTreeCrumb(
  source: TreeCrumbSource,
  agencyId: string
): BreadcrumbItem<ChainLocation> {
  return {
    typeLabel: t('crumb.agency'),
    label: truncateCrumb(source.agency(agencyId)?.label || agencyId),
    pageState: { type: 'agency', agency_id: agencyId },
  };
}

/** Agency > Route; the Agency step is left out when it does not resolve. */
function routeTreeCrumbs(
  source: TreeCrumbSource,
  routeId: string
): BreadcrumbItem<ChainLocation>[] {
  const route = source.route(routeId);
  const crumb: BreadcrumbItem<ChainLocation> = {
    typeLabel: t('crumb.route'),
    label: truncateCrumb(route?.label || routeId),
    pageState: { type: 'route', route_id: routeId },
  };
  const agencyId = route?.agency_id;
  return agencyId !== null && agencyId !== undefined
    ? [agencyTreeCrumb(source, agencyId), crumb]
    : [crumb];
}

/** Ancestor stations, outermost first, then the stop. Guards against cycles. */
function stopTreeCrumbs(
  source: TreeCrumbSource,
  stopId: string
): BreadcrumbItem<ChainLocation>[] {
  const chain: string[] = [stopId];
  const seen = new Set<string>(chain);
  let parent = source.stop(stopId)?.parent_station;
  while (parent && !seen.has(parent) && source.stop(parent)) {
    chain.unshift(parent);
    seen.add(parent);
    parent = source.stop(parent)?.parent_station;
  }
  return chain.map((id) => {
    const stop = source.stop(id);
    return {
      typeLabel: stopTypeLabel(stop?.location_type),
      label: truncateCrumb(stop?.label || id),
      pageState: { type: 'stop', stop_id: id },
    };
  });
}

/**
 * The route a trip location hangs off: its scheduled trip's route, else its
 * `route_id` when that resolves, else null.
 */
function tripRouteId(
  source: TreeCrumbSource,
  loc: TripLocation
): string | null {
  const scheduled = loc.trip_id ? source.trip(loc.trip_id, loc.route_id) : null;
  if (scheduled) {
    return scheduled.route_id;
  }
  return loc.route_id && source.route(loc.route_id) ? loc.route_id : null;
}

/**
 * The shared chain below an app's root crumbs: Feed info; Agency; Agency >
 * Route; Agency > Route > Trip; [stations] > Stop. A trip whose route does not
 * resolve is a lone crumb. The app prepends its own root (and, in the realtime
 * apps, the Schedule crumb: see `rtTreeCrumbs`).
 */
export function treeCrumbs<L extends TreeCrumbLocation>(
  source: TreeCrumbSource,
  location: L
): BreadcrumbItem<ChainLocation | L>[] {
  const loc: TreeCrumbLocation = location;
  switch (loc.type) {
    case 'feed_info':
      return [
        {
          typeLabel: t('crumb.feedInfo'),
          label: t('crumb.feedInfo'),
          pageState: loc,
        },
      ];
    case 'agency':
      return [agencyTreeCrumb(source, loc.agency_id)];
    case 'route':
      return routeTreeCrumbs(source, loc.route_id);
    case 'trip': {
      const label =
        (loc.trip_id && source.trip(loc.trip_id, loc.route_id)?.label) ||
        loc.trip_id ||
        loc.start_time ||
        loc.entity_id ||
        t('crumb.trip');
      const crumb: BreadcrumbItem<L> = {
        typeLabel: t('crumb.trip'),
        label: truncateCrumb(label),
        pageState: location,
      };
      const routeId = tripRouteId(source, loc);
      return routeId ? [...routeTreeCrumbs(source, routeId), crumb] : [crumb];
    }
    case 'stop':
      return stopTreeCrumbs(source, loc.stop_id);
  }
}

type NodeLocation = Extract<
  TreeLocation,
  { type: 'schedule' | 'vehicle_positions' | 'trip_updates' | 'service_alerts' }
>;

const NODE_LABEL_KEYS = {
  schedule: 'crumb.schedule',
  vehicle_positions: 'crumb.vehiclePositions',
  trip_updates: 'crumb.tripUpdates',
  service_alerts: 'crumb.serviceAlerts',
} as const;

/** The crumb of one of the four nodes under the feed root. */
export function treeNodeCrumb(
  type: NodeLocation['type']
): BreadcrumbItem<NodeLocation> {
  const label = t(NODE_LABEL_KEYS[type]);
  return { typeLabel: label, label, pageState: { type } };
}

/** `TreeCrumbSource` plus what the realtime apps' pages need. */
export interface RtTreeSource extends TreeCrumbSource {
  hasFeedInfo(): boolean;
  vehicle(vehicleKey: string): { label: string } | null;
  alert(alertId: string): { label: string } | null;
  /** Whether the realtime data names this trip. */
  realtimeTrip(loc: TripLocation): boolean;
}

/**
 * A realtime app's chain below its root crumb, from D2: schedule-side pages
 * under Schedule, a trip whose route does not resolve under Trip updates,
 * vehicles and alerts under their node. Home has no chain.
 */
export function rtTreeCrumbs(
  source: RtTreeSource,
  loc: TreeLocation
): BreadcrumbItem<TreeLocation>[] {
  switch (loc.type) {
    case 'home':
      return [];
    case 'schedule':
    case 'vehicle_positions':
    case 'trip_updates':
    case 'service_alerts':
      return [treeNodeCrumb(loc.type)];
    case 'vehicle':
      return [
        treeNodeCrumb('vehicle_positions'),
        {
          typeLabel: t('crumb.vehicle'),
          label: truncateCrumb(
            source.vehicle(loc.vehicle_key)?.label || loc.vehicle_key
          ),
          pageState: loc,
        },
      ];
    case 'alert':
      return [
        treeNodeCrumb('service_alerts'),
        {
          typeLabel: t('crumb.alert'),
          // The eyebrow already says "Service alert", so the fallback is the id.
          label: truncateCrumb(
            source.alert(loc.alert_id)?.label || loc.alert_id
          ),
          pageState: loc,
        },
      ];
    case 'trip': {
      const parent =
        tripRouteId(source, loc) !== null
          ? treeNodeCrumb('schedule')
          : treeNodeCrumb('trip_updates');
      return [parent, ...treeCrumbs(source, loc)];
    }
    default:
      return [treeNodeCrumb('schedule'), ...treeCrumbs(source, loc)];
  }
}

/**
 * Whether a tree location names something in the loaded data. Schedule and
 * the realtime nodes always do; Phase 5 widens route and stop to realtime ids.
 */
export function validateTreeLocation(
  source: RtTreeSource,
  loc: TreeLocation
): boolean {
  switch (loc.type) {
    case 'home':
    case 'schedule':
    case 'vehicle_positions':
    case 'trip_updates':
    case 'service_alerts':
      return true;
    case 'feed_info':
      return source.hasFeedInfo();
    case 'agency':
      return source.agency(loc.agency_id) !== null;
    case 'route':
      return source.route(loc.route_id) !== null;
    case 'trip':
      return (
        tripLocationValid(loc) &&
        ((loc.trip_id !== undefined &&
          source.trip(loc.trip_id, loc.route_id) !== null) ||
          source.realtimeTrip(loc))
      );
    case 'stop':
      return source.stop(loc.stop_id) !== null;
    case 'vehicle':
      return source.vehicle(loc.vehicle_key) !== null;
    case 'alert':
      return source.alert(loc.alert_id) !== null;
  }
}

/** `TreeCrumbSource` over the parsed schedule, which may not be loaded. */
export function scheduledCrumbSource(feed: Feed): TreeCrumbSource {
  const soleAgency = (): string | null =>
    feed?.agencies.length === 1 ? feed.agencies[0].id : null;
  return {
    agency(agencyId) {
      const agency = feed?.agencies.find((a) => a.id === agencyId);
      return agency ? { label: agency.name || agency.id } : null;
    },
    route(routeId) {
      const route = feed?.routes.get(routeId);
      if (!route) {
        return null;
      }
      const known =
        route.agency_id && feed?.agencies.some((a) => a.id === route.agency_id);
      return {
        label: routeLabel(feed, routeId),
        agency_id: known ? route.agency_id : soleAgency(),
      };
    },
    trip(tripId, routeId) {
      const trip = feed?.findTrip(tripId, routeId);
      return trip
        ? { label: trip.headsign || trip.trip_id, route_id: trip.route_id }
        : null;
    },
    stop(stopId) {
      const stop = feed?.stops.get(stopId);
      return stop
        ? {
            label: stop.name || stop.id,
            location_type: stop.location_type,
            parent_station: stop.parent_station,
          }
        : null;
    },
  };
}
