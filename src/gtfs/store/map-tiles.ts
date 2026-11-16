/**
 * Vector tiles of a feed's route lines and stops, cut in the store worker.
 *
 * Route lines go into a geojson-vt index fed one feature at a time from
 * the store, so no whole-feed GeoJSON is ever held. Stops need no clipping,
 * so they skip geojson-vt (which keeps a copy of every point per cached
 * zoom): they are sorted once by a z16 Morton code, and any tile up to z16
 * is then a contiguous range of that order. Tiles go out as MVT bytes; the
 * main thread hands them to MapLibre through `map/store-tiles.ts`.
 */

import {
  GeoJSONVT,
  type GeoJSONVTFeature,
  type GeoJSONVTTile,
} from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import type { FeedStore } from './feed-store';
import { routeGeometries } from './feed-queries';

export type TileLayer = 'routes' | 'stops';

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

/** How the main thread draws a route: its resolved colors and paint order. */
export interface RouteTileStyle {
  color: string;
  colorDark: string;
  sortKey: number;
}

export interface RouteTilesIndexed {
  /** Bounds of each drawn route's lines. */
  bounds: Record<string, BBox>;
  /** Bounds of every drawn line, or null when none is drawn. */
  bbox: BBox | null;
  lines: number;
}

export interface StopTilesIndexed {
  /** Stops drawn. */
  stops: number;
  /** Rows with a blank stop_id. */
  missingId: number;
  /** Rows with no coordinates of their own or on any ancestor. */
  missingCoords: number;
  /** Bounds of every drawn stop, or null when none is drawn. */
  bbox: BBox | null;
}

const EXTENT = 4096;
/** Highest zoom cut; MapLibre overzooms past it. */
export const ROUTE_TILES_MAXZOOM = 14;
export const STOP_TILES_MAXZOOM = 16;
/** geojson-vt simplification per zoom, in tile units. */
const TILE_TOLERANCE = 0.5;
/** Tile edge buffer, in tile units, so line caps and circles are not cut. */
const TILE_BUFFER = 64;
/** Shapes are simplified to this before indexing (about 1m). */
const SHAPE_SIMPLIFY_DEG = 1e-5;

/**
 * An array-like that makes feature `i` only when geojson-vt asks for it, so
 * the whole collection never exists at once.
 */
function lazyFeatures(
  length: number,
  make: (i: number) => GeoJSON.Feature | null
): GeoJSON.Feature[] {
  return new Proxy([] as GeoJSON.Feature[], {
    get(target, prop, receiver) {
      if (prop === 'length') {
        return length;
      }
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        return make(Number(prop));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** Douglas-Peucker over flat [lon, lat, ...] points of one line. */
function simplifyCoords(coords: Float64Array, tolerance: number): Float64Array {
  const n = coords.length / 2;
  if (n < 3) {
    return coords;
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = coords[a * 2];
    const ay = coords[a * 2 + 1];
    const dx = coords[b * 2] - ax;
    const dy = coords[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = coords[i * 2] - ax;
      const py = coords[i * 2 + 1] - ay;
      const t =
        len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 > max) {
        max = d2;
        idx = i;
      }
    }
    if (max > tol2) {
      keep[idx] = 1;
      stack.push(a, idx, idx, b);
    }
  }
  let kept = 0;
  for (let i = 0; i < n; i++) {
    kept += keep[i];
  }
  const out = new Float64Array(kept * 2);
  for (let i = 0, o = 0; i < n; i++) {
    if (keep[i]) {
      out[o++] = coords[i * 2];
      out[o++] = coords[i * 2 + 1];
    }
  }
  return out;
}

/** Grow `box` (or start one) to cover the flat points in `coords`. */
function extend(box: BBox | null, coords: ArrayLike<number>): BBox | null {
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i];
    const y = coords[i + 1];
    if (!box) {
      box = [x, y, x, y];
      continue;
    }
    if (x < box[0]) {
      box[0] = x;
    }
    if (y < box[1]) {
      box[1] = y;
    }
    if (x > box[2]) {
      box[2] = x;
    }
    if (y > box[3]) {
      box[3] = y;
    }
  }
  return box;
}

function union(a: BBox | null, b: BBox): BBox {
  return a
    ? [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[2], b[2]),
        Math.max(a[3], b[3]),
      ]
    : [...b];
}

/** Zoom of the Morton grid: the stop tiles' max zoom. */
const GRID_Z = STOP_TILES_MAXZOOM;
const GRID = 1 << GRID_Z;
const MAX_LAT = 85.0511287798;

/** Web Mercator world coordinates in [0, 1). */
function worldX(lon: number): number {
  return (lon + 180) / 360;
}

function worldY(lat: number): number {
  const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

/** Spread the low 16 bits of `v` to the even bits. */
function spread(v: number): number {
  v &= 0xffff;
  v = (v | (v << 8)) & 0x00ff00ff;
  v = (v | (v << 4)) & 0x0f0f0f0f;
  v = (v | (v << 2)) & 0x33333333;
  v = (v | (v << 1)) & 0x55555555;
  return v >>> 0;
}

/** Morton code of grid cell (x, y): x on the even bits, y on the odd. */
function morton(x: number, y: number): number {
  return (spread(x) | (spread(y) << 1)) >>> 0;
}

/** First index in sorted `codes` whose value is >= `v`. */
function lowerBound(codes: Float64Array, v: number): number {
  let lo = 0;
  let hi = codes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (codes[mid] < v) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Stops in Morton order, with what a tile feature needs. */
interface StopGrid {
  codes: Float64Array;
  x: Float64Array;
  y: Float64Array;
  ids: string[];
  types: Uint8Array;
  parents: string[];
}

export class MapTiles {
  private indexes: Partial<Record<'routes', GeoJSONVT>> = {};
  private stopGrid: StopGrid | null = null;

  /**
   * Index each styled route as one MultiLineString of its simplified lines.
   * Routes without a style are not drawn.
   */
  buildRoutes(
    store: FeedStore,
    styles: Record<string, RouteTileStyle>
  ): RouteTilesIndexed {
    const t0 = performance.now();
    // Free the old index first so a re-index never holds two.
    delete this.indexes.routes;
    const geometries = routeGeometries(store, (c) =>
      simplifyCoords(c, SHAPE_SIMPLIFY_DEG)
    ).filter((g) => styles[g.routeId]);
    const bounds: Record<string, BBox> = {};
    let bbox: BBox | null = null;
    let lines = 0;
    let points = 0;
    for (const g of geometries) {
      const b = extend(null, g.coords);
      if (b) {
        bounds[g.routeId] = b;
        bbox = union(bbox, b);
      }
      lines += g.lineStarts.length;
      points += g.coords.length / 2;
    }
    const features = lazyFeatures(geometries.length, (i) => {
      const g = geometries[i];
      const total = g.coords.length / 2;
      const coordinates: [number, number][][] = [];
      for (let l = 0; l < g.lineStarts.length; l++) {
        const from = g.lineStarts[l];
        const to = l + 1 < g.lineStarts.length ? g.lineStarts[l + 1] : total;
        const line: [number, number][] = [];
        for (let p = from; p < to; p++) {
          line.push([g.coords[p * 2], g.coords[p * 2 + 1]]);
        }
        coordinates.push(line);
      }
      const style = styles[g.routeId];
      return {
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates },
        properties: {
          route_id: g.routeId,
          color: style.color,
          colorDark: style.colorDark,
          sortKey: style.sortKey,
        },
      };
    });
    this.indexes.routes = new GeoJSONVT(
      { type: 'FeatureCollection', features },
      {
        maxZoom: ROUTE_TILES_MAXZOOM,
        tolerance: TILE_TOLERANCE,
        buffer: TILE_BUFFER,
        extent: EXTENT,
      }
    );
    console.log(
      `[MapTiles] routes: ${geometries.length} routes, ${lines} lines, ${points} points indexed in ${Math.round(performance.now() - t0)}ms`
    );
    return { bounds, bbox, lines };
  }

  /**
   * Index every stop with a position: its own coordinates, else the nearest
   * ancestor's along `parent_station`.
   */
  buildStops(store: FeedStore): StopTilesIndexed {
    const t0 = performance.now();
    this.stopGrid = null;
    const ids: string[] = [];
    const types: number[] = [];
    const parents: string[] = [];
    const own = new Map<string, [number, number]>();
    const parentOf = new Map<string, string>();
    let missingId = 0;
    if (store.hasTable('stops')) {
      store.scan(
        'stops',
        ['stop_id', 'stop_lon', 'stop_lat', 'location_type', 'parent_station'],
        ([id, lon, lat, type, parent]) => {
          if (!id) {
            missingId++;
            return;
          }
          const x = parseFloat(lon);
          const y = parseFloat(lat);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            own.set(id, [x, y]);
          } else if (parent) {
            parentOf.set(id, parent);
          }
          ids.push(id);
          types.push(parseInt(type || '0', 10) || 0);
          parents.push(parent);
        }
      );
    }
    const position = (id: string): [number, number] | null => {
      const seen = new Set<string>();
      let current: string | undefined = id;
      while (current && !seen.has(current)) {
        seen.add(current);
        const p = own.get(current);
        if (p) {
          return p;
        }
        current = parentOf.get(current);
      }
      return null;
    };

    const drawn: number[] = [];
    const wx: number[] = [];
    const wy: number[] = [];
    let bbox: BBox | null = null;
    for (let i = 0; i < ids.length; i++) {
      const p = position(ids[i]);
      if (!p) {
        continue;
      }
      bbox = extend(bbox, p);
      drawn.push(i);
      wx.push(worldX(p[0]));
      wy.push(worldY(p[1]));
    }
    const cell = (w: number) => Math.min(GRID - 1, Math.floor(w * GRID));
    const codeOf = drawn.map((_, k) => morton(cell(wx[k]), cell(wy[k])));
    const order = drawn.map((_, k) => k).sort((a, b) => codeOf[a] - codeOf[b]);
    const n = order.length;
    const grid: StopGrid = {
      codes: new Float64Array(n),
      x: new Float64Array(n),
      y: new Float64Array(n),
      ids: new Array<string>(n),
      types: new Uint8Array(n),
      parents: new Array<string>(n),
    };
    order.forEach((k, j) => {
      const i = drawn[k];
      grid.codes[j] = codeOf[k];
      grid.x[j] = wx[k];
      grid.y[j] = wy[k];
      grid.ids[j] = ids[i];
      grid.types[j] = types[i];
      grid.parents[j] = parents[i];
    });
    this.stopGrid = grid;
    const missingCoords = ids.length - n;
    console.log(
      `[MapTiles] stops: ${n} indexed in ${Math.round(performance.now() - t0)}ms`
    );
    if (missingCoords) {
      console.warn(`[MapTiles] ${missingCoords} stops have no position`);
    }
    return { stops: n, missingId, missingCoords, bbox };
  }

  /**
   * The stops of tile (z, x, y) and of its buffer: the 3x3 block of tiles
   * around it, each a contiguous Morton range, filtered to the buffered box.
   */
  private stopFeatures(z: number, x: number, y: number): GeoJSONVTFeature[] {
    const g = this.stopGrid;
    if (!g || z > GRID_Z) {
      return [];
    }
    const span = 2 ** (2 * (GRID_Z - z));
    const tiles = 2 ** z;
    const pad = TILE_BUFFER / EXTENT;
    const out: GeoJSONVTFeature[] = [];
    for (let ty = y - 1; ty <= y + 1; ty++) {
      for (let tx = x - 1; tx <= x + 1; tx++) {
        if (tx < 0 || ty < 0 || tx >= tiles || ty >= tiles) {
          continue;
        }
        const from = morton(tx, ty) * span;
        const end = lowerBound(g.codes, from + span);
        for (let i = lowerBound(g.codes, from); i < end; i++) {
          const fx = g.x[i] * tiles - x;
          const fy = g.y[i] * tiles - y;
          if (fx < -pad || fy < -pad || fx > 1 + pad || fy > 1 + pad) {
            continue;
          }
          out.push({
            type: 1,
            geometry: [[Math.round(fx * EXTENT), Math.round(fy * EXTENT)]],
            tags: {
              stop_id: g.ids[i],
              location_type: g.types[i],
              parent_station: g.parents[i],
            },
          });
        }
      }
    }
    return out;
  }

  /** One tile as MVT bytes (layer named after `layer`), or null when empty. */
  tile(layer: TileLayer, z: number, x: number, y: number): Uint8Array | null {
    const features =
      layer === 'stops'
        ? this.stopFeatures(z, x, y)
        : (this.indexes.routes?.getTile(z, x, y)?.features ?? []);
    if (features.length === 0) {
      return null;
    }
    // vt-pbf reads only `features` from a geojson-vt tile.
    const tile = { features } as unknown as GeoJSONVTTile;
    return fromGeojsonVt({ [layer]: tile }, { version: 2, extent: EXTENT });
  }
}
