/**
 * The app shell markup: navbar, map with its control strip, right panel, and
 * the optional mobile dock. Styled by `app-shell.css`.
 *
 * The element ids are the contract with the modules that bind to them:
 * `search-controller` (`#map-search`, `#map-search-card`), `auto-zoom`
 * (`#auto-zoom-mount`), `bottom-sheet` (`#right-panel`, `#sheet-top-handle`,
 * `#mobile-dock`), `panel-resizer` (`#panel-resizer`, `.app-container`) and
 * `navbar-actions` (`#navbar-actions`, the dock button ids).
 *
 * The brand (logo and host) opens the tool switcher: every tool in
 * `tools.json`, then the version this deploy runs and the kept versions listed
 * in `/versions.json`. The version section stays hidden while that file is
 * missing, as it is on the dev server.
 *
 * Mount it before anything looks those ids up: in practice, from a module the
 * app's entry point imports first, since imported modules are evaluated before
 * the entry's own body.
 */

import { z } from 'zod';
import { escapeHtml } from '../util/escape-html';
import { t } from '../i18n/messages';
import { TOOLS, findToolByHost, toolDescription } from './tools';

/** One mobile dock button. Its icon is filled by `renderDockIcons`. */
export interface ShellDockButton {
  id: string;
  label: string;
  /** Defaults to `label`. */
  ariaLabel?: string;
  /** Starts highlighted: the dock's Browse button. */
  active?: boolean;
  /**
   * Wrap the icon in an indicator carrying a hidden badge, as `<id>-icon` and
   * `<id>-badge`. The icon then goes in `<id>-icon`, so the badge keeps its
   * anchor.
   */
  badge?: boolean;
}

export interface AppShellOptions {
  /** The highlighted first label of the host name, e.g. `viz`. */
  brandPrefix: string;
  /** The rest of the host name, e.g. `.rt.gtfs.zone`. */
  brandSuffix: string;
  /**
   * The version this build runs, e.g. `v0.47.0`. Shown after the host and at
   * the top of the version section. Omit to fill `#app-version` yourself.
   */
  version?: string;
  /** Markup placed before `#navbar-actions`, e.g. an extra dropdown. */
  navbarExtra?: string;
  /** Markup appended to `#map-controls` after the auto-zoom toggle. */
  mapControlsExtra?: string;
  /** What `#panel-content` shows before the app renders into it. */
  panelPlaceholder: string;
  /** Mobile dock buttons; omit for an app with no dock. */
  dock?: ShellDockButton[];
}

function renderDockButton(button: ShellDockButton): string {
  const aria = escapeHtml(button.ariaLabel ?? button.label);
  const cls = button.active ? ' class="dock-active"' : '';
  const badge = button.badge
    ? `<span id="${button.id}-icon" class="indicator"><span id="${button.id}-badge" class="indicator-item badge badge-error badge-xs hidden"></span></span>`
    : '';
  return `<button id="${button.id}"${cls} aria-label="${aria}">${badge}<span class="dock-label">${escapeHtml(button.label)}</span></button>`;
}

/** Where a deploy lists its kept versions (written by the deploy workflow). */
const VERSIONS_URL = '/versions.json';

const versionsSchema = z.object({
  versions: z.array(z.object({ version: z.string().min(1), url: z.url() })),
});

type KeptVersion = z.infer<typeof versionsSchema>['versions'][number];

/** The tool list: the current one marked, the others opening in this tab. */
function renderToolItems(host: string): string {
  const current = findToolByHost(host);
  if (!current) {
    console.warn(`[AppShell] ${host} is not in tools.json`);
  }
  return TOOLS.map((tool) => {
    const active = tool.id === current?.id;
    const attrs = active ? ' class="menu-active" aria-current="page"' : '';
    return `<li><a href="${escapeHtml(tool.url)}"${attrs}><span class="flex flex-col items-start gap-0.5"><span class="font-semibold">${escapeHtml(tool.host)}</span><span class="text-xs opacity-70">${escapeHtml(toolDescription(tool.id))}</span></span></a></li>`;
  }).join('');
}

function renderToolMenu(opts: AppShellOptions, host: string): string {
  const version = opts.version ? escapeHtml(opts.version) : '';
  return `
    <div class="dropdown dropdown-hover">
      <div tabindex="0" role="button" class="flex items-center gap-4 cursor-pointer" aria-haspopup="menu" aria-label="${escapeHtml(t('shell.tools'))}">
        <div class="avatar">
          <div class="w-8 rounded-lg"><img src="logo.svg" alt="${escapeHtml(t('shell.logoAlt', { host }))}" /></div>
        </div>
        <div class="text-xl font-bold hidden md:block">
          <span class="text-primary">${escapeHtml(opts.brandPrefix)}</span>${escapeHtml(opts.brandSuffix)}<sup id="app-version" class="text-xs opacity-50 font-normal ml-1">${version}</sup>
        </div>
      </div>
      <ul tabindex="-1" class="dropdown-content menu bg-base-100 rounded-box z-[60] w-80 max-w-[calc(100vw-1rem)] p-2 shadow-lg">
        <li>
          <h2 class="menu-title">${escapeHtml(t('shell.tools'))}</h2>
          <ul>${renderToolItems(host)}</ul>
        </li>
        <li id="app-versions" class="hidden">
          <h2 class="menu-title">${escapeHtml(t('shell.versions'))}</h2>
          <ul id="app-versions-list"></ul>
        </li>
      </ul>
    </div>`;
}

function renderAppShell(opts: AppShellOptions): string {
  const host = `${opts.brandPrefix}${opts.brandSuffix}`;
  const dock = opts.dock
    ? `<nav id="mobile-dock" class="dock dock-sm md:hidden z-50 bg-base-200 border-t border-base-300 pb-[env(safe-area-inset-bottom)]">
        ${opts.dock.map(renderDockButton).join('')}
      </nav>`
    : '';

  return `
    <div class="app-container h-screen grid grid-rows-[auto_1fr]">
      <div class="navbar bg-base-100 col-span-2 border-b border-base-300 z-50">
        <div class="navbar-start">
          ${renderToolMenu(opts, host)}
        </div>
        <div class="navbar-end">
          <div class="flex items-center gap-2">
            ${opts.navbarExtra ?? ''}
            <div id="navbar-actions" class="flex items-center gap-2"></div>
          </div>
        </div>
      </div>

      <div class="relative bg-base-300 min-h-0">
        <div id="map" class="w-full h-full"></div>
        <div id="map-controls" class="absolute top-2 left-2 right-2 z-40 flex flex-row items-start gap-2 pointer-events-none">
          <div id="map-search-card" class="relative flex-1 max-w-sm card card-bordered bg-base-100 shadow-lg p-2 pointer-events-auto">
            <input type="text" id="map-search" placeholder="${escapeHtml(t('shell.search'))}" class="input input-sm w-full" />
          </div>
          <div id="auto-zoom-mount" class="pointer-events-auto flex-shrink-0"></div>
          ${opts.mapControlsExtra ?? ''}
        </div>
      </div>

      <div id="right-panel" class="right-panel relative bg-base-200 border-l border-base-300 flex flex-col overflow-hidden min-h-0">
        <div id="sheet-top-handle" class="md:hidden flex justify-center items-center py-2 cursor-grab active:cursor-grabbing flex-shrink-0">
          <div class="w-10 h-1 rounded-full bg-base-content/20"></div>
        </div>
        <div id="panel-resizer" class="hidden md:block absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10 group">
          <div class="absolute inset-y-0 left-0.5 w-px bg-base-300 group-hover:bg-primary/50 transition-colors"></div>
        </div>
        <div id="panel-content" class="panel-scroll scroll-host flex-1 overflow-y-auto bg-base-100 p-4">
          <p class="text-base-content/50 text-sm text-center py-8">${escapeHtml(opts.panelPlaceholder)}</p>
        </div>
      </div>
    </div>
    ${dock}`;
}

/** Read `/versions.json`; null when the deploy has none. */
async function fetchKeptVersions(): Promise<KeptVersion[] | null> {
  let res: Response;
  try {
    res = await fetch(VERSIONS_URL, { cache: 'no-cache' });
  } catch (err) {
    console.warn('[AppShell] versions.json fetch failed', err);
    return null;
  }
  // The dev server answers an unknown path with index.html.
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('json')) {
    console.log('[AppShell] no versions.json, version section hidden');
    return null;
  }
  const parsed = versionsSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.warn('[AppShell] versions.json is malformed', parsed.error);
    return null;
  }
  return parsed.data.versions;
}

/** Fill and show the version section once `/versions.json` answers. */
async function renderVersions(current: string | undefined): Promise<void> {
  const versions = await fetchKeptVersions();
  const section = document.getElementById('app-versions');
  const list = document.getElementById('app-versions-list');
  if (!versions || !section || !list) {
    return;
  }
  const items: string[] = [];
  if (current) {
    items.push(
      `<li><span class="menu-active" aria-current="true">${escapeHtml(t('shell.currentVersion', { version: current }))}</span></li>`
    );
  }
  for (const kept of versions) {
    if (kept.version === current) {
      continue;
    }
    items.push(
      `<li><a href="${escapeHtml(kept.url)}">${escapeHtml(kept.version)}</a></li>`
    );
  }
  list.innerHTML = items.join('');
  section.classList.toggle('hidden', items.length === 0);
  console.log(`[AppShell] ${versions.length} kept versions listed`);
}

/** Insert the shell at the top of `<body>`. */
export function mountAppShell(opts: AppShellOptions): void {
  document.body.insertAdjacentHTML('afterbegin', renderAppShell(opts));
  void renderVersions(opts.version);
}
