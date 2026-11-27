/**
 * Holds: with the test override global set, every basemap id resolves to the
 * override style, so a Playwright run loads no remote tiles. Documented in
 * README.md#test-kit.
 */
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { basemapStyles, getBasemapStyle } from '../src/map/basemap-styles';
import { BASEMAP_OVERRIDE_GLOBAL } from '../src/testing/basemap-fixture.js';

const globals = globalThis as Record<string, unknown>;

describe('getBasemapStyle', () => {
  afterEach(() => {
    delete globals[BASEMAP_OVERRIDE_GLOBAL];
  });

  it('returns the built-in style without an override', () => {
    assert.equal(getBasemapStyle('standard')?.style, basemapStyles[0].style);
  });

  it('returns the override style for every id', () => {
    const override = { version: 8, sources: {}, layers: [] };
    globals[BASEMAP_OVERRIDE_GLOBAL] = override;
    for (const { id } of basemapStyles) {
      assert.equal(getBasemapStyle(id)?.style, override);
    }
    assert.equal(getBasemapStyle('missing'), undefined);
  });
});
