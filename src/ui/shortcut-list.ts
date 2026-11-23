import type { ShortcutCommand } from './keyboard-shortcuts';
import { t } from '../i18n/messages';

/**
 * The keyboard commands the realtime apps share: map search, clearing it and
 * the guide. Each app puts its own commands before these.
 */
export interface MapShortcutHost {
  /** Open the guide, through the modal router so the hash names it. */
  openGuide: () => void;
  /** Drop the search text and its result list. */
  clearSearch: () => void;
}

export function mapShortcuts(
  host: MapShortcutHost,
  extras: ShortcutCommand[] = []
): ShortcutCommand[] {
  return [
    ...extras,
    // Two keys for one action: `/` is the map convention and Ctrl+K the
    // command-palette one.
    {
      keys: '/',
      description: t('shortcut.focusSearch'),
      handler: (e) => {
        e?.preventDefault();
        focusMapSearch();
      },
    },
    {
      keys: 'ctrl+k',
      description: t('shortcut.focusSearch'),
      handler: (e) => {
        e?.preventDefault();
        focusMapSearch();
      },
    },
    // Allowed in input fields: Escape from inside the search box is the main
    // way this one is pressed.
    {
      keys: 'escape',
      description: t('shortcut.clearSearch'),
      allowInInputFields: true,
      handler: () => {
        (
          document.getElementById('map-search') as HTMLInputElement | null
        )?.blur();
        host.clearSearch();
      },
    },
    // `?` is Shift+/, so the normalized key string carries the modifier.
    {
      keys: 'shift+?',
      description: t('shortcut.showGuide'),
      handler: (e) => {
        e?.preventDefault();
        host.openGuide();
      },
    },
  ];
}

function focusMapSearch(): void {
  const mapSearch = document.getElementById(
    'map-search'
  ) as HTMLInputElement | null;
  mapSearch?.focus();
  mapSearch?.select();
}
