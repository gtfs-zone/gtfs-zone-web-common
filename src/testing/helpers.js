// @ts-check
/**
 * Shared steps for the apps' Playwright specs: fixture files checked against
 * fixtures/SHA256SUMS, seeded storage, a frozen clock, the local basemap,
 * loading a feed through the shared load modal, waiting for the map to come
 * to rest, and an Argos screenshot with the volatile UI hidden.
 *
 * Plain JS with JSDoc types, for the reason given in `playwright-preset.js`.
 */

import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argosScreenshot } from '@argos-ci/playwright';
import { PMTiles } from 'pmtiles';
import { BASEMAP_HOST, BASEMAP_OVERRIDE_GLOBAL } from './basemap-fixture.js';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').TestInfo} TestInfo */
/** @typedef {import('@argos-ci/playwright').ArgosScreenshotOptions} ArgosScreenshotOptions */

export const FIXTURES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures'
);

/** Feed zips under fixtures/, for `fixturePath`. */
export const FEEDS = {
  mbtaDemo: 'feeds/mbta-demo.zip',
  synthetic: 'feeds/synthetic-demo.zip',
};

/**
 * 08:30 in Boston on the MBTA demo feed's reference weekday
 * (`dates.weekday` in its manifest), so every weekday trip is in service.
 */
export const FIXTURE_NOW = '2026-10-07T08:30:00-04:00';

/** UI that changes between builds or runs and never belongs in a shot. */
export const VOLATILE_UI = ['#app-version', '.notification-item'];

/** @type {Map<string, string> | null} */
let checksums = null;

/**
 * Absolute path of a fixture file, after checking its bytes against
 * fixtures/SHA256SUMS. Throws on a missing or changed file.
 *
 * @param {string} relativePath path under fixtures/, e.g. `FEEDS.mbtaDemo`
 * @returns {string}
 */
export function fixturePath(relativePath) {
  if (!checksums) {
    checksums = new Map();
    const text = readFileSync(join(FIXTURES_DIR, 'SHA256SUMS'), 'utf-8');
    for (const line of text.split('\n')) {
      if (line) {
        const [hash, path] = line.split(/ {2}/);
        checksums.set(path, hash);
      }
    }
  }
  const expected = checksums.get(relativePath);
  if (!expected) {
    throw new Error(`[testing] ${relativePath} is not listed in SHA256SUMS`);
  }
  const path = join(FIXTURES_DIR, relativePath);
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `[testing] ${relativePath}: sha256 ${actual}, SHA256SUMS says ${expected}`
    );
  }
  return path;
}

/**
 * IDs and dates the MBTA demo feed was cut around, written by its builder.
 *
 * @returns {{
 *   dates: Record<'weekday' | 'saturday' | 'sunday', string>,
 *   routesByMode: Record<string, string[]>,
 *   servicesByDay: Record<'weekday' | 'saturday' | 'sunday', string[]>,
 *   stations: Record<string, {
 *     stationId: string,
 *     platformIds: string[],
 *     entranceIds: string[],
 *     levelIds: string[],
 *     pathwayIds: string[],
 *   }>,
 * }}
 */
export function mbtaDemoManifest() {
  const path = fixturePath('feeds/mbta-demo.manifest.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Theme of the project the test runs in, from its `colorScheme`.
 *
 * @param {TestInfo} testInfo
 * @returns {'light' | 'dark'}
 */
export function themeOf(testInfo) {
  return testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light';
}

/**
 * Write localStorage entries before any app script runs.
 *
 * @param {Page} page
 * @param {Record<string, string>} entries
 */
export async function seedStorage(page, entries) {
  await page.addInitScript((items) => {
    for (const [key, value] of Object.entries(items)) {
      localStorage.setItem(key, value);
    }
  }, entries);
}

/**
 * Pin `Date.now()` and `new Date()` to `time`; timers keep running, so the
 * app's own scheduling still works.
 *
 * @param {Page} page
 * @param {string | number | Date} [time]
 */
export async function freezeClock(page, time = FIXTURE_NOW) {
  await page.clock.setFixedTime(time);
}

/**
 * A pmtiles Source over a local file.
 *
 * @param {string} path
 * @returns {import('pmtiles').Source}
 */
function fileSource(path) {
  return {
    getKey: () => path,
    getBytes: async (offset, length) => {
      const handle = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        const data = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + bytesRead
        );
        return { data };
      } finally {
        await handle.close();
      }
    },
  };
}

/** @type {PMTiles | null} */
let archive = null;

/**
 * Serve the fixture basemap from fixtures/basemap/ and make every basemap in
 * the page resolve to its light or dark style. Tiles outside the extract come
 * back empty, as do glyph ranges it does not ship.
 *
 * @param {Page} page
 * @param {'light' | 'dark'} theme
 */
export async function useFixtureBasemap(page, theme) {
  const style = JSON.parse(
    readFileSync(fixturePath(`basemap/style-${theme}.json`), 'utf-8')
  );
  archive ??= new PMTiles(fileSource(fixturePath('basemap/boston.pmtiles')));
  const tiles = archive;

  await page.addInitScript(
    ({ key, value }) => {
      /** @type {Record<string, unknown>} */ (globalThis)[key] = value;
    },
    { key: BASEMAP_OVERRIDE_GLOBAL, value: style }
  );

  await page.route(`${BASEMAP_HOST}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const tile = path.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/);
    if (tile) {
      const [z, x, y] = tile.slice(1).map(Number);
      const found = await tiles.getZxy(z, x, y);
      await route.fulfill({
        status: 200,
        contentType: 'application/x-protobuf',
        body: found ? Buffer.from(found.data) : Buffer.alloc(0),
      });
      return;
    }
    const file = join(FIXTURES_DIR, 'basemap', path);
    if (path.startsWith('/fonts/')) {
      const body = await readFile(file).catch(() => Buffer.alloc(0));
      await route.fulfill({
        status: 200,
        contentType: 'application/x-protobuf',
        body,
      });
      return;
    }
    if (path.startsWith('/sprites/')) {
      await route.fulfill({ status: 200, path: file });
      return;
    }
    throw new Error(`[testing] no fixture for ${BASEMAP_HOST}${path}`);
  });
}

/**
 * @typedef {object} PrepareOptions
 * @property {string[]} [helpPages] help page ids to mark seen, so none auto-opens
 * @property {string | number | Date | null} [now] frozen time; null leaves the clock alone
 * @property {boolean} [basemap] serve the fixture basemap (default true)
 */

/**
 * Seed the theme of the test's project and the seen help pages, freeze the
 * clock and switch to the fixture basemap. Call before the first `goto`.
 *
 * @param {Page} page
 * @param {TestInfo} testInfo
 * @param {PrepareOptions} [options]
 */
export async function preparePage(
  page,
  testInfo,
  { helpPages = [], now = FIXTURE_NOW, basemap = true } = {}
) {
  const theme = themeOf(testInfo);
  /** @type {Record<string, string>} */
  const entries = { theme };
  for (const id of helpPages) {
    entries[`help.${id}.seen`] = '1';
  }
  await seedStorage(page, entries);
  if (now !== null) {
    await freezeClock(page, now);
  }
  if (basemap) {
    await useFixtureBasemap(page, theme);
  }
}

/**
 * Load a feed zip through the shared load modal (`ui/load-modal`), which
 * must be open: pick the file, then press its Load button.
 *
 * @param {Page} page
 * @param {string} zipPath absolute path, e.g. `fixturePath(FEEDS.mbtaDemo)`
 */
export async function loadFeedFile(page, zipPath) {
  await page.setInputFiles('#load-file-input', zipPath);
  await page
    .locator('.modal-open, dialog[open]')
    .getByRole('button', { name: 'Load', exact: true })
    .click();
}

/**
 * Wait until the MapLibre map at `mapPath` (a dotted path from `window`, e.g.
 * `gtfsEditor.mapController.map`) has every tile in and has stayed still
 * across three checks 300 ms apart, then for fonts.
 *
 * @param {Page} page
 * @param {string} mapPath
 */
export async function waitForMapIdle(page, mapPath) {
  await page.waitForFunction(
    (path) =>
      new Promise((resolveStill) => {
        /** @type {any} */
        let map = window;
        for (const key of path.split('.')) {
          map = map?.[key];
        }
        if (!map) {
          resolveStill(false);
          return;
        }
        const still = () =>
          map.loaded() && map.areTilesLoaded() && !map.isMoving();
        if (!still()) {
          resolveStill(false);
          return;
        }
        let checks = 0;
        const timer = setInterval(() => {
          checks += 1;
          if (!still()) {
            clearInterval(timer);
            resolveStill(false);
          } else if (checks === 3) {
            clearInterval(timer);
            resolveStill(true);
          }
        }, 300);
      }),
    mapPath,
    { timeout: 30_000, polling: 250 }
  );
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Argos screenshot with animations off, the mouse parked in the bottom-left
 * corner and `VOLATILE_UI` hidden on top of any `hide` passed in.
 *
 * @param {Page} page
 * @param {string} name
 * @param {ArgosScreenshotOptions & { keepCursor?: boolean }} [options]
 */
export async function screenshot(page, name, options = {}) {
  const { keepCursor = false, hide = [], ...rest } = options;
  if (!keepCursor) {
    const viewport = page.viewportSize();
    await page.mouse.move(0, (viewport?.height ?? 1) - 1);
  }
  await argosScreenshot(page, name, {
    animations: 'disabled',
    hide: [...VOLATILE_UI, ...hide],
    ...rest,
  });
}
