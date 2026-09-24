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
 * Mount it before anything looks those ids up: in practice, from a module the
 * app's entry point imports first, since imported modules are evaluated before
 * the entry's own body.
 */

import { escapeHtml } from '../util/escape-html';

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
          <a href="https://gtfs.zone" class="flex items-center gap-4" target="_blank" rel="noopener noreferrer">
            <div class="avatar">
              <div class="w-8 rounded-lg"><img src="logo.svg" alt="${escapeHtml(host)} logo" /></div>
            </div>
            <h1 class="text-xl font-bold hidden md:block">
              <span class="text-primary">${escapeHtml(opts.brandPrefix)}</span>${escapeHtml(opts.brandSuffix)}<sup id="app-version" class="text-xs opacity-50 font-normal ml-1"></sup>
            </h1>
          </a>
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
            <input type="text" id="map-search" placeholder="Search" class="input input-sm w-full" />
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
        <div id="panel-content" class="panel-scroll flex-1 overflow-y-auto bg-base-100 p-4">
          <p class="text-base-content/50 text-sm text-center py-8">${escapeHtml(opts.panelPlaceholder)}</p>
        </div>
      </div>
    </div>
    ${dock}`;
}

/** Insert the shell at the top of `<body>`. */
export function mountAppShell(opts: AppShellOptions): void {
  document.body.insertAdjacentHTML('afterbegin', renderAppShell(opts));
}
