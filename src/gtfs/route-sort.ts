/**
 * Paint-order ranking for route lines.
 *
 * All routes live in one GeoJSON source, so which line covers which is decided
 * entirely by `line-sort-key` (higher = painted later = on top). The key blends
 * two things: the route's mode, which always wins, and its trip count, which
 * breaks ties within a mode so a trunk service sits above an hourly one.
 *
 * Pure; modes come from gtfs-zone-vocab.
 */

import { routeTypeFamily } from 'gtfs-zone-vocab/route-types';

/** Rank for an unknown or unparseable route_type, below every real mode. */
const RANK_UNKNOWN = 10;

/** Route type family (gtfs-zone-vocab) to paint rank. Higher paints on top. */
const RANK_BY_FAMILY: Record<string, number> = {
  metro: 90,
  tram: 80,
  cable: 75,
  funicular: 75,
  rail: 70,
  ferry: 60,
  trolleybus: 50,
  coach: 40,
  bus: 40,
  taxi: 40,
  air: 20,
  misc: 20,
};

/**
 * Map a GTFS route_type to its paint rank. Accepts `unknown` because
 * the editor's `Routes` is a loose record, route_type may arrive as a
 * string straight from the CSV.
 */
export function routeTypeRank(rawRouteType: unknown): number {
  const routeType = Number(rawRouteType);
  if (!Number.isFinite(routeType)) {
    console.warn(
      `[routeSort] Non-numeric route_type ${JSON.stringify(rawRouteType)}, ranking as unknown`
    );
    return RANK_UNKNOWN;
  }

  const family = routeTypeFamily(routeType);
  if (family !== undefined) {
    const rank = RANK_BY_FAMILY[family];
    if (rank === undefined) {
      throw new Error(
        `[routeSort] No paint rank for route type family ${family}`
      );
    }
    return rank;
  }

  console.warn(
    `[routeSort] Unrecognized route_type ${routeType}, ranking as unknown`
  );
  return RANK_UNKNOWN;
}

/**
 * The `line-sort-key` for a route: mode rank in the thousands place, log-scaled
 * trip count in the low three digits. Log scaling keeps a 5000-trip subway from
 * swamping a 400-trip one, the ordering only has to be stable and sensible,
 * not proportional.
 */
export function routeSortKey(rawRouteType: unknown, tripCount: number): number {
  const frequency = Math.min(
    999,
    Math.round(100 * Math.log10(1 + Math.max(0, tripCount)))
  );
  return routeTypeRank(rawRouteType) * 1000 + frequency;
}
