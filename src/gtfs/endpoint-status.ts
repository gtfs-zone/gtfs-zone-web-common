/**
 * A realtime endpoint's URL and fetch status: what was configured, what is
 * actually fetched, when it last answered, and the FeedHeader it sent.
 *
 * `[data-since]` and `[data-until]` spans are refreshed by the panel ticker.
 */

import type { EndpointStatus } from './rt-poller';
import { REALTIME_ENDPOINT_LABELS } from './feed-selection';
import { isLocalUrl, resolveRealtimeUrl } from './feed-url-resolve';
import { escHtml, formatRelative } from './entity-render';
import { localClock } from './feed-time';
import { formatNumber } from '../i18n/fmt';
import { t } from '../i18n/messages';

export interface EndpointUrlOptions {
  /** Base a bare realtime path resolves against; omit for a schedule URL. */
  rtBase?: string;
  /** The selection fetches through the CORS proxy. */
  useCors?: boolean;
}

/**
 * One URL as configured, linked, plus what happens to it on the way to the
 * network: base resolution for a bare path, the CORS proxy, or neither.
 */
export function renderEndpointUrl(
  url: string,
  options: EndpointUrlOptions = {}
): string {
  if (!url) {
    return `<span class="text-xs opacity-40">${escHtml(t('endpoint.notSet'))}</span>`;
  }

  const resolved =
    options.rtBase !== undefined
      ? resolveRealtimeUrl(url, options.rtBase)
      : url;
  // A local URL ignores the proxy setting; say so only when the proxy is on.
  const proxyBypassed = !!options.useCors && isLocalUrl(resolved);

  return `
    <a href="${escHtml(resolved)}" target="_blank" rel="noopener" class="link block text-xs font-mono break-all">${escHtml(url)}</a>
    ${
      resolved !== url
        ? `<p class="text-xs font-mono break-all opacity-40">-&gt; ${escHtml(resolved)}</p>`
        : ''
    }
    ${options.useCors && !proxyBypassed ? `<p class="text-xs opacity-50">${escHtml(t('endpoint.viaProxy'))}</p>` : ''}
    ${proxyBypassed ? `<p class="text-xs opacity-50">${escHtml(t('endpoint.localUrl'))}</p>` : ''}`;
}

function clockWithAge(ms: number): string {
  return `${escHtml(localClock(ms))} <span class="opacity-60" data-since="${ms}">${escHtml(formatRelative(ms))}</span>`;
}

function headerDump(ep: EndpointStatus): string {
  const h = ep.header;
  if (!h) {
    return '';
  }
  return `
    <details class="text-xs">
      <summary class="cursor-pointer opacity-60">FeedHeader</summary>
      <table class="table table-xs mt-1">
        <tbody>
          <tr><td class="opacity-60">gtfs_realtime_version</td><td>${escHtml(h.gtfsRealtimeVersion || '—')}</td></tr>
          <tr><td class="opacity-60">incrementality</td><td>${escHtml(h.incrementality || '—')}</td></tr>
          <tr><td class="opacity-60">timestamp</td><td>${h.timestamp ?? '—'}</td></tr>
        </tbody>
      </table>
    </details>`;
}

export interface EndpointStatusOptions extends EndpointUrlOptions {
  /** The URL as the user entered it, before resolution. */
  rawUrl: string;
  nextPollAt: number | null;
  /** Extra HTML at the bottom of the block. */
  footer?: string;
}

/** The status block of one endpoint. */
export function renderEndpointStatus(
  ep: EndpointStatus,
  options: EndpointStatusOptions
): string {
  const label = REALTIME_ENDPOINT_LABELS[ep.name];
  const dim = (text: string) =>
    `<span class="opacity-40">${escHtml(text)}</span>`;

  const fetched = ep.lastFetchedAt
    ? clockWithAge(ep.lastFetchedAt)
    : dim(t('endpoint.never'));
  const dataAge = ep.feedTimestamp
    ? clockWithAge(ep.feedTimestamp * 1000)
    : dim(t('endpoint.notReported'));
  const row = (term: string, value: string) => `
    <div class="flex justify-between gap-2">
      <dt class="opacity-60">${term}</dt><dd class="text-right">${value}</dd>
    </div>`;

  return `
    <div class="rounded-lg border border-base-300 p-3 space-y-2">
      <div class="flex items-center gap-2">
        <h4 class="font-medium text-sm flex-1">${escHtml(label)}</h4>
        ${ep.inFlight ? '<span class="loading loading-spinner loading-xs"></span>' : ''}
        ${ep.lastError ? `<span class="badge badge-error badge-xs">${escHtml(t('endpoint.error'))}</span>` : ''}
        ${!ep.url ? `<span class="badge badge-ghost badge-xs">${escHtml(t('endpoint.notSet'))}</span>` : ''}
      </div>

      <dl class="text-xs space-y-1">
        ${row(escHtml(t('endpoint.lastFetched')), fetched)}
        ${row(
          `${escHtml(t('endpoint.feedTimestamp'))} <span class="opacity-50">${escHtml(t('endpoint.dataAge'))}</span>`,
          dataAge
        )}
        ${row(
          escHtml(t('endpoint.entities')),
          `<span class="tabular-nums">${ep.entityCount === null ? '—' : escHtml(formatNumber(ep.entityCount))}</span>`
        )}
        ${row(
          escHtml(t('endpoint.nextRefresh')),
          options.nextPollAt
            ? `<span data-until="${options.nextPollAt}">${escHtml(formatRelative(options.nextPollAt))}</span>`
            : '—'
        )}
      </dl>

      ${
        ep.lastError
          ? `<p class="text-xs text-error break-words">${escHtml(ep.lastError)} <span class="opacity-60">${escHtml(
              t('endpoint.errorAt', {
                time: ep.lastErrorAt ? localClock(ep.lastErrorAt) : '—',
              })
            )}</span></p>`
          : ''
      }

      ${renderEndpointUrl(options.rawUrl, options)}
      ${headerDump(ep)}
      ${options.footer ?? ''}
    </div>`;
}
