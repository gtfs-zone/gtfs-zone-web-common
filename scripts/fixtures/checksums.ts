/**
 * fixtures/SHA256SUMS: one `<sha256>  <path>` line per fixture file, in the
 * format `sha256sum -c` reads. The builders rewrite it; a test verifies it.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures'
);
const SUMS_PATH = join(FIXTURES_DIR, 'SHA256SUMS');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Every fixture file except SHA256SUMS, relative to fixtures/, sorted. */
export function fixtureFiles(): string[] {
  return files(FIXTURES_DIR)
    .filter((path) => path !== SUMS_PATH)
    .map((path) => relative(FIXTURES_DIR, path))
    .sort();
}

export function readChecksums(): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of readFileSync(SUMS_PATH, 'utf-8').split('\n')) {
    if (line) {
      const [hash, path] = line.split(/ {2}/);
      sums.set(path, hash);
    }
  }
  return sums;
}

export function writeChecksums(): void {
  const lines = fixtureFiles().map(
    (path) => `${sha256(join(FIXTURES_DIR, path))}  ${path}`
  );
  writeFileSync(SUMS_PATH, lines.join('\n') + '\n');
  console.log(`[fixtures] Wrote ${SUMS_PATH} (${lines.length} files)`);
}
