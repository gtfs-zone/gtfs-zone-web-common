import type { KnipConfig } from 'knip';

// Every module is its own entry point (no barrels), so unused exports are left
// to scripts/check-exports.ts, which reads the sibling apps' imports.
const config: KnipConfig = {
  entry: ['src/**/*.{ts,js}', 'scripts/**/*.ts', 'tests/**/*.ts'],
  project: ['src/**/*.{ts,js}', 'scripts/**/*.ts', 'tests/**/*.ts'],
  include: ['files', 'dependencies', 'unlisted', 'unresolved', 'binaries'],
  ignoreBinaries: [
    'cz', // commitizen CLI
    'pmtiles', // go-pmtiles CLI, for pnpm fixtures:basemap
  ],
};

export default config;
