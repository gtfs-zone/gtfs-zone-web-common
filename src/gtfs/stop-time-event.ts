/**
 * One StopTimeEvent (the arrival or departure of a StopTimeUpdate), resolved
 * against the schedule, with every value tagged by where it came from.
 *
 * The spec lets a producer send `time`, `delay`, or both. Whichever half is
 * missing is computable from the schedule, and showing it is useful, but it is
 * not something the feed said. So each value carries an origin, and the
 * renderers mark `derived` ones.
 *
 * An event is only resolved from its own fields. Delay propagation to later
 * stops, and arrival-to-departure within a stop, are not applied.
 */

import type { transit_realtime } from 'gtfs-realtime-bindings';
import type { StopTime } from './scheduled';
import { presentNumber } from './rt-types';
import type { TripUpdate } from './rt-types';
import { feedServiceDate, parseGtfsClock, serviceDayStart } from './feed-time';

export type StopTimeUpdate = transit_realtime.TripUpdate.IStopTimeUpdate;

type ValueOrigin = 'feed' | 'derived';

export interface ResolvedEvent {
  kind: 'arrival' | 'departure';
  /** The `stop_times` value verbatim, when the stop was matched. */
  scheduledText?: string;
  /** Epoch seconds of `scheduledText` on the resolved service date. */
  scheduled?: number;
  /** Epoch seconds. */
  time?: number;
  timeFrom?: ValueOrigin;
  /** Seconds; positive is late. */
  delay?: number;
  delayFrom?: ValueOrigin;
  /** Seconds, only when the feed sent it. */
  uncertainty?: number;
  /** The feed sent `time` or `delay` for this event. */
  reported: boolean;
}

/** How the scheduled stop and service date behind the derived values were found. */
export interface ScheduleMatch {
  stopTime?: StopTime;
  /** Matched by `stop_id` on a trip that visits that stop more than once. */
  ambiguousStop: boolean;
  /** `start_date` was absent, so the service date was picked as the nearest one. */
  serviceDateInferred: boolean;
}

/**
 * The scheduled stop_time for a StopTimeUpdate: by `stop_sequence`, else the
 * first visit to its `stop_id`.
 */
export function matchStopTime(
  times: StopTime[] | undefined,
  sequence: number | undefined,
  stopId: string
): { stopTime?: StopTime; ambiguous: boolean } {
  if (!times) {
    return { ambiguous: false };
  }
  if (sequence !== undefined) {
    return {
      stopTime: times.find((t) => t.stop_sequence === sequence),
      ambiguous: false,
    };
  }
  const visits = times.filter((t) => t.stop_id === stopId);
  return { stopTime: visits[0], ambiguous: visits.length > 1 };
}

/**
 * Resolve both events of one StopTimeUpdate.
 *
 * Derivation only runs where the schedule applies: a SCHEDULED (or unset) stop
 * on a SCHEDULED (or unset) trip. A SKIPPED or NO_DATA stop, or an ADDED,
 * CANCELED, REPLACEMENT or DUPLICATED trip, shows only what the feed sent.
 */
export function resolveStopTimeUpdate(
  stu: StopTimeUpdate,
  update: TripUpdate,
  match: { stopTime?: StopTime; ambiguous: boolean },
  nowSeconds: number
): { arrival: ResolvedEvent; departure: ResolvedEvent; match: ScheduleMatch } {
  const stopRel = presentNumber(stu, 'scheduleRelationship');
  const tripRel = presentNumber(update.trip, 'scheduleRelationship');
  const derive = !stopRel && !tripRel;

  const arrival = readEvent('arrival', stu.arrival);
  const departure = readEvent('departure', stu.departure);
  const st = match.stopTime;
  if (st) {
    arrival.scheduledText = st.arrival_time || undefined;
    departure.scheduledText = st.departure_time || undefined;
  }

  // The service date anchors scheduled clock times to epoch seconds. Without
  // start_date, take whichever of yesterday, today, tomorrow puts the
  // schedule nearest the feed's own time, or now if it sent none.
  const startDate = update.trip?.startDate?.trim();
  const anchor = departure.time ?? arrival.time ?? nowSeconds;
  const dayStart = startDate
    ? serviceDayStart(startDate)
    : nearestDayStart(
        parseGtfsClock(departure.scheduledText ?? arrival.scheduledText),
        anchor
      );

  for (const ev of [arrival, departure]) {
    const clock = parseGtfsClock(ev.scheduledText);
    if (clock !== null && dayStart !== null) {
      ev.scheduled = dayStart + clock;
    }
    if (!derive || ev.scheduled === undefined) {
      continue;
    }
    if (ev.time === undefined && ev.delay !== undefined) {
      ev.time = ev.scheduled + ev.delay;
      ev.timeFrom = 'derived';
    } else if (ev.delay === undefined && ev.time !== undefined) {
      ev.delay = ev.time - ev.scheduled;
      ev.delayFrom = 'derived';
    }
  }

  return {
    arrival,
    departure,
    match: {
      stopTime: st,
      ambiguousStop: match.ambiguous,
      serviceDateInferred: !startDate,
    },
  };
}

function readEvent(
  kind: ResolvedEvent['kind'],
  ev: transit_realtime.TripUpdate.IStopTimeEvent | null | undefined
): ResolvedEvent {
  const time = presentNumber(ev, 'time');
  const delay = presentNumber(ev, 'delay');
  return {
    kind,
    time,
    timeFrom: time === undefined ? undefined : 'feed',
    delay,
    delayFrom: delay === undefined ? undefined : 'feed',
    uncertainty: presentNumber(ev, 'uncertainty'),
    reported: time !== undefined || delay !== undefined,
  };
}

function nearestDayStart(clock: number | null, anchor: number): number | null {
  if (clock === null) {
    return null;
  }
  let best: number | null = null;
  for (const offset of [-1, 0, 1]) {
    const start = serviceDayStart(feedServiceDate(anchor * 1000, offset));
    if (
      start !== null &&
      (best === null ||
        Math.abs(start + clock - anchor) < Math.abs(best + clock - anchor))
    ) {
      best = start;
    }
  }
  return best;
}
