/**
 * The decoded GTFS-RT alert page, plus the compact alert list every other page
 * embeds.
 */

import type { AlertRecord, ServiceAlert } from './rt-types';
import {
  ALERT_LEVEL_LABELS,
  CAUSE_LABELS,
  EFFECT_LABELS,
  SEVERITY_LABELS,
  activePeriods,
  alertLevel,
  isActiveNow,
  preferredText,
  selectorLevel,
  translations,
} from './alerts';
import type { LinkContext, RenderContext } from './entity-render';
import {
  entityLink,
  escHtml,
  formatAbsolute,
  formatDuration,
  missing,
  prop,
  propList,
  renderRawJson,
} from './entity-render';
import { entityRow, entityRowList, rowSection } from './entity-row';
import type { RtPageRef } from './rt-page';
import type { TreePage, TreeSection } from './tree-page';
import type { ListBoxOptions } from '../ui/list-box';
import { t } from '../i18n/messages';

type EntitySelector = NonNullable<ServiceAlert['informedEntity']>[number];

function statusBadge(record: AlertRecord): string {
  return isActiveNow(record.alert)
    ? `<span class="badge badge-warning badge-xs">${escHtml(t('alerts.active'))}</span>`
    : `<span class="badge badge-ghost badge-xs">${escHtml(t('alerts.notActive'))}</span>`;
}

function alertHeader(record: AlertRecord): string {
  return (
    preferredText(record.alert.headerText) ||
    t('alerts.fallback', { id: record.id })
  );
}

/** Alerts as a list box, active ones first. */
export function alertListOptions(
  ctx: LinkContext<RtPageRef>,
  records: readonly AlertRecord[],
  empty: string
): ListBoxOptions<AlertRecord> {
  const active = records.filter((r) => isActiveNow(r.alert));
  const rest = records.filter((r) => !isActiveNow(r.alert));
  return {
    name: 'alerts',
    items: [...active, ...rest],
    row: (record) =>
      entityRow<RtPageRef>(ctx, {
        state: { type: 'alert', alert_id: record.id },
        leadHtml: statusBadge(record),
        label: alertHeader(record),
        sublabel: preferredText(record.alert.descriptionText),
        badge: ALERT_LEVEL_LABELS[alertLevel(record)],
      }),
    searchText: (record) =>
      `${alertHeader(record)} ${preferredText(record.alert.descriptionText)} ${record.id}`,
    empty,
  };
}

/**
 * A list of alerts as one-line links. Used for the route page's alert regions,
 * the stop page, and the alerts modal, so they cannot drift apart.
 */
export function renderAlertList(
  ctx: RenderContext<RtPageRef>,
  records: AlertRecord[],
  title: string
): string {
  if (records.length === 0) {
    return '';
  }
  return rowSection(
    title,
    records.length,
    entityRowList(
      records.map((record) =>
        entityRow<RtPageRef>(ctx, {
          state: { type: 'alert', alert_id: record.id },
          leadHtml: statusBadge(record),
          label: alertHeader(record),
          badge: ALERT_LEVEL_LABELS[alertLevel(record)],
        })
      ),
      ''
    )
  );
}

/** The languages the feed supplied beyond the one we chose to display. */
function renderOtherTranslations(
  label: string,
  ts: ServiceAlert['headerText']
): string {
  const others = translations(ts).filter((t) => t.text !== preferredText(ts));
  if (others.length === 0) {
    return '';
  }
  const noLanguage = t('alertPage.noLanguage');
  return `
    <details class="text-xs" data-detail="tr:${escHtml(label)}">
      <summary class="cursor-pointer opacity-60">${escHtml(t('alertPage.otherTranslations', { count: others.length }))}</summary>
      <dl class="mt-1 space-y-1">${others
        .map(
          (t) => `<div>
            <dt class="opacity-50 font-mono">${escHtml(t.language || noLanguage)}</dt>
            <dd class="whitespace-pre-wrap">${escHtml(t.text)}</dd>
          </div>`
        )
        .join('')}</dl>
    </details>`;
}

/** Every language the feed supplied, not just the one we chose to display. */
function renderTranslations(
  label: string,
  ts: ServiceAlert['headerText']
): string {
  const list = translations(ts);
  if (list.length === 0) {
    return '';
  }
  return `
    <div class="space-y-1">
      <p class="text-xs opacity-60">${escHtml(label)}</p>
      <p class="text-sm whitespace-pre-wrap">${escHtml(preferredText(ts))}</p>
      ${renderOtherTranslations(label, ts)}
    </div>`;
}

/**
 * The one-line version of the active periods, for the page header. The full
 * list is still rendered below in its own section.
 */
function activeWindow(alert: ServiceAlert): string {
  const periods = activePeriods(alert);
  if (periods.length === 0) {
    return t('alertPage.alwaysActive');
  }

  const now = Date.now() / 1000;
  const current = periods.find(
    (p) => (p.start ?? -Infinity) <= now && (p.end ?? Infinity) >= now
  );
  const upcoming = periods.find((p) => p.start !== undefined && p.start > now);

  let phrase: string;
  if (current) {
    phrase =
      current.end === undefined
        ? t('alertPage.activeOpenEnded')
        : t('alertPage.activeUntil', { time: formatAbsolute(current.end) });
  } else if (upcoming) {
    phrase = t('alertPage.startsAt', { time: formatAbsolute(upcoming.start!) });
  } else {
    const last = periods[periods.length - 1];
    phrase =
      last.end === undefined
        ? t('alerts.notActive')
        : t('alertPage.endedAt', { time: formatAbsolute(last.end) });
  }

  return periods.length > 1
    ? t('alertPage.periods', { phrase, count: periods.length })
    : phrase;
}

/**
 * Active periods as absolute times plus what they mean right now. A period with
 * a start and no end is open-ended, and is said to be, rather than being
 * rendered with an end of 1970.
 */
function renderActivePeriods(alert: ServiceAlert): string {
  const periods = activePeriods(alert);
  if (periods.length === 0) {
    return `<p class="text-xs opacity-60">${escHtml(t('alertPage.noPeriod'))}</p>`;
  }
  const now = Date.now() / 1000;
  return `<ul class="text-xs space-y-1">${periods
    .map((p) => {
      const start =
        p.start === undefined ? t('alertPage.always') : formatAbsolute(p.start);
      const end =
        p.end === undefined ? t('alertPage.openEnded') : formatAbsolute(p.end);
      let note: string;
      if (p.start !== undefined && p.start > now) {
        note = t('alertPage.startsIn', {
          duration: formatDuration(p.start - now),
        });
      } else if (p.end !== undefined && p.end < now) {
        note = t('alertPage.endedAgo', {
          duration: formatDuration(now - p.end),
        });
      } else if (p.end !== undefined) {
        note = t('alertPage.endsIn', { duration: formatDuration(p.end - now) });
      } else {
        note = t('alerts.active');
      }
      return `<li class="flex justify-between gap-2">
        <span>${escHtml(start)} -&gt; ${escHtml(end)}</span>
        <span class="opacity-60 shrink-0">${escHtml(note)}</span>
      </li>`;
    })
    .join('')}</ul>`;
}

/** Each informed entity as links to the pages for the objects it names. */
function renderInformedEntity(
  ctx: RenderContext<RtPageRef>,
  e: EntitySelector
): string {
  const feed = ctx.session.scheduledFeed;
  const links: string[] = [];

  if (e.agencyId) {
    links.push(
      `<span class="opacity-60">${escHtml(t('alertPage.agency'))}</span> ${escHtml(e.agencyId)}`
    );
  }
  if (e.routeType !== null && e.routeType !== undefined) {
    links.push(
      `<span class="opacity-60">route_type</span> ${escHtml(String(e.routeType))}`
    );
  }
  if (e.routeId) {
    const route = feed?.routes.get(e.routeId);
    links.push(
      `<span class="opacity-60">${escHtml(t('alertPage.route'))}</span> ${
        route
          ? entityLink(
              ctx,
              { type: 'route', route_id: route.id },
              route.short_name || route.long_name || route.id
            )
          : escHtml(e.routeId)
      }`
    );
  }
  if (e.stopId) {
    const stop = feed?.stops.get(e.stopId);
    links.push(
      `<span class="opacity-60">${escHtml(t('alertPage.stop'))}</span> ${
        stop
          ? entityLink(
              ctx,
              { type: 'stop', stop_id: stop.id },
              stop.name || stop.id
            )
          : escHtml(e.stopId)
      }`
    );
  }
  if (e.trip?.tripId) {
    const trip = feed?.trips.get(e.trip.tripId);
    links.push(
      `<span class="opacity-60">${escHtml(t('alertPage.trip'))}</span> ${escHtml(e.trip.tripId)}${
        trip
          ? ` <span class="opacity-60">${escHtml(t('alertPage.on'))}</span> ${entityLink(
              ctx,
              { type: 'route', route_id: trip.route_id },
              trip.route_id
            )}`
          : ''
      }`
    );
  }
  if (e.directionId !== null && e.directionId !== undefined) {
    links.push(
      `<span class="opacity-60">${escHtml(t('alertPage.direction'))}</span> ${escHtml(String(e.directionId))}`
    );
  }

  return `<li class="text-xs rounded border border-base-300 p-2 space-y-1">
    <span class="badge badge-ghost badge-xs">${escHtml(ALERT_LEVEL_LABELS[selectorLevel(e)])}</span>
    <div class="flex flex-wrap gap-x-3 gap-y-1">${
      links.length
        ? links.join('')
        : `<span class="opacity-50">${escHtml(t('alertPage.namesNothing'))}</span>`
    }</div>
  </li>`;
}

/** The live payload's alert by its feed entity id, or a note saying it is gone. */
export function alertPage(
  ctx: RenderContext<RtPageRef>,
  alertId: string
): TreePage {
  const record = ctx.session.alerts.get(alertId);
  if (!record) {
    return {
      eyebrow: t('crumb.alert'),
      title: t('alerts.fallback', { id: alertId }),
      sections: [
        {
          body: `${missing(t('alerts.fallback', { id: alertId }))}
      <p class="text-xs opacity-50 mt-2">${escHtml(t('alertPage.regenerated'))}</p>`,
        },
      ],
    };
  }
  const alert = record.alert;
  const url = preferredText(alert.url);
  const sections: TreeSection[] = [
    { body: renderOtherTranslations(t('alertPage.header'), alert.headerText) },
    {
      body: alert.descriptionText
        ? renderTranslations(t('alertPage.description'), alert.descriptionText)
        : '',
    },
    {
      body: url
        ? `<p class="text-xs"><a href="${escHtml(url)}" target="_blank" rel="noopener" class="link">${escHtml(url)}</a></p>`
        : '',
    },
    {
      title: t('alertPage.properties'),
      body: propList([
        prop(
          t('alertPage.status'),
          `${statusBadge(record)} ${escHtml(activeWindow(alert))}`
        ),
        prop(
          t('alertPage.level'),
          escHtml(ALERT_LEVEL_LABELS[alertLevel(record)])
        ),
        prop(
          t('alertPage.cause'),
          escHtml(
            CAUSE_LABELS[alert.cause as number] ?? String(alert.cause ?? '-')
          )
        ),
        prop(
          t('alertPage.effect'),
          escHtml(
            EFFECT_LABELS[alert.effect as number] ?? String(alert.effect ?? '-')
          )
        ),
        prop(
          t('alertPage.severity'),
          escHtml(
            SEVERITY_LABELS[alert.severityLevel as number] ??
              String(alert.severityLevel ?? '-')
          )
        ),
      ]),
    },
    { title: t('alertPage.activePeriods'), body: renderActivePeriods(alert) },
    {
      title: t('alertPage.informedEntities'),
      body: (alert.informedEntity ?? []).length
        ? `<ul class="space-y-1">${alert
            .informedEntity!.map((e) => renderInformedEntity(ctx, e))
            .join('')}</ul>`
        : `<p class="text-xs opacity-60">${escHtml(t('alertPage.noEntities'))}</p>`,
    },
    { body: renderRawJson(t('alertPage.raw'), record.raw) },
  ];
  return {
    eyebrow: t('crumb.alert'),
    title: alertHeader(record),
    id: record.id,
    sections: sections.filter((section) => section.body),
  };
}
