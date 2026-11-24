/**
 * When a service runs, read off calendar.txt (and calendar_dates.txt when it is
 * mirrored): the inline service lines of the trip page.
 */

import type { GTFSScheduled } from './scheduled';
import { escHtml, prop, propList } from './entity-render';
import { formatServiceDate } from './feed-time';
import type { TreeSection } from './tree-page';
import { weekdayName } from '../i18n/fmt';
import { t } from '../i18n/messages';

/**
 * "Mon, Wed, Fri", or what a service with no weekly pattern runs on. `days` is
 * Monday-first; `weekStart` is the first day shown, 0 for Sunday.
 */
export function weekdaysLabel(days: readonly boolean[], weekStart = 1): string {
  const named: string[] = [];
  for (let slot = 0; slot < 7; slot++) {
    const mondayFirst = (weekStart + slot + 6) % 7;
    if (days[mondayFirst]) {
      named.push(weekdayName((mondayFirst + 1) % 7));
    }
  }
  if (named.length === 7) {
    return t('days.every');
  }
  if (named.length === 0) {
    return t('days.none');
  }
  return named.join(', ');
}

/**
 * The service a trip runs on: its id, weekdays and date window. A service in
 * neither calendar file is reported only when calendar_dates.txt is mirrored,
 * since otherwise it may be a dates-only service.
 */
export function serviceSection(
  feed: GTFSScheduled,
  serviceId: string,
  weekStart = 1
): TreeSection {
  const title = t('trip.service');
  const calendar = feed.calendar.find((c) => c.service_id === serviceId);
  const known =
    calendar !== undefined ||
    feed.mirror !== 'all' ||
    feed.calendarDates.some((d) => d.service_id === serviceId);
  if (!known) {
    return {
      title,
      body: `<p class="text-xs opacity-60">${escHtml(
        t('trip.unknownService', { id: serviceId })
      )}</p>`,
    };
  }

  // No calendar.txt row means no window: the service runs only on the dates
  // calendar_dates.txt adds, which "No weekly pattern" already says.
  const window =
    calendar?.start_date && calendar.end_date
      ? t('days.range', {
          start: formatServiceDate(calendar.start_date),
          end: formatServiceDate(calendar.end_date),
        })
      : t('trip.noRange');

  return {
    title,
    body: propList([
      prop(title, `<span class="font-mono">${escHtml(serviceId)}</span>`),
      prop(
        t('trip.runs'),
        escHtml(weekdaysLabel(calendar?.days ?? [], weekStart))
      ),
      prop(t('trip.window'), escHtml(window)),
    ]),
  };
}
