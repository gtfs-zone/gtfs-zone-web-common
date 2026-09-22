/**
 * Where geometry-car publishes the source catalog and the curated examples.
 * A public bucket refreshed daily, sending `access-control-allow-origin: *`,
 * so every app reads it directly, in dev as well as in the built site.
 */
export const DATA_ORIGIN = 'https://data.gtfs.zone';
