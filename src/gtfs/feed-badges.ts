/**
 * A feed's state and its realtime roles as daisyUI badges, so each reads the
 * same in every app. Every function returns an HTML string.
 */

import type { CatalogFeed, FeedState, Role, RoleState } from './feed-catalog';
import {
  FEED_STATE_LABELS,
  ROLE_LABELS,
  ROLE_SHORT,
  realtimeRoles,
} from './feed-catalog';

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

const ROLE_STATE_TEXT: Record<RoleState, string> = {
  up: 'answered the last daily check',
  down: 'did not answer the last daily check',
  unknown: 'not checked',
};

/** "Down since 2026-09-23", or just "Down" without a date. */
export function feedStateText(state: FeedState, since?: string): string {
  const label = FEED_STATE_LABELS[state];
  return since && state !== 'unknown' ? `${label} since ${since}` : label;
}

export function feedStateBadge(
  state: FeedState,
  since?: string,
  size: BadgeSize = 'xs'
): string {
  return `<span class="badge ${SIZE_CLASS[size]} ${FEED_STATE_CLASS[state]}" title="${feedStateText(state, since)}">${FEED_STATE_LABELS[state]}</span>`;
}

export function roleChip(
  role: Role,
  state: RoleState = 'unknown',
  size: BadgeSize = 'xs'
): string {
  const title = `${ROLE_LABELS[role]}: ${ROLE_STATE_TEXT[state]}`;
  return `<span class="badge ${SIZE_CLASS[size]} ${ROLE_STATE_CLASS[state]} font-mono" title="${title}">${ROLE_SHORT[role]}</span>`;
}

/** One chip per realtime role the feed lists, in display order. */
export function roleChips(feed: CatalogFeed, size: BadgeSize = 'xs'): string {
  return realtimeRoles(feed)
    .map((role) => roleChip(role, feed.roleState[role], size))
    .join('');
}
