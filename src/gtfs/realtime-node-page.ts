/**
 * The three realtime nodes under the feed root: Vehicle positions, Trip
 * updates and Service alerts. Each shows its endpoint's status, the
 * diagnostics that belong to that entity type, and a list of what the last
 * poll carried. Also the one-line rows Home uses to link to them.
 */

import type { EndpointStatus } from './rt-poller';
import type { FeedGaps, RtIndex, ScheduleRelationshipCounts } from './rt-index';
import type { TripUpdate, VehiclePosition } from './rt-types';
import { presentNumber } from './rt-types';
import type { LinkContext, PageRef, RenderContext } from './entity-render';
import {
  STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS,
  TRIP_SCHEDULE_RELATIONSHIP_LABELS,
  escHtml,
  formatRelative,
  tripRelationshipMark,
  vehicleDisplayName,
  vehicleRouteId,
} from './entity-render';
import {
  renderEndpointStatus,
  type EndpointStatusOptions,
} from './endpoint-status';
import { entityRow } from './entity-row';
import { roleIcon } from './feed-badges';
import { isActiveNow } from './alerts';
import { alertListOptions } from './alert-page';
import type { RtPageRef } from './rt-page';
import { listSection, type TreePage, type TreeSection } from './tree-page';
import { treeNodeCrumb } from './breadcrumbs';
import { t } from '../i18n/messages';

/** An endpoint's status and how to show its URL. */
export interface NodeEndpoint {
  status: EndpointStatus;
  options: EndpointStatusOptions;
}

export interface RealtimeNodeOptions {
  /** The endpoint, or null when the selection names none. */
  endpoint: NodeEndpoint | null;
  /** Markup shown instead of the endpoint block when there is none. */
  noEndpoint?: string;
  /** Sections inserted before the node's list. */
  extraSections?: TreeSection[];
}

const VEHICLE_ID_STRATEGY_KEYS = {
  trip: 'node.idTrip',
  entity: 'node.idEntity',
  index: 'node.idIndex',
} as const;

/**
 * The note shown when the vehicles feed's `vehicle.id` is not unique per
 * vehicle, naming the offending ids. Empty for a well-formed feed.
 */
function vehicleIdReport(ep: EndpointStatus): string {
  const strategy = ep.vehicleIdStrategy;
  if (ep.name !== 'vehicles' || !strategy || strategy === 'unique') {
    return '';
  }

  const dups = ep.vehiclesDuplicateIds;
  const list = dups.length
    ? `<ul class="mt-1 space-y-0.5">${dups
        .map(
          (d) =>
            `<li><span class="font-mono break-all">${escHtml(d.vehicleId || t('node.empty'))}</span> - ${escHtml(t('node.dupVehicles', { count: d.count }))}</li>`
        )
        .join('')}</ul>`
    : '';

  return `
    <div class="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs space-y-1">
      <p class="font-medium">${escHtml(t('node.idNotUnique'))}</p>
      <p class="opacity-70">${t('node.idNotUniqueText', {
        field: '<span class="font-mono">VehicleDescriptor.id</span>',
        strategy: escHtml(t(VEHICLE_ID_STRATEGY_KEYS[strategy])),
      })}</p>
      ${list}
    </div>`;
}

function endpointSection(options: RealtimeNodeOptions): TreeSection {
  const ep = options.endpoint;
  return {
    title: t('node.endpoint'),
    body: ep
      ? renderEndpointStatus(ep.status, {
          ...ep.options,
          footer: `${vehicleIdReport(ep.status)}${ep.options.footer ?? ''}`,
        })
      : (options.noEndpoint ??
        `<p class="text-xs opacity-60">${escHtml(t('node.notConfigured'))}</p>`),
  };
}

/**
 * How the vehicles feed names each vehicle's current stop. Neutral when it
 * only uses `stop_id`, a warning when positions had to be inferred or could
 * not be placed. Null when every vehicle reports its stop sequence.
 */
function feedGapsSection(gaps: FeedGaps): TreeSection | null {
  if (gaps.missingStopSequence === 0) {
    return null;
  }
  const unplaced =
    gaps.missingStopSequence -
    gaps.resolvedFromStopId -
    gaps.stopSequenceDerived;
  const inferred = gaps.stopSequenceDerived > 0 || unplaced > 0;

  const notes = [
    t('node.gapsOptional', {
      missing: gaps.missingStopSequence,
      total: gaps.vehicles,
    }),
  ];
  if (gaps.resolvedFromStopId > 0) {
    notes.push(
      t('node.gapsStopId', {
        count: gaps.resolvedFromStopId,
        field: '<span class="font-mono">stop_id</span>',
      })
    );
  }
  if (gaps.stopSequenceDerived > 0) {
    notes.push(
      t('node.gapsDerived', {
        count: gaps.stopSequenceDerived,
        field: '<span class="font-mono">stop_time_update</span>',
      })
    );
  }
  if (unplaced > 0) {
    notes.push(t('node.gapsUnplaced', { count: unplaced }));
  }

  return {
    title: inferred ? t('node.gaps') : t('node.gapsNeutral'),
    body: `
      <div class="rounded-lg border ${inferred ? 'border-warning/40' : 'border-base-300'} p-3 space-y-2">
        <div class="flex justify-between gap-2 text-xs">
          <span>${t('node.gapsRow', { field: '<span class="font-mono">current_stop_sequence</span>' })}</span>
          <span class="tabular-nums font-semibold">${gaps.missingStopSequence}</span>
        </div>
        <p class="text-xs opacity-50">${notes.join(' ')}</p>
      </div>`,
  };
}

/**
 * Trips and stop times the producer took outside SCHEDULED, vehicles and trip
 * updates counted apart. Null when every count is SCHEDULED or absent.
 */
function relationshipsSection(
  counts: ScheduleRelationshipCounts
): TreeSection | null {
  const line = (label: string, n: number): string => `
    <div class="flex justify-between gap-2 text-xs">
      <span>${escHtml(label)}</span>
      <span class="tabular-nums font-semibold">${n}</span>
    </div>`;

  const rows: string[] = [];
  const tally = (
    map: Map<number, number>,
    labels: Record<number, string>,
    key: 'node.relVehicles' | 'node.relUpdates' | 'node.relStopTimes'
  ): void => {
    for (const [relationship, n] of map) {
      if (relationship !== 0) {
        const label = labels[relationship] ?? String(relationship);
        rows.push(line(t(key, { count: n, label }), n));
      }
    }
  };
  tally(
    counts.vehicleTrips,
    TRIP_SCHEDULE_RELATIONSHIP_LABELS,
    'node.relVehicles'
  );
  tally(
    counts.updateTrips,
    TRIP_SCHEDULE_RELATIONSHIP_LABELS,
    'node.relUpdates'
  );
  tally(
    counts.stopTimes,
    STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS,
    'node.relStopTimes'
  );
  if (rows.length === 0) {
    return null;
  }

  return {
    title: t('node.relTitle'),
    body: `
      <div class="rounded-lg border border-base-300 p-3 space-y-2">
        ${rows.join('')}
        <p class="text-xs opacity-50">${escHtml(t('node.relNote'))}</p>
      </div>`,
  };
}

function present(sections: (TreeSection | null | undefined)[]): TreeSection[] {
  return sections.filter((s): s is TreeSection => !!s);
}

function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export interface VehiclePositionsOptions<
  S extends PageRef,
  V,
> extends RealtimeNodeOptions {
  /** The page a vehicle row links to. */
  vehicleLink: (vehicle: V) => S;
}

/** The Vehicle positions node. */
export function vehiclePositionsPage<
  S extends PageRef,
  V extends VehiclePosition,
>(
  ctx: RenderContext<S>,
  index: RtIndex<V>,
  options: VehiclePositionsOptions<S, V>
): TreePage {
  const feed = ctx.session.scheduledFeed;
  const rows = [...ctx.session.vehicles.values()].map((vehicle) => {
    const routeId = vehicleRouteId(feed, vehicle);
    const route = routeId ? feed?.routes.get(routeId) : undefined;
    const routeName = route
      ? route.short_name || route.long_name || route.id
      : (routeId ?? '');
    return {
      vehicle: vehicle as V,
      label: vehicleDisplayName(feed, vehicle),
      routeName,
      color: route?.color,
    };
  });
  rows.sort((a, b) => compareLabels(a.label, b.label));

  return {
    eyebrow: t('crumb.vehiclePositions'),
    title: t('crumb.vehiclePositions'),
    sections: present([
      endpointSection(options),
      feedGapsSection(index.gaps),
      ...(options.extraSections ?? []),
      listSection(t('node.vehicles'), {
        name: 'vehicles',
        items: rows,
        row: (row) =>
          entityRow<S>(ctx, {
            state: options.vehicleLink(row.vehicle),
            label: row.label,
            sublabel: row.routeName,
            color: row.color,
            leadHtml: tripRelationshipMark(row.vehicle.scheduleRelationship),
          }),
        searchText: (row) =>
          `${row.label} ${row.routeName} ${row.vehicle.vehicleId} ${row.vehicle.tripId ?? ''}`,
        empty: t('node.noVehicles'),
      }),
    ]),
  };
}

export interface TripUpdatesOptions<
  S extends PageRef,
> extends RealtimeNodeOptions {
  /** The page a trip update row links to; a row without one is text. */
  tripLink?: (update: TripUpdate) => S | undefined;
}

/** The Trip updates node. */
export function tripUpdatesPage<S extends PageRef>(
  ctx: RenderContext<S>,
  index: RtIndex,
  options: TripUpdatesOptions<S>
): TreePage {
  const feed = ctx.session.scheduledFeed;
  const rows = ctx.session.tripUpdates.map((update, i) => {
    const desc = update.trip;
    const tripId = desc?.tripId ?? '';
    const trip = tripId ? feed?.trips.get(tripId) : undefined;
    const routeId = desc?.routeId || trip?.route_id || '';
    const route = routeId ? feed?.routes.get(routeId) : undefined;
    const routeName = route
      ? route.short_name || route.long_name || route.id
      : routeId;
    const start = [desc?.startDate, desc?.startTime].filter(Boolean).join(' ');
    return {
      update,
      label: trip?.headsign || tripId || t('node.updateFallback', { n: i + 1 }),
      sublabel: [routeName, tripId && trip?.headsign ? tripId : '', start]
        .filter(Boolean)
        .join(' - '),
      color: route?.color,
      relationship: presentNumber(desc, 'scheduleRelationship'),
    };
  });

  return {
    eyebrow: t('crumb.tripUpdates'),
    title: t('crumb.tripUpdates'),
    sections: present([
      endpointSection(options),
      relationshipsSection(index.relationships),
      ...(options.extraSections ?? []),
      listSection(t('node.updates'), {
        name: 'trip-updates',
        items: rows,
        row: (row) =>
          entityRow<S>(ctx, {
            state: options.tripLink?.(row.update),
            label: row.label,
            sublabel: row.sublabel,
            color: row.color,
            leadHtml: tripRelationshipMark(row.relationship),
          }),
        searchText: (row) => `${row.label} ${row.sublabel}`,
        empty: t('node.noUpdates'),
      }),
    ]),
  };
}

/** The Service alerts node, the active-count line above the list. */
export function serviceAlertsPage(
  ctx: RenderContext<RtPageRef>,
  options: RealtimeNodeOptions
): TreePage {
  const records = [...ctx.session.alerts.values()];
  const active = records.filter((r) => isActiveNow(r.alert)).length;
  return {
    eyebrow: t('crumb.serviceAlerts'),
    title: t('crumb.serviceAlerts'),
    sections: present([
      endpointSection(options),
      ...(options.extraSections ?? []),
      listSection(
        t('node.alerts'),
        alertListOptions(ctx, records, t('alerts.none')),
        {
          body: records.length
            ? `<p class="text-xs opacity-60">${escHtml(t('alerts.activeOf', { active, total: records.length }))}</p>`
            : '',
        }
      ),
    ]),
  };
}

/** The nodes Home links to, by role. */
const NODE_ROLES = {
  schedule: 'scheduled',
  vehicle_positions: 'vehicles',
  trip_updates: 'trip_updates',
  service_alerts: 'alerts',
} as const;

export type TreeNodeType = keyof typeof NODE_ROLES;

/** One node's line on Home. */
export interface TreeNodeState {
  type: TreeNodeType;
  /** One line: loaded, fetched, error, not configured. */
  state: string;
  /** Epoch ms the state's age counts from, shown live beside it. */
  since?: number;
}

/** What an endpoint's node row says about it. */
export function endpointNodeState(
  type: Exclude<TreeNodeType, 'schedule'>,
  ep: EndpointStatus | null
): TreeNodeState {
  if (!ep?.url) {
    return { type, state: t('node.stateNotConfigured') };
  }
  if (ep.lastError) {
    return {
      type,
      state: t('node.stateError', { message: ep.lastError }),
      since: ep.lastErrorAt ?? undefined,
    };
  }
  if (ep.lastFetchedAt) {
    return { type, state: t('node.stateFetched'), since: ep.lastFetchedAt };
  }
  return { type, state: t('node.stateWaiting') };
}

/** Home's rows for the four nodes. */
export function treeNodeRows(
  ctx: LinkContext<{ type: TreeNodeType }>,
  nodes: TreeNodeState[]
): string {
  return `<ul class="-mx-2">${nodes
    .map((node) =>
      entityRow<{ type: TreeNodeType }>(ctx, {
        state: { type: node.type },
        leadHtml: roleIcon(NODE_ROLES[node.type], 'h-4 w-4'),
        label: treeNodeCrumb(node.type).label,
        sublabel: node.state,
        badgeHtml:
          node.since === undefined
            ? undefined
            : `<span class="text-xs opacity-60" data-since="${node.since}">${escHtml(formatRelative(node.since))}</span>`,
      })
    )
    .join('')}</ul>`;
}
