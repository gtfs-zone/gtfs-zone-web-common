/**
 * The one way into a feed.
 *
 * The feed catalog, hand-typed URLs and file upload are one screen here,
 * because they were never really different tasks: you are always choosing a
 * feed source, and the only thing that varies is where the URLs come from.
 *
 * So the slots at the top are plain URL fields, and every result row is a
 * shortcut that fills them in. That single change is what makes the rest work:
 * "load a catalog feed and then fix one of its URLs" needs no separate mode,
 * and neither does "come back and edit what is loaded": the modal opens seeded
 * from the current selection, which is why the right panel needs no editors of
 * its own.
 *
 * Rows carry their URLs on the face of them. Two agencies with the same name
 * are otherwise indistinguishable, and it is worth knowing what you are about
 * to fetch before you fetch it.
 *
 * `options.notice` and `options.linkedWith` are the failure half of the same
 * idea: when a link named a feed and it could not be loaded, the modal opens
 * holding that link's URLs, says why, and offers one click to try again through
 * the CORS proxy. Nothing about that is app-specific, so it lives here.
 *
 * `options.realtime` is the one axis an app gets a say in. With it off the
 * realtime section, its URL fields, the role chips and every realtime-only
 * catalog feed are simply not emitted, and a scheduled source alone is a
 * complete selection. It also picks which catalog feeds are listed by default:
 * the editor's rule is a schedule that answered feed-catalog's last check, the
 * visualiser's is that plus at least one realtime role that did. "Show all"
 * lifts the rule. Everything else, the search, upload, CORS and seeding, is
 * the same everywhere, which is the whole reason this is one file.
 */

import type { CatalogFeed } from '../gtfs/feed-catalog';
import {
  RT_ROLES,
  loadFeedCatalog,
  placeLine,
  realtimeSlots,
  usableUrl,
} from '../gtfs/feed-catalog';
import { feedStateBadge, roleChips } from '../gtfs/feed-badges';
import { FeedMatcher } from '../gtfs/feed-search';
import type { FeedSelection } from '../gtfs/feed-selection';
import { describeMissing, isComplete } from '../gtfs/feed-selection';
import { normalizeFeedUrl, validateFeedUrl } from '../gtfs/feed-url-resolve';
import type { ModalAction } from './modal-utils';
import { renderUploadIcon, showModal } from './modal-utils';
import { renderTooltipTrigger } from './field-label';
import { SELECTED_ROW_CLASS } from './selectable-row';
import { t } from '../i18n/messages';
import { formatNumber } from '../i18n/fmt';

function creditLink(href: string, label: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="link">${label}</a>`;
}

/** The catalogs the result list's rows come from. */
function listCredit(): string {
  return t('load.listCredit', {
    atlas: creditLink(
      'https://github.com/transitland/transitland-atlas',
      'Transitland Atlas'
    ),
    license: creditLink(
      'https://creativecommons.org/licenses/by/4.0/',
      'CC BY 4.0'
    ),
    mobility: creditLink('https://mobilitydatabase.org', 'Mobility Database'),
    ntd: creditLink(
      'https://data.transportation.gov/d/2u7n-ub22',
      'National Transit Database'
    ),
    rt: creditLink('https://rt.gtfs.zone', 'rt.gtfs.zone'),
  });
}

/** One catalog feed as an offer in the result list. */
interface FeedRow {
  rowId: string;
  feed: CatalogFeed;
  /** Which slots a click fills. */
  provides: 'pair' | 'scheduled' | 'rt';
  subtitle: string;
  scheduledUrl?: string;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
  scheduledCors: boolean;
  rtCors: boolean;
  /** Passes the host app's rule, so it is listed without "show all". */
  valid: boolean;
}

/** What the stored feed is, for the boot screen's continue card. */
export interface ContinueOffer {
  name: string;
  routes: number;
  stops: number;
  trips: number;
  /** Omitted by apps that do not edit; the card drops the count entirely. */
  edits?: number;
}

/**
 * The feed a link named, when it could not simply be loaded.
 *
 * The URLs are printed on the card rather than only filled into the fields,
 * because the point of the card is to say what the link asked for — a link that
 * failed has already spent the user's trust once, and hiding what it named
 * below the fold spends it again.
 */
export interface LinkedOffer {
  label: string;
  scheduledUrl?: string;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
  /** Whether either half had the proxy off, so a retry through it may help. */
  canRetryWithCors: boolean;
}

/**
 * What the modal closed with. `continue` means the user picked the continue
 * card, so the caller restores the feed already in IndexedDB rather than
 * loading anything; `selection` carries what the form was filled with. A
 * discriminated union rather than a sentinel selection, so no caller has to
 * distinguish the two by identity.
 */
export type LoadModalResult =
  { kind: 'continue' } | { kind: 'selection'; selection: FeedSelection } | null;

export interface LoadModalOptions {
  /** Show the realtime section and require an RT endpoint. Default true. */
  realtime?: boolean;
  /** Extra buttons in the action bar, e.g. "New Empty Feed". */
  extraActions?: ModalAction[];
  /**
   * Offer the stored feed as the first card. Only boot passes this: reopening
   * the modal from inside a feed is how that feed's URL is edited, and
   * "continue with what is already open" means nothing there.
   */
  continueWith?: ContinueOffer;
  /**
   * Why the modal is open, when it is open because something failed. Rendered
   * above everything else; absent or empty renders nothing.
   */
  notice?: string;
  /**
   * The feed the current link names, offered as a card. Boot passes this when a
   * link could not be loaded, so its URLs are visible and one click retries.
   */
  linkedWith?: LinkedOffer;
}

/** The unfiltered list is thousands of rows; cap what is painted. */
const DISPLAY_CAP = 200;

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Sources ──────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024 * 1024) {
    return t('load.kb', { size: Math.max(1, Math.round(n / 1024)) });
  }
  return t('load.mb', {
    size: formatNumber(n / (1024 * 1024), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
  });
}

/**
 * One catalog feed as a row, or null when it offers nothing this app can
 * load: no schedule in the editor, or only URLs behind a key we lack.
 */
function feedRow(feed: CatalogFeed, realtime: boolean): FeedRow | null {
  const scheduledUrl = usableUrl(feed, 'scheduled');
  const rt = realtime ? realtimeSlots(feed) : {};
  const hasRt = Object.values(rt).some(Boolean);
  if (!scheduledUrl && !hasRt) {
    return null;
  }

  const up = (role: (typeof RT_ROLES)[number]) => feed.roleState[role] === 'up';
  return {
    rowId: `feed:${feed.feedId}`,
    feed,
    provides:
      scheduledUrl && hasRt ? 'pair' : scheduledUrl ? 'scheduled' : 'rt',
    subtitle: [
      feed.subtitle,
      placeLine(feed),
      feed.lastModified ? t('load.updated', { date: feed.lastModified }) : '',
      feed.staticBytes ? formatBytes(feed.staticBytes) : '',
    ]
      .filter(Boolean)
      .join(' - '),
    scheduledUrl,
    ...rt,
    // Unknown origins, so assume the proxy is needed; the toggle is there for
    // the ones that turn out not to.
    scheduledCors: true,
    rtCors: true,
    // An untyped realtime role is in RT_ROLES, so it counts for the viewer.
    valid: realtime
      ? feed.roleState.scheduled === 'up' && RT_ROLES.some(up)
      : feed.roleState.scheduled === 'up',
  };
}

/**
 * Newest schedule first by its Last-Modified, unknown last, larger first on a
 * tie: a schedule someone republished last week is the likeliest to be alive
 * and current, which a name says nothing about.
 */
function byRecency(a: CatalogFeed, b: CatalogFeed): number {
  const modified = (b.lastModified ?? '').localeCompare(a.lastModified ?? '');
  return modified || (b.staticBytes ?? 0) - (a.staticBytes ?? 0);
}

/**
 * The catalog feeds worth offering, newest first. Rejects when the catalog
 * cannot be fetched.
 */
async function catalogFeedRows(realtime: boolean): Promise<FeedRow[]> {
  const feeds = await loadFeedCatalog();
  return [...feeds]
    .sort(byRecency)
    .map((f) => feedRow(f, realtime))
    .filter((r): r is FeedRow => r !== null);
}

function catalogNote(err: unknown): string {
  return t('load.catalogUnavailable', { reason: reason(err) });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function urlLine(label: string, url: string | undefined): string {
  if (!url) {
    return '';
  }
  return `<p class="text-[11px] font-mono opacity-50 truncate" title="${escHtml(url)}">
    <span class="opacity-70">${label}</span> ${escHtml(url)}
  </p>`;
}

function renderRow(row: FeedRow, inUse: boolean, realtime: boolean): string {
  const classes = inUse ? SELECTED_ROW_CLASS : 'hover:bg-base-200';
  const { feed } = row;
  return `
    <button type="button" class="w-full text-left px-3 py-2 rounded-lg flex items-start gap-2 ${classes}" data-row-id="${escHtml(row.rowId)}">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${escHtml(feed.name)}</p>
        ${row.subtitle ? `<p class="text-xs opacity-60 truncate">${escHtml(row.subtitle)}</p>` : ''}
        ${urlLine(realtime ? t('load.urlScheduled') : '', row.scheduledUrl)}
        ${realtime ? urlLine('vp', row.vehiclesUrl) : ''}
        ${realtime ? urlLine('tu', row.tripUpdatesUrl) : ''}
        ${realtime ? urlLine('al', row.alertsUrl) : ''}
      </div>
      <div class="flex gap-1 shrink-0 pt-0.5 items-center">
        ${inUse ? `<span class="text-xs opacity-60">${t('load.inUse')}</span>` : ''}
        ${feedStateBadge(feed.state, feed.since)}
        ${realtime ? roleChips(feed) : ''}
      </div>
    </button>`;
}

/**
 * Always the first row, and never filtered out by the search.
 *
 * The URL fields are at the bottom of the modal, where the eye is not, so the
 * list has to name them: "type my own URL" is a choice of feed source like any
 * other, and the only one that had no row.
 */
function customUrlRow(realtime: boolean): string {
  const subtitle = realtime
    ? t('load.customRealtime')
    : t('load.customScheduled');
  return `
    <button type="button" data-custom-url class="w-full text-left px-3 py-2 rounded-lg flex items-start gap-2 hover:bg-base-200 border border-dashed border-base-300">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${t('load.customTitle')}</p>
        <p class="text-xs opacity-60 truncate">${subtitle}</p>
      </div>
    </button>`;
}

/** The visible rows under the catalogs' heading and credit. */
function renderRows(
  rows: FeedRow[],
  inUse: Set<string>,
  realtime: boolean,
  emptyText: string
): string {
  const custom = customUrlRow(realtime);
  if (rows.length === 0) {
    return `${custom}<p class="text-sm opacity-40 text-center py-8">${emptyText}</p>`;
  }
  const out = [
    `<p class="text-xs uppercase tracking-wide opacity-50 px-3 pt-3 pb-1">${t('load.listHeading')}</p>`,
    `<p class="text-xs opacity-60 px-3 pb-1">${listCredit()}</p>`,
    ...rows.map((row) => renderRow(row, inUse.has(row.rowId), realtime)),
  ];
  return custom + out.join('');
}

function showAllTooltip(realtime: boolean): string {
  return realtime
    ? t('load.showAllTipRealtime')
    : t('load.showAllTipScheduled');
}

function corsToggle(id: string): string {
  return `
    <label class="flex items-center gap-2 text-xs cursor-pointer font-normal shrink-0">
      <input type="checkbox" id="${id}" class="toggle toggle-xs" checked />
      ${t('load.corsProxy')}
      ${renderTooltipTrigger(t('load.corsTip'), '<span class="opacity-60">?</span>')}
    </label>`;
}

function rtField(id: string, label: string, placeholder: string): string {
  return `
    <label class="flex items-center gap-2">
      <span class="text-xs opacity-60 w-28 shrink-0">${label}</span>
      <input type="text" id="${id}" class="input input-bordered input-xs flex-1 min-w-0 font-mono" placeholder="${placeholder}" spellcheck="false" autocomplete="off" />
    </label>`;
}

/** The stored feed, as the first thing on the boot screen. */
function continueCard(offer: ContinueOffer): string {
  const counts = [
    t('load.routes', { count: offer.routes }),
    t('load.stops', { count: offer.stops }),
    t('load.trips', { count: offer.trips }),
    ...(offer.edits === undefined
      ? []
      : [t('load.edits', { count: offer.edits })]),
  ].join(', ');
  return `
      <button type="button" id="load-continue" class="shrink-0 w-full text-left rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 p-3">
        <p class="text-sm font-medium truncate">${escHtml(t('load.continueWith', { name: offer.name }))}</p>
        <p class="text-xs opacity-60 truncate">${escHtml(counts)}</p>
      </button>`;
}

/** Why the modal is open, when something failed to open the feed instead. */
function noticeBlock(text: string): string {
  return `
      <div class="shrink-0 rounded-lg border border-error/40 bg-error/10 p-3">
        <p class="text-sm text-error">${escHtml(text)}</p>
      </div>`;
}

/** The feed the link named, with the URLs it asked for and a one-click retry. */
function linkedCard(offer: LinkedOffer): string {
  return `
      <div class="shrink-0 rounded-lg border border-primary/40 bg-primary/10">
        <button type="button" id="load-linked" class="w-full text-left p-3">
          <p class="text-sm font-medium truncate">${t('load.linked')}</p>
          <p class="text-xs opacity-60 truncate">${escHtml(offer.label)}</p>
          ${urlLine(t('load.urlScheduled'), offer.scheduledUrl)}
          ${urlLine('vp', offer.vehiclesUrl)}
          ${urlLine('tu', offer.tripUpdatesUrl)}
          ${urlLine('al', offer.alertsUrl)}
        </button>
        ${
          offer.canRetryWithCors
            ? `<div class="px-3 pb-3">
          <button type="button" id="load-linked-retry" class="btn btn-xs btn-primary">${t('load.retryCors')}</button>
        </div>`
            : ''
        }
      </div>`;
}

// ─── The modal ────────────────────────────────────────────────────────────────

/** A URL field, its label, and the proxy checkbox that governs it. */
const SCHEDULED_FIELD: [id: string, label: string, corsId: string] = [
  'load-scheduled-url',
  t('load.scheduledGtfs'),
  'load-scheduled-cors',
];

const RT_FIELDS: Array<[id: string, label: string, corsId: string]> = [
  ['load-vehicles-url', 'Vehicle Positions', 'load-rt-cors'],
  ['load-trip-updates-url', 'Trip Updates', 'load-rt-cors'],
  ['load-alerts-url', 'Service Alerts', 'load-rt-cors'],
];

const RT_FIELD_IDS = RT_FIELDS.map(([id]) => id);

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

const CUSTOM_SCHEDULED = t('load.customScheduledLabel');
const CUSTOM_RT = t('load.customRealtimeLabel');

export async function showLoadModal(
  current: FeedSelection | null,
  options: LoadModalOptions = {}
): Promise<LoadModalResult> {
  const realtime = options.realtime ?? true;

  /** Every URL field on screen, so validation can name the one that is wrong. */
  const urlFields = realtime
    ? [SCHEDULED_FIELD, ...RT_FIELDS]
    : [SCHEDULED_FIELD];

  /**
   * The first URL problem in the form, or '' when there is none. Reported
   * through the same hint line as the missing-feed message, so the Load button
   * is never enabled on a URL that cannot be fetched.
   */
  const describeBadUrl = (): string => {
    for (const [id, label, corsId] of urlFields) {
      const raw = input(id).value.trim();
      if (!raw) {
        continue;
      }
      const problem = validateFeedUrl(raw, input(corsId).checked);
      if (problem) {
        return `${label}: ${problem}`;
      }
    }
    return '';
  };

  // The catalog is already in flight while the modal paints, and is not
  // allowed to keep it shut: the URL fields and upload need no list at all.
  // Rows land when it does.
  const catalog = catalogFeedRows(realtime);
  let loading = true;
  let rows: FeedRow[] = [];
  let matcher = new FeedMatcher([]);
  let visible: FeedRow[] = [];
  let result: LoadModalResult = null;

  // Slot state that is not held in the DOM: the labels a row click supplies,
  // which row each slot came from, and an uploaded file (which cannot be put
  // back into a file input).
  let scheduledLabel = current?.scheduled?.label ?? CUSTOM_SCHEDULED;
  let rtLabel = current?.realtime?.label ?? CUSTOM_RT;
  let scheduledRowId: string | null = null;
  let rtRowId: string | null = null;
  let scheduledFile: File | undefined =
    current?.scheduled?.kind === 'file' ? current.scheduled.file : undefined;

  const rtSection = `
      <section id="load-rt-section" class="shrink-0 rounded-lg border border-base-300 p-3 space-y-2 transition-colors">
        <div class="flex items-center justify-between gap-2">
          <h4 class="font-medium text-sm truncate">
            ${t('load.realtimeGtfs')} <span id="load-rt-label" class="font-normal opacity-60"></span>
          </h4>
          ${corsToggle('load-rt-cors')}
        </div>
        ${rtField('load-vehicles-url', 'Vehicle Positions', 'https://…/vehicle_positions.pb')}
        ${rtField('load-trip-updates-url', 'Trip Updates', 'https://…/trip_updates.pb')}
        ${rtField('load-alerts-url', 'Service Alerts', 'https://…/alerts.pb')}
      </section>`;

  const scheduledSection = `
      <section id="load-scheduled-section" class="shrink-0 rounded-lg border border-base-300 p-3 space-y-2 transition-colors">
        <div class="flex items-center justify-between gap-2">
          <h4 class="font-medium text-sm truncate">
            ${t('load.scheduledGtfs')} <span id="load-scheduled-label" class="font-normal opacity-60"></span>
          </h4>
          ${corsToggle('load-scheduled-cors')}
        </div>
        <div class="flex gap-2">
          <input type="text" id="load-scheduled-url" class="input input-bordered input-xs flex-1 min-w-0 font-mono" placeholder="${escHtml(t('load.scheduledPlaceholder'))}" spellcheck="false" autocomplete="off" />
          <button type="button" id="load-upload-btn" class="btn btn-xs btn-outline gap-1 shrink-0">
            ${renderUploadIcon('h-3.5 w-3.5')} ${t('load.uploadZip')}
          </button>
          <input type="file" id="load-file-input" accept=".zip" class="hidden" />
        </div>
        <div id="load-file-row" class="hidden items-center gap-2">
          <p id="load-file-name" class="text-xs opacity-60 truncate"></p>
          <button type="button" id="load-file-clear" class="btn btn-ghost btn-xs shrink-0">${t('common.clear')}</button>
        </div>
      </section>`;

  // A fixed-height column, not a stack that grows with its contents. The slots
  // are as tall as they are — the realtime app has four URL fields where the
  // editor has one — so a content-sized modal is a different height in each
  // app, and tall enough in the realtime one to make the modal body scroll
  // *behind* the result list's own scrollbar. Pinning the height and letting
  // the results absorb the slack means there is exactly one scrollbar on the
  // screen, always the same one, in both apps.
  //
  // Search first: results lead, and the URL/upload block sits below as the
  // escape hatch.
  const body = `
    <div class="flex h-full min-h-0 min-w-0 flex-col gap-3">
      ${options.notice ? noticeBlock(options.notice) : ''}
      ${options.linkedWith ? linkedCard(options.linkedWith) : ''}
      ${options.continueWith ? continueCard(options.continueWith) : ''}

      <div class="flex shrink-0 items-center gap-3">
        <input type="text" id="load-search" class="input input-bordered input-sm min-w-0 flex-1" placeholder="${escHtml(t('load.searchPlaceholder'))}" autofocus />
        <label class="flex items-center gap-2 text-xs cursor-pointer font-normal shrink-0">
          <input type="checkbox" id="load-show-all" class="toggle toggle-xs" />
          ${t('load.showAll')} <span id="load-hidden-count" class="opacity-60"></span>
          ${renderTooltipTrigger(showAllTooltip(realtime), '<span class="opacity-60">?</span>')}
        </label>
      </div>
      <div id="load-results" class="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden"></div>

      <p id="load-status" class="shrink-0 text-xs opacity-60 flex items-center gap-2">
        <span class="loading loading-spinner loading-xs"></span> ${t('load.loadingFeeds')}
      </p>
      <div id="load-notes" class="shrink-0 space-y-1"></div>

      ${scheduledSection}

      ${realtime ? rtSection : ''}
    </div>
  `;

  /** The current form state as a selection. */
  const readForm = (): FeedSelection => {
    const val = (id: string) => normalizeFeedUrl(input(id).value);
    const checked = (id: string) => input(id).checked;

    const scheduledUrl = val('load-scheduled-url');

    let scheduledSource: FeedSelection['scheduled'] = null;
    if (scheduledFile) {
      scheduledSource = {
        kind: 'file',
        file: scheduledFile,
        label: scheduledFile.name,
      };
    } else if (scheduledUrl) {
      scheduledSource = {
        kind: 'url',
        url: scheduledUrl,
        useCors: checked('load-scheduled-cors'),
        label: scheduledLabel,
      };
    }

    if (!realtime) {
      return { scheduled: scheduledSource, realtime: null };
    }

    const vehiclesUrl = val('load-vehicles-url');
    const tripUpdatesUrl = val('load-trip-updates-url');
    const alertsUrl = val('load-alerts-url');
    const hasRt = Boolean(vehiclesUrl || tripUpdatesUrl || alertsUrl);
    return {
      scheduled: scheduledSource,
      realtime: hasRt
        ? {
            vehiclesUrl: vehiclesUrl || undefined,
            tripUpdatesUrl: tripUpdatesUrl || undefined,
            alertsUrl: alertsUrl || undefined,
            useCors: checked('load-rt-cors'),
            label: rtLabel,
          }
        : null,
    };
  };

  await showModal({
    title:
      options.continueWith || options.linkedWith
        ? t('load.titleOpen')
        : t('load.titleLoad'),
    body,
    // An explicit height, not just a cap: `h-full` on the body only resolves
    // against a definite one, and that is what lets the result list flex. Width
    // is deliberately not set here, so both apps take it from their own
    // `showModal` default and the modal is the same size in each.
    boxClassName: 'h-[80vh]',
    actionBarContent:
      '<p id="load-hint" class="text-xs opacity-60 min-w-0 truncate"></p>',
    escapeAction: 1,
    // Deliberately no `enterAction`: the search box is the field most likely to
    // have focus, and Enter there meaning "load" would fire on a half-typed
    // query. Loading is a click.
    actions: [
      {
        label: t('common.load'),
        className: 'btn-primary',
        onClick: () => {
          const sel = readForm();
          if (describeBadUrl() || !isComplete(sel, realtime)) {
            return true;
          }
          result = { kind: 'selection', selection: sel };
          return;
        },
      },
      { label: t('common.cancel'), onClick: () => {} },
      ...(options.extraActions ?? []),
    ],
    onMount: (close) => {
      // The continue card is its own action: it neither reads nor validates the
      // form, so it closes the modal directly rather than going through one of
      // the action-bar buttons.
      document
        .getElementById('load-continue')
        ?.addEventListener('click', () => {
          result = { kind: 'continue' };
          close();
        });

      const searchInput = input('load-search');
      const showAllInput = input('load-show-all');
      const hiddenCountEl = document.getElementById('load-hidden-count')!;
      const resultsEl = document.getElementById('load-results')!;
      const scheduledLabelEl = document.getElementById('load-scheduled-label')!;
      const rtLabelEl = document.getElementById('load-rt-label');
      const fileInput = input('load-file-input');
      const fileRow = document.getElementById('load-file-row')!;
      const fileNameEl = document.getElementById('load-file-name')!;
      const hintEl = document.getElementById('load-hint')!;
      const statusEl = document.getElementById('load-status')!;
      const notesEl = document.getElementById('load-notes')!;
      const loadBtn = resultsEl
        .closest('.modal')!
        .querySelector<HTMLButtonElement>('button[data-idx="0"]')!;

      const renderResults = () => {
        const inUse = new Set(
          [scheduledRowId, rtRowId].filter(Boolean) as string[]
        );
        resultsEl.innerHTML = renderRows(
          visible,
          inUse,
          realtime,
          loading ? t('load.loading') : t('load.noResults')
        );
      };

      /**
       * A file source has no URL, so the URL field and its proxy checkbox stop
       * meaning anything while one is attached.
       */
      const showFile = () => {
        fileNameEl.textContent = scheduledFile?.name ?? '';
        fileRow.classList.toggle('hidden', !scheduledFile);
        fileRow.classList.toggle('flex', Boolean(scheduledFile));
        input('load-scheduled-url').disabled = Boolean(scheduledFile);
        input('load-scheduled-cors').disabled = Boolean(scheduledFile);
        if (scheduledFile) {
          input('load-scheduled-url').value = '';
        }
      };

      const revalidate = () => {
        scheduledLabelEl.textContent = scheduledFile
          ? `— ${scheduledFile.name}`
          : `— ${scheduledLabel}`;
        if (rtLabelEl) {
          rtLabelEl.textContent = `— ${rtLabel}`;
        }
        const problem =
          describeBadUrl() || describeMissing(readForm(), realtime);
        loadBtn.disabled = problem !== '';
        hintEl.textContent = problem;
      };

      /**
       * The URL block sits below the result list, so a row click fills a
       * section the eye is not on. Flash its border to say the click landed.
       */
      const flashSection = (id: string) => {
        const el = document.getElementById(id);
        if (!el) {
          return;
        }
        el.classList.add('border-primary', 'bg-primary/5');
        window.setTimeout(() => {
          el.classList.remove('border-primary', 'bg-primary/5');
        }, 600);
      };

      /** Fill whichever slots a row supplies, and leave the other one alone. */
      const applyRow = (rowId: string) => {
        const row = rows.find((r) => r.rowId === rowId);
        if (!row) {
          return;
        }

        if (row.provides !== 'rt') {
          scheduledFile = undefined;
          fileInput.value = '';
          showFile();
          input('load-scheduled-url').value = row.scheduledUrl ?? '';
          input('load-scheduled-cors').checked = row.scheduledCors;
          scheduledLabel = row.feed.name;
          scheduledRowId = row.rowId;
          flashSection('load-scheduled-section');
        }
        if (realtime && row.provides !== 'scheduled') {
          input('load-vehicles-url').value = row.vehiclesUrl ?? '';
          input('load-trip-updates-url').value = row.tripUpdatesUrl ?? '';
          input('load-alerts-url').value = row.alertsUrl ?? '';
          input('load-rt-cors').checked = row.rtCors;
          rtLabel = row.feed.name;
          rtRowId = row.rowId;
          flashSection('load-rt-section');
        }
        renderResults();
        revalidate();
      };

      /**
       * Put the link's URLs back in the fields. The fields are already seeded
       * from the same selection when the modal opens, so this only matters
       * after they have been edited — which is exactly when the card stops
       * being a restatement and starts being an undo.
       */
      const applyLinked = (offer: LinkedOffer) => {
        scheduledFile = undefined;
        fileInput.value = '';
        showFile();
        input('load-scheduled-url').value = offer.scheduledUrl ?? '';
        scheduledLabel = offer.label;
        scheduledRowId = null;
        flashSection('load-scheduled-section');
        if (realtime) {
          input('load-vehicles-url').value = offer.vehiclesUrl ?? '';
          input('load-trip-updates-url').value = offer.tripUpdatesUrl ?? '';
          input('load-alerts-url').value = offer.alertsUrl ?? '';
          rtLabel = offer.label;
          rtRowId = null;
          flashSection('load-rt-section');
        }
        renderResults();
        revalidate();
      };

      /**
       * Typing detaches the slot from the row it came from: the URLs are no
       * longer that agency's, so neither is the name.
       */
      const detachScheduled = () => {
        if (scheduledRowId === null) {
          return;
        }
        scheduledRowId = null;
        scheduledLabel = CUSTOM_SCHEDULED;
        renderResults();
      };
      const detachRt = () => {
        if (rtRowId === null) {
          return;
        }
        rtRowId = null;
        rtLabel = CUSTOM_RT;
        renderResults();
      };

      const filterAndRender = () => {
        // No query keeps catalog order, newest schedule first; a query ranks.
        const ranked = matcher.match(searchInput.value);
        const matched = ranked ? ranked.map((i) => rows[i]) : rows;
        const listed = showAllInput.checked
          ? matched
          : matched.filter((r) => r.valid);
        const hidden = matched.length - listed.length;
        hiddenCountEl.textContent = hidden > 0 ? `(+${hidden})` : '';
        visible = listed.slice(0, DISPLAY_CAP);
        renderResults();
      };

      void (async () => {
        let note: string | null = null;
        try {
          rows = await catalog;
        } catch (err) {
          note = catalogNote(err);
        }
        loading = false;
        // A slow fetch can land after the modal is gone.
        if (!resultsEl.isConnected) {
          return;
        }
        if (note) {
          notesEl.insertAdjacentHTML(
            'beforeend',
            `<p class="text-xs text-warning">${escHtml(note)}</p>`
          );
        }
        // Both classes, like the file row: `hidden` and `flex` are the same
        // specificity, so leaving `flex` on would keep the line visible.
        statusEl.classList.add('hidden');
        statusEl.classList.remove('flex');
        matcher = new FeedMatcher(rows.map((r) => r.feed));
        filterAndRender();
      })();

      // Delegated, so re-rendering the list never re-wires handlers.
      resultsEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-custom-url]')) {
          const section = document.getElementById('load-scheduled-section');
          section?.scrollIntoView({ block: 'nearest' });
          flashSection('load-scheduled-section');
          input('load-scheduled-url').focus();
          return;
        }
        const btn = target.closest<HTMLElement>('[data-row-id]');
        if (btn?.dataset.rowId) {
          applyRow(btn.dataset.rowId);
        }
      });

      const linked = options.linkedWith;
      if (linked) {
        document
          .getElementById('load-linked')!
          .addEventListener('click', () => {
            applyLinked(linked);
          });
        // The retry is the Load button with the proxy boxes ticked first, not a
        // second way to load: same form, same validation, same result.
        document
          .getElementById('load-linked-retry')
          ?.addEventListener('click', () => {
            applyLinked(linked);
            input('load-scheduled-cors').checked = true;
            if (realtime) {
              input('load-rt-cors').checked = true;
            }
            revalidate();
            const sel = readForm();
            if (describeBadUrl() || !isComplete(sel, realtime)) {
              return;
            }
            result = { kind: 'selection', selection: sel };
            close();
          });
      }

      input('load-scheduled-url').addEventListener('input', () => {
        detachScheduled();
        revalidate();
      });
      if (realtime) {
        RT_FIELD_IDS.forEach((id) => {
          input(id).addEventListener('input', () => {
            detachRt();
            revalidate();
          });
        });
      }

      // The proxy checkbox is an input to URL validation, not just to the
      // result, so an http URL flips between fine and blocked as it is toggled.
      input('load-scheduled-cors').addEventListener('change', revalidate);
      if (realtime) {
        input('load-rt-cors').addEventListener('change', revalidate);
      }

      document
        .getElementById('load-upload-btn')!
        .addEventListener('click', () => {
          fileInput.click();
        });
      fileInput.addEventListener('change', () => {
        scheduledFile = fileInput.files?.[0];
        detachScheduled();
        showFile();
        revalidate();
      });
      document
        .getElementById('load-file-clear')!
        .addEventListener('click', () => {
          scheduledFile = undefined;
          fileInput.value = '';
          showFile();
          revalidate();
        });

      searchInput.addEventListener('input', filterAndRender);
      showAllInput.addEventListener('change', filterAndRender);

      // Seed from what is loaded, so reopening the modal is how a feed is edited.
      if (current?.scheduled?.kind === 'url') {
        input('load-scheduled-url').value = current.scheduled.url;
        input('load-scheduled-cors').checked = current.scheduled.useCors;
      }
      if (realtime && current?.realtime) {
        input('load-vehicles-url').value = current.realtime.vehiclesUrl ?? '';
        input('load-trip-updates-url').value =
          current.realtime.tripUpdatesUrl ?? '';
        input('load-alerts-url').value = current.realtime.alertsUrl ?? '';
        input('load-rt-cors').checked = current.realtime.useCors;
      }
      showFile();
      revalidate();
      renderResults();
    },
  });

  return result;
}
