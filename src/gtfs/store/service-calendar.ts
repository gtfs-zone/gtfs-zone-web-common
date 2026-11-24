/**
 * Which services run on a date: calendar.txt's weekly patterns, then
 * calendar_dates.txt's added and removed dates.
 */

import type { FeedStore } from './feed-store';

export interface CalendarRow {
  serviceId: string;
  start: string;
  end: string;
  /** Sunday first, as `Date.getUTCDay()`. */
  days: boolean[];
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** calendar.txt's rows. */
export function readCalendar(store: FeedStore): CalendarRow[] {
  const out: CalendarRow[] = [];
  store.scan(
    'calendar',
    ['service_id', 'start_date', 'end_date', ...WEEKDAYS],
    ([serviceId, start, end, ...days]) => {
      out.push({ serviceId, start, end, days: days.map((d) => d === '1') });
    }
  );
  return out;
}

/** Service ids active on a `YYYYMMDD` date. */
export function servicesOn(
  store: FeedStore,
  calendar: readonly CalendarRow[],
  date: string
): Set<string> {
  const out = new Set<string>();
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  if (!m) {
    throw new Error(`[ServiceCalendar] bad service date ${date}`);
  }
  const weekday = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  ).getUTCDay();
  for (const c of calendar) {
    if (c.days[weekday] && c.start <= date && date <= c.end) {
      out.add(c.serviceId);
    }
  }
  if (store.hasTable('calendar_dates')) {
    for (const { row } of store.find('calendar_dates', 'date', date)) {
      if (row.exception_type === '1') {
        out.add(row.service_id);
      } else if (row.exception_type === '2') {
        out.delete(row.service_id);
      }
    }
  }
  return out;
}
