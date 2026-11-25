/**
 * A feed's state and its realtime roles as daisyUI badges, so each reads the
 * same in every app. Every function returns an HTML string.
 */

import type { CatalogFeed, FeedState, Role, RoleState } from './feed-catalog';
import { FEED_STATE_LABELS, ROLE_LABELS, realtimeRoles } from './feed-catalog';
import type { NavIconName } from '../ui/nav-icons';
import { renderNavIcon } from '../ui/nav-icons';
import { t } from '../i18n/messages';

type BadgeSize = 'xs' | 'sm' | 'md';

// Literal class names, so Tailwind's source scan keeps them.
const SIZE_CLASS: Record<BadgeSize, string> = {
  xs: 'badge-xs',
  sm: 'badge-sm',
  md: 'badge-md',
};

const FEED_STATE_CLASS: Record<FeedState, string> = {
  up: 'badge-success',
  partial: 'badge-warning',
  down: 'badge-error',
  unknown: 'badge-ghost',
};

const ROLE_STATE_CLASS: Record<RoleState, string> = {
  up: 'badge-success',
  down: 'badge-error',
  unknown: 'badge-ghost',
};

const ROLE_ICON: Record<Role, NavIconName> = {
  scheduled: 'calendar',
  vehicles: 'browse',
  trip_updates: 'history',
  alerts: 'alerts',
  realtime: 'signal',
};

const ICON_SIZE_CLASS: Record<BadgeSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

const ROLE_STATE_TEXT: Record<RoleState, string> = {
  up: t('roleState.up'),
  down: t('roleState.down'),
  unknown: t('roleState.unknown'),
};

/** "Down since 2026-09-23", "Down, never seen up", or just "Down" without a date. */
export function feedStateText(
  state: FeedState,
  since?: string,
  neverUp?: boolean
): string {
  const label = FEED_STATE_LABELS[state];
  if (neverUp && state === 'down') {
    return t('feedState.neverUp', { state: label });
  }
  return since && state !== 'unknown'
    ? t('feedState.since', { state: label, date: since })
    : label;
}

export function feedStateBadge(
  state: FeedState,
  since?: string,
  size: BadgeSize = 'xs',
  neverUp?: boolean
): string {
  return `<span class="badge ${SIZE_CLASS[size]} ${FEED_STATE_CLASS[state]}" title="${feedStateText(state, since, neverUp)}">${FEED_STATE_LABELS[state]}</span>`;
}

/** The role's icon, titled with its full name. */
export function roleIcon(role: Role, sizeClass = 'h-3 w-3'): string {
  return `<span class="inline-flex shrink-0" title="${ROLE_LABELS[role]}" aria-label="${ROLE_LABELS[role]}">${renderNavIcon(ROLE_ICON[role], { sizeClass })}</span>`;
}

export function roleChip(
  role: Role,
  state: RoleState = 'unknown',
  size: BadgeSize = 'xs'
): string {
  const title = `${ROLE_LABELS[role]}: ${ROLE_STATE_TEXT[state]}`;
  return `<span class="badge ${SIZE_CLASS[size]} ${ROLE_STATE_CLASS[state]} px-1" title="${title}" aria-label="${title}">${renderNavIcon(ROLE_ICON[role], { sizeClass: ICON_SIZE_CLASS[size] })}</span>`;
}

/** One chip per realtime role the feed lists, in display order. */
export function roleChips(feed: CatalogFeed, size: BadgeSize = 'xs'): string {
  return realtimeRoles(feed)
    .map((role) => roleChip(role, feed.roleState[role], size))
    .join('');
}
