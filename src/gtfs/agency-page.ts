/** The Agency page: agency.txt's fields, its routes and the alerts naming it. */

import type { GTFSScheduled, Route } from './scheduled';
import type { AlertRecord } from './rt-types';
import type { RenderContext } from './entity-render';
import {
  escHtml,
  externalLink,
  optionalProp,
  propList,
  renderRawFields,
  routeTypeLabel,
} from './entity-render';
import { entityRow } from './entity-row';
import { alertListOptions } from './alert-page';
import type { TreeLocation } from './tree-location';
import { listSection, type TreePage } from './tree-page';
import { t } from '../i18n/messages';

type Ctx = RenderContext<TreeLocation>;

/**
 * The agency's routes. A route with no `agency_id` belongs to the sole agency
 * of a single-agency feed.
 */
function agencyRoutes(feed: GTFSScheduled, agencyId: string): Route[] {
  const sole = feed.agencies.length === 1;
  const routes = [...feed.routes.values()].filter(
    (route) => route.agency_id === agencyId || (sole && !route.agency_id)
  );
  const sortOrder = (route: Route): number => {
    const value = Number(route.raw.route_sort_order);
    return route.raw.route_sort_order && Number.isFinite(value)
      ? value
      : Infinity;
  };
  return routes.sort(
    (a, b) =>
      sortOrder(a) - sortOrder(b) ||
      (a.short_name || a.long_name || a.id).localeCompare(
        b.short_name || b.long_name || b.id,
        undefined,
        { numeric: true }
      )
  );
}

/** Alerts with an informed entity naming this agency. */
function agencyAlerts(ctx: Ctx, agencyId: string): AlertRecord[] {
  return [...ctx.session.alerts.values()].filter((record) =>
    (record.alert.informedEntity ?? []).some((e) => e.agencyId === agencyId)
  );
}

export function agencyPage(ctx: Ctx, agencyId: string): TreePage {
  const feed = ctx.session.scheduledFeed;
  const agency = feed?.agencies.find((a) => a.id === agencyId);
  const eyebrow = t('crumb.agency');
  if (!feed || !agency) {
    return {
      eyebrow,
      title: agencyId,
      sections: [
        {
          body: `<p class="text-sm opacity-60">${escHtml(t('agency.missing', { id: agencyId }))}</p>`,
        },
      ],
    };
  }
  const raw = agency.raw;
  return {
    eyebrow,
    title: agency.name || agency.id,
    id: agency.id || undefined,
    sections: [
      {
        body: propList([
          optionalProp(t('agency.website'), externalLink(agency.url)),
          optionalProp(t('agency.timezone'), escHtml(agency.timezone)),
          optionalProp(t('agency.phone'), escHtml(raw.agency_phone ?? '')),
          optionalProp(t('agency.fares'), externalLink(raw.agency_fare_url)),
          optionalProp(t('agency.language'), escHtml(raw.agency_lang ?? '')),
          optionalProp(
            t('agency.email'),
            raw.agency_email
              ? externalLink(`mailto:${raw.agency_email}`, raw.agency_email)
              : ''
          ),
        ]),
      },
      listSection(t('agency.routes'), {
        name: 'agency-routes',
        items: agencyRoutes(feed, agency.id),
        row: (route) =>
          entityRow<TreeLocation>(ctx, {
            state: { type: 'route', route_id: route.id },
            label: route.short_name || route.long_name || route.id,
            sublabel: [
              route.short_name ? route.long_name : '',
              routeTypeLabel(route.type) ?? '',
            ]
              .filter(Boolean)
              .join(' - '),
            color: route.color,
          }),
        searchText: (route) =>
          `${route.short_name} ${route.long_name} ${route.id}`,
        empty: t('agency.noRoutes'),
      }),
      listSection(
        t('agency.alerts'),
        alertListOptions(
          ctx,
          agencyAlerts(ctx, agency.id),
          t('alerts.noneHere')
        )
      ),
      { body: renderRawFields('agency.txt', raw) },
    ],
  };
}
