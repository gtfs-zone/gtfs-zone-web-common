/**
 * View-level reads over a `FeedStore`: each one answers what a page or map
 * layer needs in a single call, so a worker round trip is paid once per
 * view rather than once per row.
 */

import type { FeedStore, Row, TripStop } from './feed-store';
import { readCalendar, servicesOn } from './service-calendar';

/** Small per-feed aggregates the main thread keeps for synchronous reads. */
export interface FeedSummary {
  counts: Record<string, number>;
  /** Distinct shape_ids (`counts.shapes` counts points). */
  shapeCount: number;
  tripsPerRoute: Record<string, number>;
  tripsPerStop: Record<string, number>;
  /** Routes serving each stop, by stop_times -> trips. */
  routesPerStop: Record<string, string[]>;
}

/** Every trip's route, from one pass over trips.txt. */
function tripRoutes(store: FeedStore): Map<string, string> {
  const out = new Map<string, string>();
  store.scan('trips', ['trip_id', 'route_id'], ([trip, route]) => {
    out.set(trip, route);
  });
  return out;
}

export function feedSummary(store: FeedStore): FeedSummary {
  const tripsPerRoute: Record<string, number> = {};
  store.scan('trips', ['route_id'], ([route]) => {
    tripsPerRoute[route] = (tripsPerRoute[route] ?? 0) + 1;
  });

  const tripsPerStop: Record<string, number> = {};
  const routeSets = new Map<string, Set<string>>();
  const routeOf = tripRoutes(store);
  store.forEachStopList((stops, tripIds) => {
    const routes = new Set<string>();
    for (const t of tripIds) {
      const r = routeOf.get(t);
      if (r !== undefined) {
        routes.add(r);
      }
    }
    for (const stop of new Set(stops.map((s) => s.stop_id))) {
      tripsPerStop[stop] = (tripsPerStop[stop] ?? 0) + tripIds.length;
      let set = routeSets.get(stop);
      if (!set) {
        routeSets.set(stop, (set = new Set()));
      }
      for (const r of routes) {
        set.add(r);
      }
    }
  });
  const routesPerStop: Record<string, string[]> = {};
  for (const [stop, set] of routeSets) {
    routesPerStop[stop] = [...set];
  }
  return {
    counts: store.counts(),
    shapeCount: store.shapeIds().length,
    tripsPerRoute,
    tripsPerStop,
    routesPerStop,
  };
}

/** One route's lines as flat [lon, lat, ...] points, cut at `lineStarts`. */
export interface RouteGeometry {
  routeId: string;
  coords: Float64Array;
  /** Point index where each line starts. */
  lineStarts: Uint32Array;
}

/** Whether a shape has enough points to draw (2+), from its flat coords. */
export function usableShape(coords: Float64Array): boolean {
  return coords.length >= 4;
}

/** [lon, lat] of every stop with numeric coordinates, by stop_id. */
export function stopPositions(store: FeedStore): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  store.scan('stops', ['stop_id', 'stop_lon', 'stop_lat'], ([id, lon, lat]) => {
    const x = parseFloat(lon);
    const y = parseFloat(lat);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.set(id, [x, y]);
    }
  });
  return out;
}

/**
 * A straight line through a stop list as flat [lon, lat, ...] points,
 * skipping stops without a position. Null when under two points remain.
 */
export function stopListLine(
  stopIds: Iterable<string>,
  positions: Map<string, [number, number]>
): Float64Array | null {
  const pts: number[] = [];
  for (const id of stopIds) {
    const p = positions.get(id);
    if (p) {
      pts.push(p[0], p[1]);
    }
  }
  return pts.length >= 4 ? Float64Array.from(pts) : null;
}

/**
 * The distinct lines of every route: each shape once, and for trips with no
 * usable shape (missing or under two points) a straight line through their
 * stops, once per distinct stop list. Stops without coordinates are skipped.
 * `simplify`, when given, is applied to each shape as it is read, so only
 * the simplified points are kept.
 */
export function routeGeometries(
  store: FeedStore,
  simplify?: (coords: Float64Array) => Float64Array
): RouteGeometry[] {
  const stopPos = stopPositions(store);

  type Acc = { shapes: Set<string>; lists: Set<string>; lines: Float64Array[] };
  const byRoute = new Map<string, Acc>();
  const shapeCache = new Map<string, Float64Array>();
  const listCache = new Map<string, Float64Array | null>();
  const seenLine = new Map<string, Set<string>>();

  store.scan(
    'trips',
    ['trip_id', 'route_id', 'shape_id'],
    ([tripId, routeId, shapeId]) => {
      let acc = byRoute.get(routeId);
      if (!acc) {
        byRoute.set(
          routeId,
          (acc = { shapes: new Set(), lists: new Set(), lines: [] })
        );
        seenLine.set(routeId, new Set());
      }
      if (shapeId) {
        if (acc.shapes.has(shapeId)) {
          return;
        }
        let coords = shapeCache.get(shapeId);
        if (!coords) {
          coords = store.shapeCoords(shapeId);
          if (simplify) {
            coords = simplify(coords);
          }
          shapeCache.set(shapeId, coords);
        }
        if (usableShape(coords)) {
          acc.shapes.add(shapeId);
          acc.lines.push(coords);
          return;
        }
      }
      const key = store.stopListKey(tripId);
      if (key === null || acc.lists.has(key)) {
        return;
      }
      acc.lists.add(key);
      let line = listCache.get(key);
      if (line === undefined) {
        line = stopListLine(
          store.tripStops(tripId).map((s) => s.stop_id),
          stopPos
        );
        listCache.set(key, line);
      }
      if (!line) {
        return;
      }
      // Two stop lists can draw the same line once stops without coordinates drop out.
      const lineKey = Array.from(line).join(',');
      const seen = seenLine.get(routeId)!;
      if (!seen.has(lineKey)) {
        seen.add(lineKey);
        acc.lines.push(line);
      }
    }
  );

  const out: RouteGeometry[] = [];
  for (const [routeId, acc] of byRoute) {
    let total = 0;
    for (const l of acc.lines) {
      total += l.length;
    }
    const coords = new Float64Array(total);
    const lineStarts = new Uint32Array(acc.lines.length);
    let off = 0;
    acc.lines.forEach((l, i) => {
      lineStarts[i] = off / 2;
      coords.set(l, off);
      off += l.length;
    });
    out.push({ routeId, coords, lineStarts });
  }
  return out;
}

/** Scheduled trips by id, with their stop_times when the store has times. */
export interface TripsInfo {
  trips: Record<string, Row>;
  stopTimes: Record<string, Row[]>;
}

export function tripsInfo(
  store: FeedStore,
  tripIds: string[],
  stopTimes = true
): TripsInfo {
  const out: TripsInfo = { trips: {}, stopTimes: {} };
  const withTimes = stopTimes && store.stopTimesMode === 'full';
  for (const id of new Set(tripIds)) {
    const [hit] = store.find('trips', 'trip_id', id);
    if (hit) {
      out.trips[id] = hit.row;
    }
    if (withTimes) {
      out.stopTimes[id] = store.stopTimesForTrip(id);
    }
  }
  return out;
}

/** A route's trips with their stop lists, shared between trips of one pattern. */
export interface RouteTrips {
  trips: Row[];
  stopLists: TripStop[][];
  /** Index into `stopLists` per trip, or -1 for a trip with no stop_times. */
  tripList: number[];
}

export function routeTrips(store: FeedStore, routeId: string): RouteTrips {
  const out: RouteTrips = { trips: [], stopLists: [], tripList: [] };
  const listIndex = new Map<string, number>();
  for (const { row } of store.find('trips', 'route_id', routeId)) {
    out.trips.push(row);
    const key = store.stopListKey(row.trip_id ?? '');
    if (key === null) {
      out.tripList.push(-1);
      continue;
    }
    let i = listIndex.get(key);
    if (i === undefined) {
      i = out.stopLists.length;
      out.stopLists.push(store.tripStops(row.trip_id));
      listIndex.set(key, i);
    }
    out.tripList.push(i);
  }
  return out;
}

/** A trip running on a service date, with its first departure. */
export interface DayTrip {
  trip_id: string;
  /** First departure (else arrival) as `HH:MM:SS`; empty without times. */
  departure: string;
}

function clockText(seconds: number): string {
  const s = Math.round(seconds);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/** A route's trips whose service runs on a `YYYYMMDD` date, by first departure. */
export function routeDayTrips(
  store: FeedStore,
  routeId: string,
  date: string
): DayTrip[] {
  const services = servicesOn(store, readCalendar(store), date);
  const timed = store.stopTimesMode === 'full';
  const span = new Float64Array(4);
  const out: { trip_id: string; departure: string; at: number }[] = [];
  for (const { row } of store.find('trips', 'route_id', routeId)) {
    if (!services.has(row.service_id ?? '')) {
      continue;
    }
    const tripId = row.trip_id ?? '';
    let at = NaN;
    if (timed && store.tripSpan(tripId, span) > 0) {
      at = Number.isFinite(span[1]) ? span[1] : span[0];
    }
    out.push({
      trip_id: tripId,
      departure: Number.isFinite(at) ? clockText(at) : '',
      at: Number.isFinite(at) ? at : Infinity,
    });
  }
  return out
    .sort((a, b) => a.at - b.at)
    .map(({ trip_id, departure }) => ({ trip_id, departure }));
}

/** Every trip's stop_times. For small feeds kept whole on the main thread. */
export function allStopTimes(store: FeedStore): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const id of store.tripsWithStopTimes()) {
    out[id] = store.stopTimesForTrip(id);
  }
  return out;
}

/** Every shape's [lon, lat, ...]. For small feeds kept whole on the main thread. */
export function allShapes(store: FeedStore): Record<string, Float64Array> {
  const out: Record<string, Float64Array> = {};
  for (const id of store.shapeIds()) {
    out[id] = store.shapeCoords(id);
  }
  return out;
}
