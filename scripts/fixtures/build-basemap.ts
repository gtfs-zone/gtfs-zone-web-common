#!/usr/bin/env tsx
/**
 * Builds the local basemap fixture: a Protomaps vector extract around the
 * MBTA demo feed, light and dark styles, and the glyphs and sprites they use.
 *
 * Run with: pnpm fixtures:basemap
 *
 * Needs the `pmtiles` CLI (go-pmtiles) on PATH. Writes fixtures/basemap/.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { BASEMAP_HOST } from '../../src/testing/basemap-fixture.js';
import { FIXTURES_DIR } from './checksums';

// Daily planet build the extract is cut from
const BUILD_URL = 'https://build.protomaps.com/20261126.pmtiles';
// Covers every stop in the MBTA demo feed with a margin
const BBOX = '-71.9,41.55,-70.55,42.85';
const MAX_ZOOM = 10;

const ASSETS_URL =
  'https://raw.githubusercontent.com/protomaps/basemaps-assets/main';
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
// Basic Latin, Latin-1, Latin Extended, general punctuation
const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];
const FLAVORS = ['light', 'dark'] as const;

const OUT_DIR = join(FIXTURES_DIR, 'basemap');

async function download(url: string, path: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url}: ${res.status} ${res.statusText}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  console.log(`[basemap] ${path}`);
}

function style(flavor: (typeof FLAVORS)[number]): object {
  return {
    version: 8,
    glyphs: `${BASEMAP_HOST}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${BASEMAP_HOST}/sprites/${flavor}`,
    sources: {
      protomaps: {
        type: 'vector',
        tiles: [`${BASEMAP_HOST}/tiles/{z}/{x}/{y}.mvt`],
        maxzoom: MAX_ZOOM,
        attribution: '© OpenStreetMap contributors, Protomaps',
      },
    },
    layers: layers('protomaps', namedFlavor(flavor), { lang: 'en' }),
  };
}

async function main(): Promise<void> {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  execFileSync(
    'pmtiles',
    [
      'extract',
      BUILD_URL,
      join(OUT_DIR, 'boston.pmtiles'),
      `--bbox=${BBOX}`,
      `--maxzoom=${MAX_ZOOM}`,
    ],
    { stdio: 'inherit' }
  );

  for (const flavor of FLAVORS) {
    writeFileSync(
      join(OUT_DIR, `style-${flavor}.json`),
      JSON.stringify(style(flavor), null, 2) + '\n'
    );
    for (const suffix of ['', '@2x']) {
      for (const ext of ['json', 'png']) {
        const name = `${flavor}${suffix}.${ext}`;
        await download(
          `${ASSETS_URL}/sprites/v4/${name}`,
          join(OUT_DIR, 'sprites', name)
        );
      }
    }
  }

  for (const font of FONTS) {
    for (const range of GLYPH_RANGES) {
      await download(
        `${ASSETS_URL}/fonts/${encodeURIComponent(font)}/${range}.pbf`,
        join(OUT_DIR, 'fonts', font, `${range}.pbf`)
      );
    }
  }
}

main().catch((error) => {
  console.error('[basemap] Failed:', error);
  process.exit(1);
});
