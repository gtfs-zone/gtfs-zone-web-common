import { describe, it } from 'node:test';
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

  it('puts place tags in the haystack', () => {
    assert.match(feedHaystack(feeds[0]), /Bavaria/);
  });

  it('finds a feed by a place tag', () => {
    assert.deepEqual(new FeedMatcher(feeds).match('bavaria'), [0]);
  });
});
