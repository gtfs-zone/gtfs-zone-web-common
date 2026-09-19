/**
 * The GTFS-RT payload types the realtime modules here are written against, and
 * the one runtime helper that reads them.
 *
 * Types only, plus `presentNumber`. `gtfs-realtime-bindings` is an optional
 * peer dependency for exactly this reason: the interfaces it declares are the
 * honest description of a GTFS-RT message and are worth keeping, while the
 * generated decoder underneath them is 400kB an app that never decodes a `.pb`
 * has no use for. Importing the namespace as a type keeps protobufjs out of
 * the bundle.
 *
 * `VehiclePosition` is the exception: it is this package's own normalized
 * shape, not a generated one, because a vehicle reaches a consumer either as a
 * decoded `.pb` entity or as JSON off a channel, and the renderers have to
 * read both the same way.
 */

import type { transit_realtime } from 'gtfs-realtime-bindings';

export type TripUpdate = transit_realtime.ITripUpdate;
export type ServiceAlert = transit_realtime.IAlert;

/**
 * An alert plus the identity it is addressed by.
 *
 * GTFS-RT alerts carry no id of their own — only the enclosing `FeedEntity.id`
 * — so that is what the alert page is keyed on. Some producers regenerate
 * entity ids between polls, which means a focused alert can vanish even though
 * the same disruption is still being reported. There is nothing better to key
 * on; the UI has to tolerate it.
 */
export interface AlertRecord {
  id: string;
  alert: ServiceAlert;
  /** Plain-object form of the same alert, for the alert page's raw dump. */
  raw: unknown;
}

/**
 * One vehicle's reported position, normalized.
 *
 * Consumers extend this where they carry more: yard-master's adds the tracker
 * a vehicle reports under. Nothing in this package reads beyond these fields.
 */
export interface VehiclePosition {
  /**
   * The internal instance handle: the map feature id, the key in
   * `FeedSession.vehicles`, and the click identity. Derived to be unique per
   * vehicle instance even when the feed's `vehicle.id` is not.
   */
  key: string;
  /**
   * The feed's `vehicle.id`, **verbatim** — duplicated, empty, whatever the feed
   * said. This is reportage, never plumbing: it is what the vehicle page shows
   * and dumps, and never synthesized.
   */
  vehicleId: string;
  entityId: string;
  label?: string;
  lat: number;
  lon: number;
  bearing?: number;
  /** Metres per second, as the spec defines it. */
  speed?: number;
  tripId?: string;
  routeId?: string;
  directionId?: string;
  startDate?: string;
  startTime?: string;
  /** TripDescriptor.schedule_relationship, or undefined when the producer omitted it. */
  scheduleRelationship?: number;
  /**
   * The GTFS `stop_sequence` value of the stop the vehicle is working on — not
   * an index into the trip's stop list. Absent in many feeds, which is why the
   * route strip has an "unplaced vehicles" section.
   */
  currentStopSequence?: number;
  /** `stop_id` of the same stop, when the feed reports it. */
  stopId?: string;
  /** VehicleStopStatus: 0 INCOMING_AT, 1 STOPPED_AT, 2 IN_TRANSIT_TO. */
  currentStatus?: number;
  occupancyStatus?: number;
  /** Seconds since epoch, per the spec. Stale values are worth surfacing. */
  timestamp?: number;
  /** The decoded entity, kept verbatim for the vehicle page's raw dump. */
  raw: unknown;
}

/**
 * A numeric field, or `undefined` when the producer did not send it.
 *
 * Whether a field was actually on the wire is an own-property question, not a
 * nullish one. The generated bindings keep every proto2 default on the message
 * *prototype* (`VehiclePosition.prototype.currentStopSequence = 0`,
 * `currentStatus = 2`), and a decoder only assigns own properties for what it
 * read, so `msg.currentStopSequence ?? undefined` can never yield `undefined`
 * and an absent field is indistinguishable from a reported zero unless the
 * own-property is checked.
 *
 * Reading such a field without that check is worse than useless: an absent
 * `int64` reads back as `Long{0,0}`, which is finite, so the value comes out as
 * `0` — midnight 1970 for a time, "on time" for a delay. Both are things the
 * feed never said. The coercion is for the same 64-bit fields: they decode to
 * `Long` objects rather than numbers, and `Number(long)` goes through the
 * Long's own `toString`, so this works whether or not Long support was
 * installed.
 *
 * `msg` is nullable so the whole containing message may be absent, as in
 * `presentNumber(stu.arrival, 'time')`.
 */
export function presentNumber(
  msg: object | null | undefined,
  field: string
): number | undefined {
  if (!msg || !Object.prototype.hasOwnProperty.call(msg, field)) {
    return undefined;
  }
  const n = Number((msg as Record<string, unknown>)[field]);
  return Number.isFinite(n) ? n : undefined;
}
