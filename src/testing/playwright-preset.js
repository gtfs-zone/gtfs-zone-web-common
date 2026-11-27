// @ts-check
/**
 * Shared Playwright config for the apps' screenshot and UI specs: light, dark
 * and mobile projects, fixed viewport, scale, locale and time zone, the built
 * app on `vite preview`, and the Argos reporter (uploads only on CI).
 *
 * In an app's `playwright.config.ts`:
 *
 *   import { playwrightPreset } from 'gtfs-zone-web-common/testing/playwright-preset.js';
 *   export default playwrightPreset({ port: 4173 });
 *
 * Plain JS with JSDoc types: Playwright and Node do not transpile TypeScript
 * under node_modules, which is where a consumer's copy of this file lives.
 */

import { defineConfig } from '@playwright/test';

/** @typedef {import('@playwright/test').PlaywrightTestConfig} PlaywrightTestConfig */

/**
 * @typedef {object} PlaywrightPresetOptions
 * @property {number} [port] Port `vite preview` listens on.
 * @property {string} [testDir] Directory holding the specs, relative to the config file.
 * @property {string} [webServerCommand] Builds and serves the app; defaults to `pnpm run build` then `vite preview`.
 * @property {PlaywrightTestConfig} [overrides] Replaces preset keys; `use` is merged key by key.
 */

const DESKTOP = { width: 1600, height: 1000 };
const MOBILE = { width: 390, height: 844 };

/**
 * @param {PlaywrightPresetOptions} [options]
 * @returns {PlaywrightTestConfig}
 */
export function playwrightPreset({
  port = 4173,
  testDir = 'e2e',
  webServerCommand = `pnpm run build && pnpm exec vite preview --port ${port} --strictPort`,
  overrides = {},
} = {}) {
  const baseURL = `http://localhost:${port}`;
  const ci = Boolean(process.env.CI);
  /** @type {PlaywrightTestConfig} */
  const base = {
    testDir,
    outputDir: 'test-results',
    fullyParallel: true,
    forbidOnly: ci,
    retries: ci ? 1 : 0,
    timeout: 90_000,
    reporter: [
      [ci ? 'github' : 'list'],
      ['@argos-ci/playwright/reporter', { uploadToArgos: ci }],
    ],
    use: {
      baseURL,
      viewport: DESKTOP,
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      contextOptions: { reducedMotion: 'reduce' },
      screenshot: 'only-on-failure',
      trace: ci ? 'on-first-retry' : 'off',
    },
    webServer: {
      command: webServerCommand,
      url: baseURL,
      reuseExistingServer: !ci,
      timeout: 180_000,
    },
    projects: [
      {
        name: 'light',
        grepInvert: /@mobile/,
        use: { colorScheme: 'light' },
      },
      {
        name: 'dark',
        grepInvert: /@mobile/,
        use: { colorScheme: 'dark' },
      },
      {
        name: 'mobile',
        grep: /@mobile/,
        use: {
          colorScheme: 'light',
          viewport: MOBILE,
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        },
      },
    ],
  };
  return defineConfig({
    ...base,
    ...overrides,
    use: { ...base.use, ...overrides.use },
  });
}
