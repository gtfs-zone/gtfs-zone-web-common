// @ts-check
/**
 * Shared Vitest config: node environment, tests under tests/ or next to the
 * source, and gtfs-zone-web-common inlined so its raw TypeScript goes through
 * Vite instead of being loaded by Node from node_modules.
 *
 * In an app's `vitest.config.ts`, on top of its Vite config (for the aliases):
 *
 *   import { mergeConfig } from 'vitest/config';
 *   import viteConfig from './vite.config.js';
 *   import { vitestPreset } from 'gtfs-zone-web-common/testing/vitest-preset.js';
 *   export default mergeConfig(viteConfig, vitestPreset());
 *
 * Plain JS with JSDoc types, for the reason given in `playwright-preset.js`.
 */

import { defineConfig, mergeConfig } from 'vitest/config';

/** @typedef {import('vitest/config').ViteUserConfig} ViteUserConfig */

/**
 * @param {ViteUserConfig} [overrides] merged over the preset
 * @returns {ViteUserConfig}
 */
export function vitestPreset(overrides = {}) {
  const base = defineConfig({
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
      restoreMocks: true,
      server: { deps: { inline: [/gtfs-zone-web-common/] } },
    },
  });
  return mergeConfig(base, overrides);
}
