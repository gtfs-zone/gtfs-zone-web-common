/**
 * Date and number formatting in the active locale. Formatters are cached per
 * locale and option set, since building an `Intl` formatter is the slow part.
 */

import { getLocale, type Locale } from './index';

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function cached<F>(
  cache: Map<string, F>,
  locale: Locale,
  options: object,
  create: () => F
): F {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) {
    format = create();
    cache.set(key, format);
  }
  return format;
}

/** A `DateTimeFormat` for the active locale. */
export function dateFormat(
  options: Intl.DateTimeFormatOptions = {},
  locale: Locale = getLocale()
): Intl.DateTimeFormat {
  return cached(
    dateFormats,
    locale,
    options,
    () => new Intl.DateTimeFormat(locale, options)
  );
}

/** A date, time or both, as `options` asks, in the active locale. */
export function formatDate(
  date: Date | number,
  options: Intl.DateTimeFormatOptions = {},
  locale: Locale = getLocale()
): string {
  return dateFormat(options, locale).format(date);
}

/** A number in the active locale. */
export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
  locale: Locale = getLocale()
): string {
  return cached(
    numberFormats,
    locale,
    options,
    () => new Intl.NumberFormat(locale, options)
  ).format(value);
}

/**
 * A speed given in metres per second (the GTFS-RT unit), shown in km/h with
 * one decimal.
 */
export function formatSpeed(
  metresPerSecond: number,
  locale: Locale = getLocale()
): string {
  return formatNumber(
    metresPerSecond * 3.6,
    {
      style: 'unit',
      unit: 'kilometer-per-hour',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    },
    locale
  );
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

/**
 * An instant relative to now, in the largest whole unit: "12 seconds ago",
 * "2 minutes ago", "in 12 seconds", "now".
 */
export function formatRelativeTime(
  ms: number,
  now: number = Date.now(),
  locale: Locale = getLocale()
): string {
  const format = cached(
    relativeFormats,
    locale,
    { numeric: 'auto' },
    () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  );
  const secs = Math.round((ms - now) / 1000);
  const abs = Math.abs(secs);
  if (abs < 60) {
    return format.format(secs, 'second');
  }
  if (abs < 3600) {
    return format.format(Math.trunc(secs / 60), 'minute');
  }
  if (abs < 86400) {
    return format.format(Math.trunc(secs / 3600), 'hour');
  }
  return format.format(Math.trunc(secs / 86400), 'day');
}

/** A weekday's name, 0 for Sunday through 6 for Saturday. */
export function weekdayName(
  day: number,
  width: 'long' | 'short' | 'narrow' = 'short',
  locale: Locale = getLocale()
): string {
  // 2023-01-01 was a Sunday.
  return formatDate(
    Date.UTC(2023, 0, 1 + day),
    { weekday: width, timeZone: 'UTC' },
    locale
  );
}
