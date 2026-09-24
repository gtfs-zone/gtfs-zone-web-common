/**
 * Where geometry-car publishes the source catalog and the curated examples.
 * A public bucket refreshed daily. Its CORS rule allows each app's origin and
 * the localhost dev ports (geometry-car's `bucket_cors.py`), so every app reads
 * it directly, in dev as well as in the built site.
 */
export const DATA_ORIGIN = 'https://data.gtfs.zone';
