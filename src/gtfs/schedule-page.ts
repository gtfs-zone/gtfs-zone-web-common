/**
 * The Schedule node: where the scheduled feed came from, its Feed info,
 * agencies and stops, and what the parse and the map found wrong with it.
 */

import type { MapDataIssues } from '../map/layer-manager';
import type { GTFSScheduled, Stop } from './scheduled';
import type { RenderContext } from './entity-render';
import { escHtml, formatRelative } from './entity-render';
import { entityRow } from './entity-row';
import { renderEndpointUrl } from './endpoint-status';
import { treeNodeCrumb } from './breadcrumbs';
import type { TreeLocation } from './tree-location';
import { listSection, type TreePage, type TreeSection } from './tree-page';
import { renderIssueCard } from '../ui/issue-card';
import { t } from '../i18n/messages';

/** Where the loaded schedule came from and how its load went. */
export interface ScheduleSourceStatus {
  label: string;
  /** The URL it was fetched from; absent for an uploaded file. */
  url?: string;
  useCors?: boolean;
  /** Epoch ms of the last successful load. */
  loadedAt: number | null;
  error: string | null;
  /** Restored from the stored copy instead of parsed again. */
  restored: boolean;
  storeError: string | null;
}

export interface SchedulePageOptions {
  /** The selection's schedule, or null when it names none. */
  source: ScheduleSourceStatus | null;
  /** What the map could not draw, when the app has a map. */
  mapIssues?: MapDataIssues | null;
}

type Ctx = RenderContext<TreeLocation>;

function sourceSection(source: ScheduleSourceStatus): TreeSection {
  const from = source.url
    ? renderEndpointUrl(source.url, { useCors: source.useCors })
    : `<p class="text-xs opacity-60">${t('schedule.uploaded', { name: `<span class="font-mono">${escHtml(source.label)}</span>` })}</p>`;
  return {
    title: t('schedule.source'),
    body: `
      <div class="rounded-lg border border-base-300 p-3 space-y-2">
        <div class="flex items-center gap-2">
          <p class="text-sm flex-1">${escHtml(source.label)}</p>
          ${
            source.loadedAt
              ? `<span class="text-xs opacity-60" data-since="${source.loadedAt}">${escHtml(formatRelative(source.loadedAt))}</span>`
              : ''
          }
        </div>
        ${source.error ? `<p class="text-xs text-error break-words">${escHtml(source.error)}</p>` : ''}
        ${source.restored ? `<p class="text-xs opacity-60">${escHtml(t('schedule.restored'))}</p>` : ''}
        ${source.storeError ? `<p class="text-xs text-error break-words">${escHtml(source.storeError)}</p>` : ''}
        ${from}
      </div>`,
  };
}

function feedInfoSection(ctx: Ctx, feed: GTFSScheduled): TreeSection {
  const info = feed.feedInfo[0];
  return {
    title: t('crumb.feedInfo'),
    body: info
      ? `<ul class="-mx-2">${entityRow<TreeLocation>(ctx, {
          state: { type: 'feed_info' },
          label: info.publisher_name || t('crumb.feedInfo'),
          sublabel: [info.version, info.lang].filter(Boolean).join(' - '),
        })}</ul>`
      : `<p class="text-xs opacity-60">${t('schedule.noFeedInfo', { file: '<span class="font-mono">feed_info.txt</span>' })}</p>`,
  };
}

function agenciesSection(ctx: Ctx, feed: GTFSScheduled): TreeSection {
  return listSection(t('schedule.agencies'), {
    name: 'agencies',
    items: feed.agencies,
    row: (agency) =>
      entityRow<TreeLocation>(ctx, {
        state: { type: 'agency', agency_id: agency.id },
        label: agency.name || agency.id,
        sublabel: agency.url,
      }),
    searchText: (agency) => `${agency.name} ${agency.id}`,
    empty: t('schedule.noAgencies'),
  });
}

/** Stations and the stops that belong to none; platforms are on their station. */
const topStops = new WeakMap<GTFSScheduled, Stop[]>();

function topLevelStops(feed: GTFSScheduled): Stop[] {
  let stops = topStops.get(feed);
  if (!stops) {
    stops = [...feed.stops.values()].filter(
      (stop) =>
        stop.location_type === 1 ||
        (stop.location_type === 0 && !stop.parent_station)
    );
    stops.sort((a, b) =>
      (a.name || a.id).localeCompare(b.name || b.id, undefined, {
        numeric: true,
      })
    );
    topStops.set(feed, stops);
  }
  return stops;
}

function stopsSection(ctx: Ctx, feed: GTFSScheduled): TreeSection {
  return listSection(t('schedule.stops'), {
    name: 'stops',
    items: topLevelStops(feed),
    row: (stop) =>
      entityRow<TreeLocation>(ctx, {
        state: { type: 'stop', stop_id: stop.id },
        label: stop.name || stop.id,
        sublabel:
          stop.location_type === 1
            ? t('schedule.station')
            : (stop.raw.stop_code ?? ''),
      }),
    searchText: (stop) => `${stop.name} ${stop.id} ${stop.raw.stop_code ?? ''}`,
    empty: t('schedule.noStops'),
  });
}

/**
 * What the map could not draw: a stop with no id, or a vehicle naming a route
 * the schedule never declares, is a feed defect.
 */
function mapIssuesSection(issues: MapDataIssues): string {
  return renderIssueCard(t('schedule.mapIssues'), [
    {
      label: t('schedule.stopsNoId'),
      count: issues.stopsMissingId,
      note: t('schedule.stopsNoIdNote'),
    },
    {
      label: t('schedule.stopsNoCoords'),
      count: issues.stopsMissingCoords,
      note: t('schedule.stopsNoCoordsNote'),
    },
    {
      label: t('schedule.vehiclesUnmatched'),
      count: issues.vehiclesUnmatched,
      note: t('schedule.vehiclesUnmatchedNote'),
    },
    {
      label: t('schedule.vehiclesCollapsed'),
      count: issues.vehiclesDuplicateKeys,
      note: t('schedule.vehiclesCollapsedNote'),
    },
  ]);
}

/** Malformed `parent_station` links found while indexing stations. */
function stationIssuesSection(feed: GTFSScheduled): string {
  const issues = feed.stationIssues;
  return renderIssueCard(t('schedule.stationIssues'), [
    {
      label: t('schedule.danglingParent'),
      count: issues.danglingParent,
      note: t('schedule.danglingParentNote'),
    },
    {
      label: t('schedule.wrongParent'),
      count: issues.nonStationParent,
      note: t('schedule.wrongParentNote'),
    },
    {
      label: t('schedule.cycle'),
      count: issues.cyclicStops,
      note: t('schedule.cycleNote'),
    },
  ]);
}

/**
 * CSV columns that arrived padded with whitespace and were trimmed at parse
 * time. Rows are counted, not distinct values. Empty for a clean feed.
 */
function paddedColumnsSection(feed: GTFSScheduled): TreeSection | null {
  const padded = feed.paddedColumns;
  if (padded.length === 0) {
    return null;
  }
  return {
    title: t('schedule.padded'),
    body: `
      <div class="rounded-lg border border-warning/40 p-3 space-y-2">
        ${padded
          .map(
            ({ file, column, rows }) => `
          <div>
            <div class="flex justify-between gap-2 text-xs">
              <span><span class="font-mono">${escHtml(file)}</span> <span class="font-mono">${escHtml(column)}</span></span>
              <span class="tabular-nums font-semibold">${rows}</span>
            </div>
            <p class="text-xs opacity-50">${t('schedule.paddedNote', {
              rows,
              column: `<span class="font-mono">${escHtml(column)}</span>`,
            })}</p>
          </div>`
          )
          .join('')}
      </div>`,
  };
}

/** feed_info.txt and agency.txt, verbatim. */
function rawTablesSection(feed: GTFSScheduled): TreeSection | null {
  const tables = [
    ...feed.feedInfo.map((info) => ['feed_info.txt', info.raw] as const),
    ...feed.agencies.map((agency) => ['agency.txt', agency.raw] as const),
  ];
  if (tables.length === 0) {
    return null;
  }
  return {
    title: t('schedule.metadata'),
    body: tables
      .map(
        ([file, row], i) => `
        <details class="text-xs rounded-lg border border-base-300 p-2" data-detail="raw:${i}">
          <summary class="cursor-pointer">${escHtml(file)}${
            row.agency_name ? ` - ${escHtml(row.agency_name)}` : ''
          }</summary>
          <table class="table table-xs mt-1">
            <tbody>
              ${Object.entries(row)
                .map(
                  ([k, v]) =>
                    `<tr><td class="opacity-60 align-top">${escHtml(k)}</td><td class="break-all">${escHtml(v ?? '')}</td></tr>`
                )
                .join('')}
            </tbody>
          </table>
        </details>`
      )
      .join(''),
  };
}

export function schedulePage(ctx: Ctx, options: SchedulePageOptions): TreePage {
  const feed = ctx.session.scheduledFeed;
  const source = options.source;
  const label = treeNodeCrumb('schedule').label;
  const sections: (TreeSection | null)[] = [
    source ? sourceSection(source) : null,
  ];
  if (!feed) {
    sections.push({
      body: `<p class="text-sm opacity-60">${escHtml(t('schedule.none'))}</p>`,
    });
  } else {
    sections.push(
      feedInfoSection(ctx, feed),
      agenciesSection(ctx, feed),
      stopsSection(ctx, feed),
      { body: options.mapIssues ? mapIssuesSection(options.mapIssues) : '' },
      { body: stationIssuesSection(feed) },
      paddedColumnsSection(feed),
      rawTablesSection(feed)
    );
  }
  return {
    eyebrow: label,
    title: source?.label ?? label,
    sections: sections.filter(
      (s): s is TreeSection => s !== null && (!!s.body || !!s.list)
    ),
  };
}
