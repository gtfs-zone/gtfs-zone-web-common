// @ts-check
/** Origin the fixture basemap style points at; Playwright serves it locally. */
export const BASEMAP_HOST = 'https://basemap.fixture.test';

/**
 * Global a Playwright run sets to a MapLibre style; `getBasemapStyle` then
 * returns it for every basemap id, so the page loads no remote tiles.
 */
export const BASEMAP_OVERRIDE_GLOBAL = '__GTFS_ZONE_BASEMAP_OVERRIDE__';
