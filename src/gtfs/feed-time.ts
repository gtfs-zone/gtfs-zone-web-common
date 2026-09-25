/**
 * Timezone policy for everything an app prints as a *transit* time.
 *
 * A GTFS feed describes a place, and every time in it is anchored to that
 * place's clock: `stop_times.txt` holds bare agency-local strings with no zone
 * at all, and GTFS-RT holds absolute epoch seconds. Render the first verbatim
 * and the second in the browser's zone, which is the naive reading, and the
 * two columns silently disagree by the offset between the reader and
 * the railroad. Reading an Amtrak feed from Copenhagen showed a 09:30 schedule
 * against a "03:30 PM" prediction, both correct, six hours apart, with the
 * delay column cheerfully reporting "on time".
 *
 * So: one display zone, taken from `agency.txt`, applied to both columns.
 *
 * The zone lives in module state rather than being threaded through every
 * formatter because exactly one scheduled feed is loaded at a time — the session
 * owns a single `scheduledFeed` — and the alternative is an extra argument on
 * every call site of every time formatter on every page.
 */

import type { GTFSScheduled } from './scheduled';
import { moduleState } from '../util/module-state';

const shared = moduleState('gtfs/feed-time', () => ({
  /** The IANA zone of the loaded feed, or null to mean "use the browser's". */
  displayZone: null as string | null,
}));

/**
 * Feeds are not obliged to carry a usable `agency_timezone`, and a malformed
 * one throws from `Intl` at format time rather than here. Probe it once on
 * load so a bad value degrades to browser-local instead of blanking a page.
 */
function isUsableZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Adopt the loaded feed's zone. Multi-agency feeds are rare in this tool's
 * diet and near-always share one zone; the first agency that names a valid one
 * wins, which beats rendering a mix.
 */
export function adoptFeedTimezone(feed: GTFSScheduled | null): void {
  const tz = feed?.agencies
    .map((a) => a.timezone.trim())
    .find((t) => t && isUsableZone(t));
  shared.displayZone = tz ?? null;
}

/** The zone transit times are being rendered in, or null for browser-local. */
export function feedTimezone(): string | null {
  return shared.displayZone;
}

/**
 * The short zone label to hang off a printed time — "EDT", or "GMT+2" where
 * the zone has no common abbreviation. Depends on the instant, since it has to
 * say EDT in July and EST in January.
 */
export function zoneLabel(atMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: shared.displayZone ?? undefined,
    timeZoneName: 'short',
    hour: 'numeric',
  }).formatToParts(new Date(atMs));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/**
 * A time that describes *this browser's* activity rather than the railroad's —
 * when a poll landed, when a vehicle was last seen. These stay in the reader's
 * zone deliberately, but they get an explicit label too, so a local clock time
 * sitting near a feed clock time can't be mistaken for one.
 */
export function localClock(ms: number): string {
  const clock = new Date(ms).toLocaleTimeString();
  const zone = new Intl.DateTimeFormat('en-US', {
    timeZoneName: 'short',
    hour: 'numeric',
  })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName')?.value;
  return zone ? `${clock} ${zone}` : clock;
}

/** `09:30 AM` in the feed's zone, from GTFS-RT epoch seconds. */
export function clockAt(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString([], {
    timeZone: shared.displayZone ?? undefined,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A GTFS `HH:MM:SS` clock time, which is seconds since noon-minus-12h of the
 * *service* day and so legitimately runs past 24:00:00 for a train that leaves
 * before midnight and arrives after it. Returns the seconds, or null if the
 * field is absent or not a clock time.
 */
export function parseGtfsClock(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const m = /^\s*(\d{1,3}):([0-5]\d):([0-5]\d)\s*$/.exec(value);
  if (!m) {
    return null;
  }
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Format a scheduled time for display next to a realtime prediction.
 *
 * No zone conversion happens — the value is already in the feed's zone, which
 * is the zone we render predictions in — so this is pure clock arithmetic. A
 * time past 24:00:00 is shown as its wall-clock equivalent with an explicit
 * day marker, because "25:10" is unreadable and a bare "01:10" is a lie about
 * which night it is.
 */
export function formatScheduleTime(value: string | undefined): string {
  const secs = parseGtfsClock(value);
  if (secs === null) {
    return value?.trim() || '—';
  }

  const dayOffset = Math.floor(secs / 86400);
  const inDay = secs % 86400;
  const hour24 = Math.floor(inDay / 3600);
  const minute = Math.floor((inDay % 3600) / 60);

  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const clock = `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`;
  return dayOffset > 0 ? `${clock} (+${dayOffset}d)` : clock;
}

/** Calendar date parts of an instant, read in the feed's zone. */
function feedDateParts(ms: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: shared.displayZone ?? undefined,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(ms));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Wall clock minus UTC, in ms, for the feed's zone at an instant. */
function zoneOffsetMs(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: shared.displayZone ?? undefined,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ms));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * Epoch seconds that a GTFS clock time counts from on a service date: noon
 * minus 12h in the feed's zone, which is midnight except on DST change days.
 * Takes a `YYYYMMDD` date; null if it does not parse.
 */
export function serviceDayStart(date: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(date.trim());
  if (!m) {
    return null;
  }
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  const noon = guess - zoneOffsetMs(guess);
  return noon / 1000 - 12 * 3600;
}

/** The `YYYYMMDD` service date `offsetDays` from the feed-zone date at `ms`. */
export function feedServiceDate(ms: number, offsetDays = 0): string {
  const { y, m, d } = feedDateParts(ms);
  const shifted = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return `${shifted.getUTCFullYear()}${String(shifted.getUTCMonth() + 1).padStart(2, '0')}${String(shifted.getUTCDate()).padStart(2, '0')}`;
}
