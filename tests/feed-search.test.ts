import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { parseSearchDocument } from '../src/gtfs/feed-catalog';
import { FeedMatcher, feedHaystack } from '../src/gtfs/feed-search';

const doc = {
  feeds: [
    {
      i: 'nvbw',
      n: 'NVBW',
      p: ['Stuttgart', 'Germany'],
      pt: ['Switzerland', 'Bavaria'],
      ac: 2,
      ov: [['hsl', 'contains']],
      st: 'up',
      rs: {},
      u: {},
    },
    { i: 'hsl', n: 'HSL', p: ['Helsinki'], st: 'up', rs: {}, u: {} },
  ],
};

describe('place tags', () => {
  const feeds = parseSearchDocument(doc);

  it('parses pt into placeTags, empty when absent', () => {
    assert.deepEqual(feeds[0].placeTags, ['Switzerland', 'Bavaria']);
    assert.deepEqual(feeds[1].placeTags, []);
  });

  it('parses ac and ov, empty when absent', () => {
    assert.equal(feeds[0].agencyCount, 2);
    assert.deepEqual(feeds[0].overlaps, [{ feedId: 'hsl', kind: 'contains' }]);
    assert.equal(feeds[1].agencyCount, 0);
    assert.deepEqual(feeds[1].overlaps, []);
  });

  it('puts place tags in the haystack', () => {
    assert.match(feedHaystack(feeds[0]), /Bavaria/);
  });

  it('finds a feed by a place tag', () => {
    assert.deepEqual(new FeedMatcher(feeds).match('bavaria'), [0]);
  });
});
