import { renderMoonIcon, renderNavIcon, renderSunIcon } from './nav-icons';
import { githubAction, type NavbarAction } from './navbar-actions';
import { t } from '../i18n/messages';

/**
 * The navbar action row the realtime apps share. Each app passes its own
 * actions before and after the common middle: Alerts, theme, language, guide
 * and GitHub. Element ids are the contract with each app's click wiring.
 */
export interface RealtimeNavbarOptions {
  /** GitHub repo name for the source link. */
  repo: string;
  /** Actions before Alerts. */
  leading?: NavbarAction[];
  /** Actions after the GitHub link; the primary button goes last. */
  trailing?: NavbarAction[];
}

/** A stroked outline glyph with no entry in the shared icon map. */
export function renderOutlineIcon(path: string, sizeClass = 'h-5 w-5'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${sizeClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="${path}" /></svg>`;
}

export function realtimeNavbarActions(
  options: RealtimeNavbarOptions
): NavbarAction[] {
  return [
    ...(options.leading ?? []),
    {
      kind: 'icon',
      id: 'alerts-btn',
      label: t('nav.alerts'),
      icon: renderNavIcon('alerts'),
      badgeId: 'alerts-badge',
      badgeClass: 'badge-error',
    },
    {
      kind: 'toggle',
      id: 'theme-toggle',
      label: t('nav.theme'),
      iconOn: renderSunIcon('swap-on h-5 w-5'),
      iconOff: renderMoonIcon('swap-off h-5 w-5'),
      inputClass: 'theme-controller',
      value: 'light',
    },
    { kind: 'locale', id: 'locale-toggle' },
    {
      kind: 'icon',
      id: 'help-btn',
      label: t('common.guide'),
      icon: renderNavIcon('guide'),
    },
    githubAction(options.repo),
    ...(options.trailing ?? []),
  ];
}
