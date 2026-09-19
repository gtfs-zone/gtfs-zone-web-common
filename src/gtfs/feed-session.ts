/**
 * The read-only view of a live session that the realtime modules here need.
 *
 * Same idea as `route-source.ts`: define the narrow surface the shared engine
 * reads and let each app satisfy it from its own storage. test-track's session
 * owns a GTFS-RT poller and fills these from decoded `.pb` payloads;
 * yard-master's fills them from an API and an SSE channel. Only these four
 * members are held in common, so only these four are named here.
 *
 * Read-only on purpose: nothing in this package writes to a session, and the
 * covariance of `ReadonlyMap` is what lets an app pass a map of its own
 * extended `VehiclePosition`.
 */

import type { GTFSScheduled } from './scheduled';
import type { AlertRecord, TripUpdate, VehiclePosition } from './rt-types';

/**
 * `V` is the app's own vehicle shape, which may carry more than this package
 * reads — yard-master's names the tracker a vehicle reports under. It is a
 * parameter rather than a widening so `rt-index.ts` can hand the app's own
 * vehicles back out of its indexes.
 */
export interface FeedSession<V extends VehiclePosition = VehiclePosition> {
  /** The parsed schedule, or null before one has loaded. */
  scheduledFeed: GTFSScheduled | null;
  /** Live vehicles by `VehiclePosition.key`. */
  vehicles: ReadonlyMap<string, V>;
  /** Live alerts by `AlertRecord.id`. */
  alerts: ReadonlyMap<string, AlertRecord>;
  /** The latest trip updates, as the producer sent them. */
  tripUpdates: readonly TripUpdate[];
}
