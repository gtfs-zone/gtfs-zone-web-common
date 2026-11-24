/**
 * What the shared realtime pages (route, stop, alert) are handed besides the
 * session: the page refs they link to on their own, and the app's links for a
 * vehicle and a trip, which each app makes differently.
 */

import type { StopPageRef } from './breadcrumbs';
import type { PageRef, RoutePageRef } from './entity-render';
import type { VehiclePosition } from './rt-types';
import type { TripLocation } from './tree-location';

interface AlertPageRef {
  type: 'alert';
  alert_id: string;
}

/** The pages the shared realtime pages link to without asking the app. */
export type RtPageRef = RoutePageRef | StopPageRef | AlertPageRef;

export interface RtPageHooks<S extends PageRef, V extends VehiclePosition> {
  /** The page a vehicle links to. */
  vehicleLink: (vehicle: V) => S;
  /** The page a trip links to; unlinked when absent or undefined. */
  tripLink?: (loc: TripLocation) => S | undefined;
}
