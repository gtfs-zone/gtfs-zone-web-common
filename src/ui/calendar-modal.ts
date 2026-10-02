/**
 * The calendar modal: a month header, a row of tabs, and a month grid whose
 * day cells the caller fills.
 *
 * What a day holds, which tabs exist and what a click on a chip does are the
 * app's. This module owns the modal, the month the reader is on, the header
 * (month nav, Today, the tabs and an optional toolbar) and the grid's cell
 * shape. Dates are the caller's stored strings, read and written through a
 * `DateCodec` exactly as `calendar-input.ts` does, and the week start is handed
 * in for the same reason it is there.
 *
 * Everything inside the root is redrawn on every `redraw()`, so a caller
 * listens by delegation on `handle.root`, which survives redraws, or re-attaches
 * in `onRender`.
 */

import type { DateCodec } from './calendar-input';
import { showModal } from './modal-utils';
import { escapeHtml } from '../util/escape-html';
import { t } from '../i18n/messages';
import { formatDate, weekdayName } from '../i18n/fmt';

export interface CalendarDay {
  /** The day, in the caller's stored format. */
  date: string;
  /** False for the neighbouring-month days that pad the first and last week. */
  inMonth: boolean;
  isToday: boolean;
}

/** What a day cell holds beyond its number. Both are trusted HTML. */
export interface CalendarDayContent {
  /** Inline markers after the day number, e.g. a feed-edge badge. */
  badges?: string;
  /** The stacked chips under the number. */
  chips: string;
}

export interface CalendarTab {
  key: string;
  label: string;
  /** The tab's body for the month on screen (its first day, stored format). */
  render: (month: string) => string;
  /** The tab ignores the month: the month nav is disabled while it is open. */
  monthless?: boolean;
}

export interface CalendarModalHandle {
  /** The modal's content root. Persists across redraws. */
  root: HTMLElement;
  redraw: () => void;
  close: () => void;
}

export interface CalendarModalOptions {
  title: string;
  codec: DateCodec;
  /** 0 for Sunday through 6 for Saturday. */
  weekStart: number;
  /** Today, in the stored format. */
  today: () => string;
  tabs: readonly CalendarTab[];
  /** Key of the tab shown first; defaults to the first tab. */
  initialTab?: string;
  /** Extra header controls, beside the tabs. Trusted HTML, redrawn each time. */
  toolbarHtml?: () => string;
  /** A line between the header and the tab body, e.g. a loading note. */
  statusHtml?: (from: string, to: string) => string;
  /** The month on screen changed (and once on open): the grid's first and last day. */
  onMonth?: (from: string, to: string) => void;
  /** After every redraw, for listeners that cannot delegate. */
  onRender?: (root: HTMLElement) => void;
  onMount?: (handle: CalendarModalHandle) => void;
}

export interface MonthGridOptions {
  codec: DateCodec;
  weekStart: number;
  today: () => string;
  renderDay: (day: CalendarDay) => CalendarDayContent;
}

const DAY_MS = 86_400_000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function firstOfMonth(date: Date, months = 0): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
  );
}

/** Whole weeks covering the month, padded from its neighbours: 5 or 6 rows. */
function gridDays(month: Date, weekStart: number): Date[] {
  const first = firstOfMonth(month);
  const last = addDays(firstOfMonth(month, 1), -1);
  const start = addDays(first, -((first.getUTCDay() - weekStart + 7) % 7));
  const end = addDays(last, (weekStart + 6 - last.getUTCDay() + 7) % 7);
  const days: Date[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

function monthLabel(month: Date): string {
  return formatDate(month, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dayTitle(day: Date): string {
  return formatDate(day, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The month grid for the month containing `month` (stored format). */
export function renderMonthGrid(
  month: string,
  options: MonthGridOptions
): string {
  const parsed = options.codec.parse(month);
  if (!parsed) {
    return '';
  }
  const today = options.today();

  const header = Array.from(
    { length: 7 },
    (_, i) =>
      `<div class="text-center text-[10px] uppercase tracking-wide opacity-50">${weekdayName(
        (options.weekStart + i) % 7
      )}</div>`
  ).join('');

  const cells = gridDays(parsed, options.weekStart).map((day) => {
    const date = options.codec.format(day);
    const inMonth = day.getUTCMonth() === parsed.getUTCMonth();
    const isToday = date === today;
    const content = options.renderDay({ date, inMonth, isToday });
    return `<div class="min-h-16 p-1 rounded bg-base-200/20 border border-base-300/30 overflow-hidden${
      inMonth ? '' : ' opacity-40'
    }${isToday ? ' ring-1 ring-primary bg-primary/5' : ''}">
      <div class="flex items-center gap-0.5 text-[11px] leading-4 tabular-nums">
        <span class="font-medium opacity-70${isToday ? ' text-primary font-bold' : ''}"
          title="${escapeHtml(dayTitle(day))}">${day.getUTCDate()}</span>${content.badges ?? ''}
      </div>
      <div class="max-h-24 overflow-y-auto overscroll-contain">
        <div class="flex flex-col gap-0.5">${content.chips}</div>
      </div>
    </div>`;
  });

  return `
    <div class="grid grid-cols-7 gap-1">${header}</div>
    <div class="grid grid-cols-7 gap-1 mt-1">${cells.join('')}</div>`;
}

function renderHeader(
  month: Date,
  tabs: readonly CalendarTab[],
  active: CalendarTab,
  onCurrentMonth: boolean,
  toolbarHtml: string
): string {
  const navOff = active.monthless
    ? ` disabled title="${escapeHtml(t('calendar.notByMonth', { tab: active.label }))}"`
    : '';
  const todayOff = navOff || (onCurrentMonth ? ' disabled' : '');
  const tabButtons = tabs
    .map(
      (tab) =>
        `<button type="button" role="tab" data-cal-tab="${escapeHtml(tab.key)}"
          class="tab ${tab === active ? 'tab-active' : ''}">${escapeHtml(tab.label)}</button>`
    )
    .join('');

  return `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <button type="button" class="btn btn-xs btn-ghost" data-cal-month="-1" aria-label="${t('calendar.prevMonth')}"${navOff}>&#8249;</button>
        <span class="text-sm font-semibold w-36 text-center${active.monthless ? ' opacity-50' : ''}">${escapeHtml(monthLabel(month))}</span>
        <button type="button" class="btn btn-xs btn-ghost" data-cal-month="1" aria-label="${t('calendar.nextMonth')}"${navOff}>&#8250;</button>
        <button type="button" class="btn btn-xs btn-ghost" data-cal-today${todayOff}>${t('common.today')}</button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        ${toolbarHtml}
        <div role="tablist" class="tabs tabs-border tabs-sm">${tabButtons}</div>
      </div>
    </div>`;
}

/** Open the calendar. Resolves when it closes. */
export async function showCalendarModal(
  options: CalendarModalOptions
): Promise<void> {
  const todayMonth = (): Date =>
    firstOfMonth(options.codec.parse(options.today()) ?? new Date());

  let month = todayMonth();
  let active =
    options.tabs.find((tab) => tab.key === options.initialTab) ??
    options.tabs[0];
  let root: HTMLElement | null = null;

  const range = (): [string, string] => {
    const days = gridDays(month, options.weekStart);
    return [
      options.codec.format(days[0]),
      options.codec.format(days[days.length - 1]),
    ];
  };

  const redraw = (): void => {
    if (!root) {
      return;
    }
    const [from, to] = range();
    root.innerHTML = `
      <div class="space-y-3">
        ${renderHeader(
          month,
          options.tabs,
          active,
          month.getTime() === todayMonth().getTime(),
          options.toolbarHtml?.() ?? ''
        )}
        ${options.statusHtml?.(from, to) ?? ''}
        ${active.render(options.codec.format(month))}
      </div>`;
    options.onRender?.(root);
  };

  const moveTo = (next: Date): void => {
    month = next;
    redraw();
    options.onMonth?.(...range());
  };

  await showModal({
    title: escapeHtml(options.title),
    body: '<div data-calendar-root></div>',
    actions: [{ label: t('common.close'), onClick: () => {} }],
    enterAction: 0,
    escapeAction: 0,
    boxClassName: 'max-w-5xl w-full',
    onMount: (close) => {
      root = document.querySelector<HTMLElement>('[data-calendar-root]');
      if (!root) {
        return;
      }
      redraw();
      options.onMonth?.(...range());

      root.addEventListener('click', (event) => {
        const source = event.target as HTMLElement | null;
        const step = source?.closest<HTMLButtonElement>('[data-cal-month]');
        if (step && !step.disabled) {
          moveTo(firstOfMonth(month, Number(step.dataset.calMonth)));
          return;
        }
        const todayBtn = source?.closest<HTMLButtonElement>('[data-cal-today]');
        if (todayBtn && !todayBtn.disabled) {
          moveTo(todayMonth());
          return;
        }
        const tabBtn = source?.closest<HTMLElement>('[data-cal-tab]');
        if (tabBtn) {
          active =
            options.tabs.find((tab) => tab.key === tabBtn.dataset.calTab) ??
            active;
          redraw();
        }
      });

      options.onMount?.({ root, redraw, close });
    },
  });
}
