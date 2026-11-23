import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatRelativeTime, formatSpeed } from '../src/i18n/fmt';

describe('formatSpeed', () => {
  it('converts metres per second to km/h with one decimal', () => {
    assert.equal(formatSpeed(10, 'en'), '36.0 km/h');
  });
});

describe('formatRelativeTime', () => {
  const now = 1_000_000_000;
  it('uses the largest whole unit', () => {
    assert.equal(formatRelativeTime(now - 12_000, now, 'en'), '12 seconds ago');
    assert.equal(formatRelativeTime(now - 150_000, now, 'en'), '2 minutes ago');
    assert.equal(formatRelativeTime(now + 12_000, now, 'en'), 'in 12 seconds');
  });
  it('says now for the current instant', () => {
    assert.equal(formatRelativeTime(now, now, 'en'), 'now');
  });
});
