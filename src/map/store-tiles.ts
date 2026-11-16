/**
 * MapLibre reads the routes and stops vector tiles through this protocol;
 * each request is forwarded to the feed's store worker (`storeTile`).
 *
 * URLs carry a generation, bumped for every feed, so a new feed never shows
 * a tile MapLibre cached from the previous one.
 */

import { addProtocol } from 'maplibre-gl';
import type {
  Map as MapLibreMap,
  MapSourceDataEvent,
  VectorTileSource,
} from 'maplibre-gl';
import type { GTFSScheduled } from '../gtfs/scheduled';
import type { TileLayer } from '../gtfs/store/map-tiles';

export {
  ROUTE_TILES_MAXZOOM,
  STOP_TILES_MAXZOOM,
} from '../gtfs/store/map-tiles';

const PROTOCOL = 'gtfszone-store-tiles';
const URL_PATTERN = new RegExp(
  `^${PROTOCOL}://(routes|stops|empty)/\\d+/(\\d+)/(\\d+)/(\\d+)$`
);

/** Source layer names inside the tiles. */
export const ROUTES_SOURCE_LAYER: TileLayer = 'routes';
export const STOPS_SOURCE_LAYER: TileLayer = 'stops';

let generation = 0;
let registered = false;
let tileFeed: GTFSScheduled | null = null;

/**
 * Serve tiles from `feed` (null: every tile is empty) and return a URL
 * generation for it; pass that to `tileUrl`.
 */
export function useTileFeed(feed: GTFSScheduled | null): number {
  tileFeed = feed;
  return ++generation;
}

/** Tile URL template for `layer` at generation `gen`; null layer for no tiles. */
export function tileUrl(layer: TileLayer | null, gen: number): string {
  register();
  return `${PROTOCOL}://${layer ?? 'empty'}/${gen}/{z}/{x}/{y}`;
}

/** Tile URL waiting for its source to go idle, by source id. */
const pendingUrls = new Map<string, string>();

/**
 * Point a vector source at `url` once none of its tiles is loading.
 *
 * MapLibre cannot switch URLs under a loading tile: the tile finishes from
 * the old URL and is then only re-parsed, never fetched from the new one, so
 * the switch waits for the source to settle. The newest URL wins.
 */
export function setSourceTiles(
  map: MapLibreMap,
  sourceId: string,
  url: string
): void {
  const waiting = pendingUrls.has(sourceId);
  pendingUrls.set(sourceId, url);
  if (waiting) {
    return;
  }
  const apply = (): boolean => {
    const source = map.getSource(sourceId) as VectorTileSource | undefined;
    if (!source) {
      pendingUrls.delete(sourceId);
      return true;
    }
    if (!map.isSourceLoaded(sourceId)) {
      return false;
    }
    source.setTiles([pendingUrls.get(sourceId)!]);
    pendingUrls.delete(sourceId);
    return true;
  };
  if (apply()) {
    return;
  }
  console.log(`[StoreTiles] ${sourceId}: waiting for tiles in flight`);
  const onEvent = (e?: MapSourceDataEvent): void => {
    if (e && e.sourceId !== sourceId) {
      return;
    }
    if (apply()) {
      map.off('sourcedata', onEvent);
      map.off('idle', onIdle);
    }
  };
  const onIdle = (): void => onEvent();
  map.on('sourcedata', onEvent);
  map.on('idle', onIdle);
}

function register(): void {
  if (registered) {
    return;
  }
  registered = true;
  addProtocol(PROTOCOL, async (params) => {
    const match = URL_PATTERN.exec(params.url);
    if (!match) {
      throw new Error(`[StoreTiles] bad tile URL ${params.url}`);
    }
    const layer = match[1];
    const feed = tileFeed;
    // A released feed (a reload in progress) draws nothing.
    if (layer === 'empty' || !feed || feed.store.isReleased) {
      return { data: new ArrayBuffer(0) };
    }
    const bytes = await feed.store.call(
      'storeTile',
      layer as TileLayer,
      Number(match[2]),
      Number(match[3]),
      Number(match[4])
    );
    if (!bytes) {
      return { data: new ArrayBuffer(0) };
    }
    return {
      data: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer,
    };
  });
}
