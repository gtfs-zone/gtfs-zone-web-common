/**
 * What the shared realtime pages (route, stop, alert) are handed besides the
 * session: the page refs they link to on their own, and the app's half of the
 * vehicle, which each app links and names differently.
 */

import type { StopPageRef } from './breadcrumbs';
import type { PageRef, RoutePageRef } from './entity-render';
import type { VehiclePosition } from './rt-types';

interface AlertPageRef {
  type: 'alert';
  alert_id: string;
}

/** The pages the shared realtime pages link to without asking the app. */
export type RtPageRef = RoutePageRef | StopPageRef | AlertPageRef;

export interface RtPageHooks<S extends PageRef, V extends VehiclePosition> {
  /** The page a vehicle links to. */
  vehicleLink: (vehicle: V) => S;
  /** What the app calls a vehicle, lowercase singular: "vehicle", "tracker". */
  vehicleNoun: string;
}

/** `vehicleNoun` as a capitalized plural, for section titles. */
export function vehiclesTitle(noun: string): string {
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)}s`;
}
