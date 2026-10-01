/**
 * The parts of a help page registry every app shares: the groups, the glyph
 * icons, and the About and Keyboard Shortcuts pages. Each app builds its own
 * `HELP_PAGES` from these plus its own copy, and hands them to `help-modal.ts`
 * with `setHelpPages`.
 */

import { type HelpPageEntry } from './help-modal';
import {
  renderBlurb,
  renderVersionAndSource,
  renderProjectSection,
  renderResourcesSection,
  renderDataSourcesSection,
  renderFeedbackSection,
  type AboutApp,
} from './about-links';
import { moduleState } from '../util/module-state';

type HelpGroup = 'Getting Started' | 'Reference';

/** A help page, narrowing the viewer's `group` to the shared groups. */
export interface HelpPage extends HelpPageEntry {
  group: HelpGroup;
}

/** The order the viewer's sidebar groups pages in. */
export const HELP_GROUP_ORDER: HelpGroup[] = ['Getting Started', 'Reference'];

/** A glyph-list icon: `paths` drawn in a 32x32 stroked SVG. */
export function helpIcon(paths: string): string {
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export const ICON_LOAD = helpIcon(
  '<path d="M16 4v16M9 13l7 7 7-7"/><path d="M6 24v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/>'
);
export const ICON_MAP = helpIcon(
  '<path d="M16 5c-4.4 0-8 3.4-8 7.6C8 18.4 16 27 16 27s8-8.6 8-14.4C24 8.4 20.4 5 16 5z"/><circle cx="16" cy="12.5" r="2.5"/>'
);
export const ICON_CHECK = helpIcon(
  '<path d="M16 4l9 4v7c0 6.6-4 11.4-9 13-5-1.6-9-6.4-9-13v-7z"/><path d="M12 16l3 3 5-6"/>'
);
export const ICON_LEG = helpIcon(
  '<circle cx="6" cy="26" r="2"/><circle cx="24" cy="8" r="2"/><path d="M6.5 24c5.5-9 8-11 8-16 0 5 2.5 7 8 16"/>'
);

/** One row of the Keyboard Shortcuts table, as `describeShortcuts` returns it. */
interface ShortcutDescription {
  key: string;
  description: string;
}

interface HelpRuntimeData {
  version: string;
  shortcuts: ShortcutDescription[];
}

const shared = moduleState('ui/help-pages', (): HelpRuntimeData => ({
  version: '',
  shortcuts: [],
}));

/**
 * The version and shortcut list are only known at boot (`__APP_VERSION__`
 * and the app's command list), so the app pushes them in once.
 */
export function setHelpRuntimeData(data: HelpRuntimeData): void {
  shared.version = data.version;
  shared.shortcuts = data.shortcuts;
}

function buildShortcutsTable(shortcuts: ShortcutDescription[]): string {
  const rows = shortcuts
    .map((s) => {
      const keyHtml = s.key
        .split('+')
        .map((token) => `<kbd class="kbd kbd-xs">${token}</kbd>`)
        .join('+');
      return `<tr><td class="whitespace-nowrap">${keyHtml}</td><td>${s.description}</td></tr>`;
    })
    .join('');
  return `
    <table class="table table-xs w-full">
      <thead><tr><th>Key</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/**
 * The About page: blurb, version and source, `sections`, then feedback.
 * `sections` defaults to the shared Project, Resources and Data Sources
 * blocks; an app passes its own when those do not fit it.
 */
export function aboutPage(
  app: AboutApp,
  sections: string[] = [
    renderProjectSection(app),
    renderResourcesSection(),
    renderDataSourcesSection(),
  ]
): HelpPage {
  return {
    id: 'about',
    label: 'About',
    group: 'Reference',
    title: `About ${app.name}`,
    render: () =>
      [
        renderBlurb(app),
        renderVersionAndSource(app, shared.version),
        ...sections,
        renderFeedbackSection(app),
      ].join('\n'),
  };
}

/** The Keyboard Shortcuts page, listing what `setHelpRuntimeData` was given. */
export const shortcutsPage: HelpPage = {
  id: 'shortcuts',
  label: 'Keyboard Shortcuts',
  group: 'Reference',
  title: 'Using keyboard shortcuts',
  render: () => buildShortcutsTable(shared.shortcuts),
};
