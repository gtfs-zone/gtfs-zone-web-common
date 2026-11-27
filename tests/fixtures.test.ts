/**
 * Holds: every fixture file matches its sha256 in fixtures/SHA256SUMS, and
 * SHA256SUMS lists every file under fixtures/. Documented in README.md#test-kit.
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  FIXTURES_DIR,
  fixtureFiles,
  readChecksums,
  sha256,
} from '../scripts/fixtures/checksums';

describe('fixtures/SHA256SUMS', () => {
  const sums = readChecksums();

  it('lists exactly the files under fixtures/', () => {
    assert.deepEqual([...sums.keys()].sort(), fixtureFiles());
  });

  for (const [path, hash] of sums) {
    it(`pins ${path}`, () => {
      assert.equal(sha256(join(FIXTURES_DIR, path)), hash);
    });
  }
});
