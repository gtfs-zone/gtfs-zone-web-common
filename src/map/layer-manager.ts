/**
 * The realtime map's layer engine: the `routes`, `stops` and `vehicles`
 * sources (routes and stops as vector tiles cut in the feed's store worker,
 * see `store-tiles.ts`), what fills them from a `GTFSScheduled` and a
 * vehicle list, the
 * route and stop spotlight, the feature-state sync with its `sourcedata`
 * retry, and the single map-level hit test.
 *
 * Built on `layer-specs.ts` (filters, fade bands, spotlight expressions) and
 * `stop-layer-style.ts` (how one stop circle looks). The editor's manager is
 * its own: it adds pathways, levels, flex zones, transfers and the editing
 * affordances on top of a different data model.
 *
 * `V` is the app's own vehicle shape. `X` is extra data a vehicle hit carries
 * back, written onto each vehicle feature by `VehicleExtra.properties` and
 * read off the hit feature by `VehicleExtra.target`, so it survives the
 * vehicle dropping out of the latest positions.
 */

import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
} from 'maplibre-gl';
import type { GTFSScheduled } from '../gtfs/scheduled';
import type { VehiclePosition } from '../gtfs/rt-types';
import { vehicleRouteId } from '../gtfs/entity-render';
import {
  ROUTES_SOURCE_LAYER,
  ROUTE_TILES_MAXZOOM,
  STOPS_SOURCE_LAYER,
  STOP_TILES_MAXZOOM,
  setSourceTiles,
  tileUrl,
  useTileFeed,
} from './store-tiles';
import { clearThemeColorCache, resolveThemeColor } from '../util/theme-color';
import { onMapClick } from './click-away';
import { ensureMapIcons } from './icons';
import {
  ROUTE_LABELS_LAYER,
  clearRouteLabelImages,
  installRouteLabelImages,
  routeLabelFilter,
  routeLabelLayerSpec,
  routeLabelText,
} from './route-labels';
import {
  NO_ROUTE_FILTER,
  ROUTES_CASING_LAYER,
  ROUTES_CLICKAREA_LAYER,
  ROUTES_DIRECTION_LAYER,
  ROUTES_SOURCE,
  ROUTE_CASING_WIDTH_STOPS,
  ROUTE_WIDTH_STOPS,
  STOPS_BACKGROUND_LAYER,
  STOPS_CLICKAREA_LAYER,
  STOPS_SOURCE,
  STOPS_STATION_DOT_LAYER,
  TOP_LEVEL_STOPS_FILTER,
  routeMatch,
  routeSortKeyExpression,
  routeSpotlightOpacity,
  specialStop,
  stationDotFilter,
  stationFadeOpacity,
  stopClickAreaRadius,
  stopFadeOpacity,
  zoomWidth,
  type StopFadeBands,
  type StopFeatureState,
} from './layer-specs';
import {
  STOP_FOCUS_HALO_LAYER,
  STOP_FOCUS_RING_LAYER,
  STOP_FOCUS_TOP_LAYER,
  focusHaloPaint,
  focusRingPaint,
  focusTopPaint,
  stationDotPaint,
  stopFillColor,
  stopsBackgroundPaint,
  type StopStyleOptions,
} from './stop-layer-style';

/**
 * Counts of feed data the map could not draw: a stop with no id, or a vehicle
 * whose route doesn't exist in the schedule.
 */
export interface MapDataIssues {
  /** Rows in stops.txt with a blank `stop_id` — unaddressable by feature-state. */
  stopsMissingId: number;
  /** Rows in stops.txt with no position of their own or on a parent. */
  stopsMissingCoords: number;
  /** Vehicles whose `trip.route_id` doesn't resolve against the schedule. */
  vehiclesUnmatched: number;
  /**
   * Vehicles sharing a promoted map-feature id after key derivation. Must be 0:
   * a non-zero count means the derived `key` collapsed two vehicles onto one
   * feature (the "one click highlights all of them" failure) and the app's
   * key derivation is broken.
   */
  vehiclesDuplicateKeys: number;
}

/** The realtime vehicle layers, which `layer-specs.ts` knows nothing about. */
const VEHICLES_SOURCE = 'vehicles';
const VEHICLES_HALO_LAYER = 'vehicles-halo';
const VEHICLES_CASING_LAYER = 'vehicles-casing';
const VEHICLES_DOT_LAYER = 'vehicles-dot';
const VEHICLES_ARROW_CASING_LAYER = 'vehicles-arrow-casing';
const VEHICLES_ARROW_LAYER = 'vehicles-arrow';
const VEHICLES_CLICKAREA_LAYER = 'vehicles-clickarea';

/** The colored route line. The editor names this layer `routes-background`. */
const ROUTES_LINE_LAYER = 'routes-line';

/** Layer ids in paint order, bottom first. Used by `clear()` and ordering. */
const LAYER_ORDER = [
  ROUTES_CASING_LAYER,
  ROUTES_LINE_LAYER,
  ROUTES_DIRECTION_LAYER,
  ROUTES_CLICKAREA_LAYER,
  STOP_FOCUS_HALO_LAYER,
  STOP_FOCUS_RING_LAYER,
  STOPS_BACKGROUND_LAYER,
  STOP_FOCUS_TOP_LAYER,
  STOPS_STATION_DOT_LAYER,
  STOPS_CLICKAREA_LAYER,
  ROUTE_LABELS_LAYER,
  VEHICLES_HALO_LAYER,
  VEHICLES_CASING_LAYER,
  VEHICLES_DOT_LAYER,
  VEHICLES_ARROW_CASING_LAYER,
  VEHICLES_ARROW_LAYER,
  VEHICLES_CLICKAREA_LAYER,
] as const;

const SOURCE_IDS = [ROUTES_SOURCE, STOPS_SOURCE, VEHICLES_SOURCE] as const;

const STOP_LAYERS = [
  STOP_FOCUS_HALO_LAYER,
  STOP_FOCUS_RING_LAYER,
  STOPS_BACKGROUND_LAYER,
  STOP_FOCUS_TOP_LAYER,
  STOPS_STATION_DOT_LAYER,
  STOPS_CLICKAREA_LAYER,
] as const;

/**
 * Click priority, topmost first. A single map-level click handler queries these
 * in order rather than registering one handler per layer, so a vehicle sitting
 * on top of its own stop focuses the vehicle instead of firing both.
 */
const HIT_LAYERS = [
  VEHICLES_CLICKAREA_LAYER,
  STOPS_CLICKAREA_LAYER,
  ROUTES_CLICKAREA_LAYER,
] as const;

const STOP_CLICK_RADIUS = 15;

/**
 * Zoom ranges over which plain stops and stations fade in. The stop band also
 * drives the click-area radius, so a faded stop is never clickable. The
 * station band sits below the stop band so stations stay legible past the
 * zoom where plain stops turn to mush.
 */
const FADE_BANDS: StopFadeBands = {
  stationMin: 7.5,
  stationMax: 9.5,
  stopMin: 10.5,
  stopMax: 12.5,
};

/**
 * Below this many stops the zoom fade is skipped: a small feed has no pile of
 * dots to avoid, and its one nearby stop should show at any zoom.
 */
const STOP_FADE_MIN_STOPS = 50;

/** Opacity of stops, routes and vehicles off the spotlighted route. */
const SPOTLIGHT_STOP_DIM = 0.15;
const SPOTLIGHT_ROUTE_DIM = 0.2;
const SPOTLIGHT_VEHICLE_DIM = 0.25;
/** Width multipliers for the spotlighted route's line and casing. */
const SPOTLIGHT_LINE_BUMP = 1.35;
const SPOTLIGHT_CASING_BUMP = 1.3;
/** line-sort-key for the spotlighted route, far above any natural key. */
const SPOTLIGHT_SORT_KEY = 1_000_000;

/**
 * Zoom range over which the direction arrows fade in, above the stop band so
 * they appear last, and their opacity once in.
 */
const ROUTE_ARROW_FADE_ZOOM_MIN = 12;
const ROUTE_ARROW_FADE_ZOOM_MAX = 13.5;
const ROUTE_ARROW_OPACITY = 0.85;

/** Fill for a vehicle whose trip or route does not resolve in the schedule. */
export const VEHICLE_UNMATCHED_COLOR = '#94a3b8';

/**
 * Which feature states exempt a stop from the zoom fade here: the clicked stop,
 * the one hovered from the panel's route strip, and every stop on the
 * spotlighted route. Hover counts so pointing at a strip row still shows you
 * the stop when the map is zoomed out past where plain stops have faded. The
 * editor's `kept` state has no counterpart in a viewer.
 */
const SPECIAL_STATES: readonly StopFeatureState[] = [
  'focused',
  'hovered',
  'onRoute',
];
const SPECIAL_STOP = specialStop(SPECIAL_STATES);

const FOCUSED: ExpressionSpecification = [
  'boolean',
  ['feature-state', 'focused'],
  false,
];

/**
 * Selection color, resolved from the active DaisyUI theme. Red is reserved for
 * errors, so selection must not use it. The fallback is only reached when the
 * token cannot be read at all.
 */
function accentColor(): string {
  return resolveThemeColor('--color-primary', '#3b82f6');
}

/** Plain-stop colors and sizes the shared paint builders read. */
function stopStyle(accent: string): StopStyleOptions {
  return {
    accent,
    backgroundColor: '#ffffff',
    strokeColor: '#37474f',
    strokeWidth: 2,
    radius: 5.5,
  };
}

/** Outer ring of every vehicle, so a route-colored marker reads on top of its
 *  own route line; the white inner ring keeps it readable on dark basemaps. */
const VEHICLE_CASING_COLOR = '#0f172a';

/** Fill of a scheduled (simulated) vehicle; its route color moves to the edge. */
const VEHICLE_SCHEDULED_FILL = '#ffffff';

const SCHEDULED: ExpressionSpecification = [
  'boolean',
  ['get', 'scheduled'],
  false,
];

const byZoom = (...stops: unknown[]): ExpressionSpecification =>
  [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...stops,
  ] as unknown as ExpressionSpecification;

/**
 * Ring widths in pixels around every vehicle, dots and arrows alike, focused
 * and not: the inner ring (white, or the route color on a scheduled vehicle),
 * then the dark ring.
 */
const VEHICLE_RINGS = {
  inner: { normal: 1.5, focused: 3 },
  scheduled: { normal: 3, focused: 4 },
  dark: 1,
};

type VehicleSizeKind = 'casing' | 'arrow' | 'halo' | 'hit';

/**
 * Vehicle sizes as [zoom, value, ...] stops: `full` where vehicles are spread
 * out, and the `floor` a crowd never shrinks them below. The casing is the
 * dot's outer edge, both rings included. The same table as
 * gtfs-zone-timetable-sites' `map.js`.
 */
const VEHICLE_SIZE: Record<
  VehicleSizeKind,
  { full: number[]; floor: number[] }
> = {
  casing: {
    full: [8, 7, 14, 9.5, 18, 13],
    floor: [10, 4.25, 12, 5.05, 15, 7.5, 18, 12],
  },
  arrow: {
    full: [8, 0.6, 14, 0.85, 18, 1.15],
    floor: [10, 0.3, 12, 0.36, 15, 0.6, 18, 1],
  },
  halo: {
    full: [8, 11, 14, 17, 18, 23],
    floor: [10, 9, 12, 10, 15, 13, 18, 20],
  },
  hit: { full: [8, 12, 14, 15, 18, 20], floor: [10, 10, 15, 14, 18, 20] },
};

/** Every zoom any vehicle size has a stop at. */
const VEHICLE_ZOOMS = [
  ...new Set(
    Object.values(VEHICLE_SIZE).flatMap(({ full, floor }) =>
      [...full, ...floor].filter((_, i) => i % 2 === 0)
    )
  ),
].sort((a, b) => a - b);

/** The value of [zoom, value, ...] stops at zoom z, linear between stops. */
function stopAt(stops: number[], z: number): number {
  if (z <= stops[0]) {
    return stops[1];
  }
  for (let i = 2; i < stops.length; i += 2) {
    if (z <= stops[i]) {
      return (
        stops[i - 1] +
        ((stops[i + 1] - stops[i - 1]) * (z - stops[i - 2])) /
          (stops[i] - stops[i - 2])
      );
    }
  }
  return stops[stops.length - 1];
}

/** A vehicle size at zoom z: the full size times scale, never below the floor. */
function sizeAt(kind: VehicleSizeKind, scale: number, z: number): number {
  const { full, floor } = VEHICLE_SIZE[kind];
  return Math.max(stopAt(floor, z), stopAt(full, z) * scale);
}

/** A vehicle size by zoom; `out` wraps each stop's value. */
function vehicleSize(
  kind: VehicleSizeKind,
  scale: number,
  out: (v: number) => unknown = (v) => v
): ExpressionSpecification {
  return byZoom(
    ...VEHICLE_ZOOMS.flatMap((z) => [z, out(sizeAt(kind, scale, z))])
  );
}

/**
 * The widest arrow halo an icon-size can draw. MapLibre's SDF shader puts the
 * halo edge at alpha (6 - width / size) / 8, smoothed by 0.105 / size; past
 * this width the edge reaches alpha 0 and the halo fills the whole image square.
 */
const arrowHalo = (size: number, width: number): number =>
  Math.max(0, Math.min(width, 6 * size - 0.84));

/**
 * Every vehicle's rings by zoom, the same for dots and arrows: both rings
 * shrink together to fit the widest halo the arrow can draw at that zoom.
 * `f({ inner, dark }, z)` gives each stop's value.
 */
function vehicleRings(
  scale: number,
  f: (rings: { inner: number; dark: number }, z: number) => number
): ExpressionSpecification {
  const { inner, scheduled, dark } = VEHICLE_RINGS;
  const rings = (z: number, width: number) => {
    const total = width + dark;
    const fit = arrowHalo(sizeAt('arrow', scale, z), total) / total;
    return f({ inner: width * fit, dark: dark * fit }, z);
  };
  return byZoom(
    ...VEHICLE_ZOOMS.flatMap((z) => [
      z,
      [
        'case',
        FOCUSED,
        [
          'case',
          SCHEDULED,
          rings(z, scheduled.focused),
          rings(z, inner.focused),
        ],
        ['case', SCHEDULED, rings(z, scheduled.normal), rings(z, inner.normal)],
      ],
    ])
  );
}

/** A sized vehicle property: [layer, paint or layout, property, value]. */
type VehicleSized =
  | [
      string,
      'paint',
      Parameters<MapLibreMap['setPaintProperty']>[1],
      ExpressionSpecification,
    ]
  | [
      string,
      'layout',
      Parameters<MapLibreMap['setLayoutProperty']>[1],
      ExpressionSpecification,
    ];

/** Each sized vehicle property at scale. */
function vehicleSizes(scale: number): VehicleSized[] {
  return [
    [
      VEHICLES_HALO_LAYER,
      'paint',
      'circle-radius',
      vehicleSize('halo', scale, (v) => ['case', FOCUSED, v, 0]),
    ],
    [
      VEHICLES_CASING_LAYER,
      'paint',
      'circle-radius',
      vehicleSize('casing', scale),
    ],
    [
      VEHICLES_DOT_LAYER,
      'paint',
      'circle-radius',
      vehicleRings(
        scale,
        (r, z) => sizeAt('casing', scale, z) - r.inner - r.dark
      ),
    ],
    [
      VEHICLES_DOT_LAYER,
      'paint',
      'circle-stroke-width',
      vehicleRings(scale, (r) => r.inner),
    ],
    [
      VEHICLES_ARROW_CASING_LAYER,
      'layout',
      'icon-size',
      vehicleSize('arrow', scale),
    ],
    [
      VEHICLES_ARROW_CASING_LAYER,
      'paint',
      'icon-halo-width',
      vehicleRings(scale, (r) => r.inner + r.dark),
    ],
    [VEHICLES_ARROW_LAYER, 'layout', 'icon-size', vehicleSize('arrow', scale)],
    [
      VEHICLES_ARROW_LAYER,
      'paint',
      'icon-halo-width',
      vehicleRings(scale, (r) => r.inner),
    ],
    [
      VEHICLES_CLICKAREA_LAYER,
      'paint',
      'circle-radius',
      vehicleSize('hit', scale),
    ],
  ];
}

/**
 * How far to shrink vehicles where they crowd: the mean spacing between the
 * vehicles in view over the full hit area's diameter d at this zoom, at most
 * 1. Spacing is sqrt(area / count) over the area they occupy, the cells of a
 * d-pixel grid holding a vehicle, so empty parts of the view do not count:
 * sqrt(cells * d^2 / count) / d.
 */
function crowdScale(map: MapLibreMap, features: GeoJSON.Feature[]): number {
  const d = 2 * stopAt(VEHICLE_SIZE.hit.full, map.getZoom());
  const view = map.getBounds();
  const cells = new Set<string>();
  let n = 0;
  for (const f of features) {
    const at = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    if (!view.contains(at)) {
      continue;
    }
    const p = map.project(at);
    cells.add(`${Math.floor(p.x / d)},${Math.floor(p.y / d)}`);
    n++;
  }
  return n ? Math.min(1, Math.sqrt(cells.size / n)) : 1;
}

/** A feature the map can focus. A vehicle hit also carries the app's `X`. */
export type MapFocusTarget<X extends object = object> =
  | { kind: 'stop'; id: string }
  | { kind: 'route'; id: string }
  | ({ kind: 'vehicle'; id: string } & X);

type FocusTarget = MapFocusTarget | null;

/** Extra per-vehicle data written onto the feature and read back on a hit. */
export interface VehicleExtra<V extends VehiclePosition, X extends object> {
  properties(vehicle: V): Record<string, string | number | boolean>;
  target(properties: Record<string, unknown>): X;
}

const EMPTY: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export class LayerManager<
  V extends VehiclePosition = VehiclePosition,
  X extends object = object,
> {
  private map: MapLibreMap;
  private vehicleExtra: VehicleExtra<V, X> | null;
  private feed: GTFSScheduled | null = null;

  /** Tile URL generation of the current feed; 0 before any feed. */
  private tileGen = 0;
  private vehiclesData: GeoJSON.FeatureCollection = EMPTY;
  private latestVehicles: V[] = [];
  /** How far crowded vehicles are drawn smaller, from `crowdScale`. */
  private vehicleScale = 1;

  private focus: FocusTarget = null;
  /** The stop whose strip row is hovered in the panel, if any. */
  private hoveredStopId: string | null = null;
  /** Stops that *should* carry the `onRoute` feature-state on the map. */
  private wantedRouteStopIds: string[] = [];
  /** False while the feed is small enough that both zoom fade bands are skipped. */
  private stopFadeActive = true;
  /** Armed while feature state is waiting for a source to finish loading. */
  private retry: (() => void) | null = null;

  issues: MapDataIssues = {
    stopsMissingId: 0,
    stopsMissingCoords: 0,
    vehiclesUnmatched: 0,
    vehiclesDuplicateKeys: 0,
  };

  onSelect: ((target: MapFocusTarget<X>) => void) | null = null;
  /** Called when a click lands on no feature — the map's "click away". */
  onEmptySelect: (() => void) | null = null;

  /** Resolved once per theme; `refreshAccentColor` re-reads it. */
  private accent = accentColor();
  private stopStyle = stopStyle(this.accent);

  constructor(map: MapLibreMap, vehicleExtra?: VehicleExtra<V, X>) {
    this.map = map;
    this.vehicleExtra = vehicleExtra ?? null;
    map.on('moveend', () => this.rescaleVehicles());
    installRouteLabelImages(map, (routeId) => {
      const route = this.feed?.routes.get(routeId);
      return route ? { text: routeLabelText(route), color: route.color } : null;
    });
  }

  /**
   * Re-resolve the accent against the now-active theme and repaint every
   * property painted with it. Called by the theme controller; the layers are
   * already on the map, so this cannot go through `addLayers`.
   */
  refreshAccentColor(): void {
    clearThemeColorCache();
    this.accent = accentColor();
    this.stopStyle = stopStyle(this.accent);

    for (const id of [
      STOP_FOCUS_HALO_LAYER,
      STOP_FOCUS_RING_LAYER,
      VEHICLES_HALO_LAYER,
    ]) {
      if (!this.map.getLayer(id)) {
        continue;
      }
      this.map.setPaintProperty(id, 'circle-color', this.accent);
      this.map.setPaintProperty(id, 'circle-stroke-color', this.accent);
    }
    // Only the fill reads the accent on these two: the focused circle is
    // painted in it, everything else in the layer is accent-free.
    const fill = stopFillColor(this.accent, this.stopStyle.backgroundColor);
    for (const id of [STOPS_BACKGROUND_LAYER, STOP_FOCUS_TOP_LAYER]) {
      if (!this.map.getLayer(id)) {
        continue;
      }
      this.map.setPaintProperty(id, 'circle-color', fill);
    }
    // stops-background's opacity carries the route spotlight, which the
    // repaint above leaves untouched but applyStopDim re-derives anyway.
    this.applyStopDim();
  }

  // ── Data in ────────────────────────────────────────────────────────────────

  setScheduledFeed(feed: GTFSScheduled | null): void {
    this.feed = feed;
    this.tileGen = useTileFeed(feed);
    setSourceTiles(this.map, ROUTES_SOURCE, this.tileUrl('routes'));
    setSourceTiles(this.map, STOPS_SOURCE, this.tileUrl('stops'));
    this.issues.stopsMissingId = feed?.stopTiles.missingId ?? 0;
    this.issues.stopsMissingCoords = feed?.stopTiles.missingCoords ?? 0;
    if (this.map.style) {
      clearRouteLabelImages(this.map);
    }
    this.refreshStopFade(feed?.stopTiles.stops ?? 0);
    // A new feed almost never contains the old focus; AppState clears it
    // separately, but the map's own spotlight and feature state have to go now
    // either way. setFocus(null) wipes every source's feature state, so a stale
    // `focused`/`onRoute` cannot survive into the new feed.
    this.hoveredStopId = null;
    this.setFocus(null);
  }

  setVehicles(positions: V[]): void {
    this.latestVehicles = positions;
    this.vehiclesData = this.buildVehicles(positions);
    // setData rather than re-adding the source: re-adding on every 15s poll
    // flashes the markers and drops their feature state.
    (this.map.getSource(VEHICLES_SOURCE) as GeoJSONSource | undefined)?.setData(
      this.vehiclesData
    );
    this.rescaleVehicles();
    // The focused vehicle may have just appeared or changed trips.
    if (this.focus?.kind === 'vehicle') {
      this.applySpotlight(this.spotlightRouteIds());
    } else {
      this.applyRouteLabels(this.spotlightRouteIds());
    }
    this.syncFeatureState();
  }

  // ── Focus ──────────────────────────────────────────────────────────────────

  setFocus(target: FocusTarget): void {
    // A platform is never drawn, so focusing one highlights and eases to its
    // drawn station instead. The panel still shows the
    // platform page; only the map resolves upward.
    this.focus =
      target?.kind === 'stop'
        ? { kind: 'stop', id: this.drawnAncestor(target.id) }
        : target;

    // Route focus spotlights the route and its stops; anything else clears it.
    this.wantedRouteStopIds =
      target?.kind === 'route' ? this.stopIdsForRoute(target.id) : [];
    const routeIds = target?.kind === 'route' ? [target.id] : null;
    this.applyStopDim();
    this.applySpotlight(this.spotlightRouteIds());
    this.applyVehicleDim(routeIds);
    this.syncFeatureState();
  }

  /** Routes to spotlight: the focused route, or the focused vehicle's route. */
  private spotlightRouteIds(): string[] | null {
    const target = this.focus;
    if (target?.kind === 'route') {
      return [target.id];
    }
    if (target?.kind === 'vehicle') {
      const feature = this.vehiclesData.features.find(
        (f) => f.properties?.vehicle_id === target.id
      );
      const routeId = feature?.properties?.route_id;
      return routeId ? [String(routeId)] : null;
    }
    return null;
  }

  /**
   * Light the stop whose row is hovered in the panel's route strip. Its own
   * feature state, so hovering never disturbs the selection, and a stop that is
   * both still reads as focused.
   *
   * Resolved through `drawnAncestor` for the same reason `setFocus` does it: a
   * platform is never drawn, so a hover on one has to land on its station.
   */
  setHoveredStop(stop_id: string | null): void {
    const resolved = stop_id === null ? null : this.drawnAncestor(stop_id);
    if (this.hoveredStopId === resolved) {
      return;
    }
    this.hoveredStopId = resolved;
    this.syncFeatureState();
  }

  /**
   * Push the wanted feature state onto the sources.
   *
   * Every pass first wipes *all* feature state on each source with
   * `removeFeatureState({ source })`, then re-applies only what is wanted now.
   * Feature state on a GeoJSON source survives `setData`, so a `focused: true`
   * or `onRoute: true` left on a feature would otherwise leak across focus
   * changes and — since a new feed reuses the same source — across feed changes
   * too. Clearing wholesale removes that entire class of
   * stale-highlight bug in one call.
   *
   * `setFeatureState` silently no-ops when the source hasn't loaded its data
   * yet — exactly the case for the first focus restored from a link, and again
   * after every basemap change. Anything that doesn't land is retried on
   * `sourcedata` until it does; the clear runs on each retry pass as well.
   */
  private syncFeatureState(): void {
    let settled = true;

    for (const source of SOURCE_IDS) {
      if (!this.map.getSource(source)) {
        continue;
      }
      try {
        this.map.removeFeatureState({
          source,
          sourceLayer: sourceLayerOf(source),
        });
      } catch (err) {
        console.debug(
          `[LayerManager] removeFeatureState failed for ${source}`,
          err
        );
      }
    }

    if (this.sourceReady(STOPS_SOURCE)) {
      for (const id of this.wantedRouteStopIds) {
        this.setState('stop', id, { onRoute: true });
      }
      // Hover is transient: if the source isn't ready the pointer has almost
      // certainly moved on, so it never arms the retry.
      if (this.hoveredStopId !== null) {
        this.setState('stop', this.hoveredStopId, { hovered: true });
      }
    } else if (this.wantedRouteStopIds.length > 0) {
      settled = false;
    }

    const target = this.focus;
    if (target) {
      if (this.sourceReady(sourceFor(target.kind))) {
        this.setState(target.kind, target.id, { focused: true });
      } else {
        settled = false;
      }
    }

    if (settled) {
      this.disarmRetry();
    } else {
      this.armRetry();
    }
  }

  private sourceReady(id: string): boolean {
    return Boolean(this.map.getSource(id)) && this.map.isSourceLoaded(id);
  }

  private armRetry(): void {
    if (this.retry) {
      return;
    }
    this.retry = () => this.syncFeatureState();
    this.map.on('sourcedata', this.retry);
  }

  private disarmRetry(): void {
    if (!this.retry) {
      return;
    }
    this.map.off('sourcedata', this.retry);
    this.retry = null;
  }

  private setState(
    kind: 'stop' | 'route' | 'vehicle',
    id: string,
    state: object
  ): void {
    const source = sourceFor(kind);
    if (!this.map.getSource(source)) {
      return;
    }
    try {
      this.map.setFeatureState(
        { source, sourceLayer: sourceLayerOf(source), id },
        state
      );
    } catch (err) {
      console.debug(
        `[LayerManager] setFeatureState failed for ${kind} ${id}`,
        err
      );
    }
  }

  /**
   * Dim every stop that isn't on the spotlighted route. The `onRoute` marks
   * themselves are applied by `syncFeatureState`; this is only the paint side.
   */
  private applyStopDim(): void {
    const dim = this.wantedRouteStopIds.length > 0 ? SPOTLIGHT_STOP_DIM : null;
    if (this.map.getLayer(STOPS_BACKGROUND_LAYER)) {
      const fade = this.stopFade(dim);
      this.map.setPaintProperty(STOPS_BACKGROUND_LAYER, 'circle-opacity', fade);
      this.map.setPaintProperty(
        STOPS_BACKGROUND_LAYER,
        'circle-stroke-opacity',
        fade
      );
    }
    if (this.map.getLayer(STOPS_STATION_DOT_LAYER)) {
      this.map.setPaintProperty(
        STOPS_STATION_DOT_LAYER,
        'circle-opacity',
        this.stationFade(dim)
      );
    }
    if (this.map.getLayer(STOPS_CLICKAREA_LAYER)) {
      this.map.setPaintProperty(
        STOPS_CLICKAREA_LAYER,
        'circle-radius',
        this.clickAreaRadius()
      );
    }
  }

  /** The three fade expressions, bound to the fade bands and exemption set. */
  private stopFade(dim: number | null): ExpressionSpecification {
    return stopFadeOpacity(SPECIAL_STOP, FADE_BANDS, this.stopFadeActive, dim);
  }

  private stationFade(dim: number | null): ExpressionSpecification {
    return stationFadeOpacity(
      SPECIAL_STOP,
      FADE_BANDS,
      this.stopFadeActive,
      dim
    );
  }

  private clickAreaRadius(): ExpressionSpecification {
    return stopClickAreaRadius(
      SPECIAL_STOP,
      FADE_BANDS,
      this.stopFadeActive,
      STOP_CLICK_RADIUS
    );
  }

  /**
   * Turn the zoom fade off for a feed with only a handful of stops, on again
   * once it grows. Called whenever the stop data changes.
   */
  private refreshStopFade(stopCount: number): void {
    const active = stopCount >= STOP_FADE_MIN_STOPS;
    if (active === this.stopFadeActive) {
      return;
    }
    this.stopFadeActive = active;
    for (const id of STOP_LAYERS) {
      if (this.map.getLayer(id)) {
        this.map.setLayerZoomRange(id, this.stopsMinZoom(), 24);
      }
    }
    this.applyStopDim();
  }

  /**
   * Stop layers skip the zooms where the fade hides every stop, so a big
   * feed's stop tiles are never loaded there.
   */
  private stopsMinZoom(): number {
    return this.stopFadeActive ? FADE_BANDS.stationMin : 0;
  }

  /**
   * Dim every vehicle that isn't running on the spotlighted route, and lift the
   * ones that are above the rest. Vehicles carry `route_id` (resolved from the
   * trip when the position omits it), so the same literal match the route
   * spotlight uses works here unchanged.
   *
   * The focus halo is left alone: its radius is 0 unless the feature is
   * focused, and a route focus never coexists with a vehicle focus.
   */
  private applyVehicleDim(routeIds: string[] | null): void {
    const match = routeMatch(routeIds);
    const opacity = routeSpotlightOpacity(match, SPOTLIGHT_VEHICLE_DIM);

    // Vehicles have no natural paint order — one bucket of markers all drawn at
    // once — so the lift is a plain 1-or-0 rather than an offset off a base key.
    // `icon-allow-overlap` is true on the arrow, which is the case where a
    // *greater* symbol-sort-key draws on top, matching circle-sort-key.
    const sortKey = (match
      ? ['case', match, 1, 0]
      : 0) as unknown as ExpressionSpecification;

    if (this.map.getLayer(VEHICLES_CASING_LAYER)) {
      this.map.setPaintProperty(
        VEHICLES_CASING_LAYER,
        'circle-opacity',
        opacity
      );
      this.map.setLayoutProperty(
        VEHICLES_CASING_LAYER,
        'circle-sort-key',
        sortKey
      );
    }
    if (this.map.getLayer(VEHICLES_DOT_LAYER)) {
      this.map.setPaintProperty(VEHICLES_DOT_LAYER, 'circle-opacity', opacity);
      this.map.setPaintProperty(
        VEHICLES_DOT_LAYER,
        'circle-stroke-opacity',
        opacity
      );
      this.map.setLayoutProperty(
        VEHICLES_DOT_LAYER,
        'circle-sort-key',
        sortKey
      );
    }
    // icon-opacity covers the SDF fill and its halo together, so each arrow
    // layer fades as one mark.
    for (const id of [VEHICLES_ARROW_CASING_LAYER, VEHICLES_ARROW_LAYER]) {
      if (this.map.getLayer(id)) {
        this.map.setPaintProperty(id, 'icon-opacity', opacity);
        this.map.setLayoutProperty(id, 'symbol-sort-key', sortKey);
      }
    }
    // Sorted with the drawn layers so a click on stacked vehicles resolves to
    // whichever one visually reads as on top.
    if (this.map.getLayer(VEHICLES_CLICKAREA_LAYER)) {
      this.map.setLayoutProperty(
        VEHICLES_CLICKAREA_LAYER,
        'circle-sort-key',
        sortKey
      );
    }
  }

  /** Label the routes that have a vehicle on the map, plus `spotlit`. */
  private applyRouteLabels(spotlit: string[] | null): void {
    if (!this.map.getLayer(ROUTE_LABELS_LAYER)) {
      return;
    }
    const ids = this.vehiclesData.features.flatMap((f) => {
      const id = f.properties?.route_id;
      return id ? [String(id)] : [];
    });
    this.map.setFilter(
      ROUTE_LABELS_LAYER,
      routeLabelFilter([...ids, ...(spotlit ?? [])])
    );
  }

  private applySpotlight(routeIds: string[] | null): void {
    this.applyRouteLabels(routeIds);
    if (!this.map.getLayer(ROUTES_LINE_LAYER)) {
      return;
    }

    const match = routeMatch(routeIds);
    const opacity = routeSpotlightOpacity(match, SPOTLIGHT_ROUTE_DIM);

    this.map.setPaintProperty(ROUTES_LINE_LAYER, 'line-opacity', opacity);
    this.map.setPaintProperty(ROUTES_CASING_LAYER, 'line-opacity', opacity);
    this.map.setPaintProperty(
      ROUTES_LINE_LAYER,
      'line-width',
      zoomWidth(ROUTE_WIDTH_STOPS, match, SPOTLIGHT_LINE_BUMP)
    );
    this.map.setPaintProperty(
      ROUTES_CASING_LAYER,
      'line-width',
      zoomWidth(ROUTE_CASING_WIDTH_STOPS, match, SPOTLIGHT_CASING_BUMP)
    );

    const sortKey = routeSortKeyExpression(match, SPOTLIGHT_SORT_KEY);
    for (const id of [
      ROUTES_CASING_LAYER,
      ROUTES_LINE_LAYER,
      ROUTES_CLICKAREA_LAYER,
    ]) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'line-sort-key', sortKey);
      }
    }

    // Direction arrows only when exactly one route is spotlighted: a stop click
    // spotlights every route serving the stop, and arrows on all of them are
    // noise.
    if (this.map.getLayer(ROUTES_DIRECTION_LAYER)) {
      this.map.setFilter(
        ROUTES_DIRECTION_LAYER,
        routeIds && routeIds.length === 1
          ? ([
              '==',
              ['get', 'route_id'],
              routeIds[0],
            ] as unknown as FilterSpecification)
          : (NO_ROUTE_FILTER as unknown as FilterSpecification)
      );
    }
  }

  // ── Geometry lookups, for camera moves ─────────────────────────────────────

  stopPosition(stopId: string): [number, number] | null {
    return this.feed?.resolvedPosition(stopId) ?? null;
  }

  /**
   * Where the camera should ease to when focusing a stop: the drawn stop the
   * focus resolves to (a platform resolves up to its station).
   */
  focusPosition(stopId: string): [number, number] | null {
    return this.stopPosition(this.drawnAncestor(stopId));
  }

  vehiclePosition(vehicleId: string): [number, number] | null {
    const v = this.latestVehicles.find((p) => p.key === vehicleId);
    return v ? [v.lon, v.lat] : null;
  }

  /** `[[west, south], [east, north]]`, or null when the route has no geometry. */
  routeBounds(routeId: string): [[number, number], [number, number]] | null {
    return corners(this.feed?.routeBounds.get(routeId) ?? null);
  }

  /** Bounds of every drawn stop and route line: the "fit the whole feed" box. */
  feedBounds(): [[number, number], [number, number]] | null {
    return corners(this.feed?.mapBounds ?? null);
  }

  // ── Style lifecycle ────────────────────────────────────────────────────────

  /**
   * Re-add every source and layer. `map.setStyle()` destroys all of them, so
   * this runs on `basemap:changed` — without it, switching basemaps blanks all
   * GTFS data.
   */
  rebuild(): void {
    this.addArrowImage();
    // Registered images are dropped with the style too, and the direction layer
    // references `route-arrow` by name, so the glyphs have to be back first.
    ensureMapIcons(this.map);
    this.addSources();
    this.addLayers();
    // Neither paint overrides nor feature state survive a style swap.
    const routeIds = this.focus?.kind === 'route' ? [this.focus.id] : null;
    this.applyStopDim();
    this.applySpotlight(this.spotlightRouteIds());
    this.applyVehicleDim(routeIds);
    this.syncFeatureState();
  }

  clear(): void {
    for (const id of LAYER_ORDER) {
      if (this.map.getLayer(id)) {
        this.map.removeLayer(id);
      }
    }
    for (const id of SOURCE_IDS) {
      if (this.map.getSource(id)) {
        this.map.removeSource(id);
      }
    }
  }

  private tileUrl(layer: 'routes' | 'stops'): string {
    return tileUrl(this.feed ? layer : null, this.tileGen);
  }

  private addSources(): void {
    // promoteId lifts the id out of properties so setFeatureState can address
    // string ids like "place-jfk", which the vector-tile encoder cannot carry.
    if (!this.map.getSource(ROUTES_SOURCE)) {
      this.map.addSource(ROUTES_SOURCE, {
        type: 'vector',
        tiles: [this.tileUrl('routes')],
        maxzoom: ROUTE_TILES_MAXZOOM,
        promoteId: 'route_id',
      });
    }
    if (!this.map.getSource(STOPS_SOURCE)) {
      this.map.addSource(STOPS_SOURCE, {
        type: 'vector',
        tiles: [this.tileUrl('stops')],
        maxzoom: STOP_TILES_MAXZOOM,
        promoteId: 'stop_id',
      });
    }
    if (!this.map.getSource(VEHICLES_SOURCE)) {
      this.map.addSource(VEHICLES_SOURCE, {
        type: 'geojson',
        data: this.vehiclesData,
        promoteId: 'vehicle_id',
      });
    }
  }

  // ── Layers ─────────────────────────────────────────────────────────────────

  private addLayers(): void {
    this.addRouteLayers();
    this.addStopLayers();
    // Above the stops so a label is not hidden under a station, below the
    // vehicles so it never covers one.
    if (!this.map.getLayer(ROUTE_LABELS_LAYER)) {
      this.map.addLayer(
        routeLabelLayerSpec(ROUTES_SOURCE, ROUTES_SOURCE_LAYER)
      );
    }
    this.addVehicleLayers();
  }

  private addRouteLayers(): void {
    if (this.map.getLayer(ROUTES_CASING_LAYER)) {
      return;
    }

    this.map.addLayer({
      id: ROUTES_CASING_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      'source-layer': ROUTES_SOURCE_LAYER,
      paint: {
        'line-color': ['get', 'colorDark'],
        'line-width': zoomWidth(ROUTE_CASING_WIDTH_STOPS, null, 1),
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    this.map.addLayer({
      id: ROUTES_LINE_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      'source-layer': ROUTES_SOURCE_LAYER,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomWidth(ROUTE_WIDTH_STOPS, null, 1),
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    // Direction chevrons for the single spotlighted route. Above the ribbon so
    // it can never cover them, below every stop layer. Starts filtered to
    // nothing; applySpotlight owns the filter. Each line in a route's
    // MultiLineString runs in its own shape's travel direction, so a
    // bidirectional route gets arrows pointing both ways, one set per shape.
    this.map.addLayer({
      id: ROUTES_DIRECTION_LAYER,
      type: 'symbol',
      source: ROUTES_SOURCE,
      'source-layer': ROUTES_SOURCE_LAYER,
      filter: NO_ROUTE_FILTER as unknown as FilterSpecification,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          80,
          16,
          140,
        ],
        'icon-image': 'route-arrow',
        'icon-rotation-alignment': 'map',
        // An upright flip would reverse the arrow, the one thing this layer
        // must never do.
        'icon-keep-upright': false,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1],
        // Let collision detection interleave the arrows where two
        // opposite-direction features share a corridor, rather than stacking
        // them on top of each other.
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
      },
      paint: {
        'icon-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          ROUTE_ARROW_FADE_ZOOM_MIN,
          0,
          ROUTE_ARROW_FADE_ZOOM_MAX,
          ROUTE_ARROW_OPACITY,
        ],
      },
    });

    this.map.addLayer({
      id: ROUTES_CLICKAREA_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      'source-layer': ROUTES_SOURCE_LAYER,
      paint: {
        'line-color': 'transparent',
        'line-width': 15,
        'line-opacity': 0,
      },
      // Sorted identically to the drawn layers so a click on overlapping routes
      // resolves to whichever one visually reads as on top.
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });
  }

  /**
   * Stop paint comes from the shared `stop-layer-style.ts`, the filters and the
   * fade from `layer-specs.ts`. Order matters: the halo and ring sit under the
   * circles, the focus redraw sits over them so a neighbouring stop cannot
   * paint over the selection, and the station dot goes last so a focused
   * station keeps its center dot.
   */
  private addStopLayers(): void {
    if (this.map.getLayer(STOPS_BACKGROUND_LAYER)) {
      return;
    }

    this.map.addLayer({
      id: STOP_FOCUS_HALO_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      'source-layer': STOPS_SOURCE_LAYER,
      minzoom: this.stopsMinZoom(),
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: focusHaloPaint(this.accent),
    });

    this.map.addLayer({
      id: STOP_FOCUS_RING_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      'source-layer': STOPS_SOURCE_LAYER,
      minzoom: this.stopsMinZoom(),
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: focusRingPaint(this.accent),
    });

    this.map.addLayer({
      id: STOPS_BACKGROUND_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      'source-layer': STOPS_SOURCE_LAYER,
      minzoom: this.stopsMinZoom(),
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: stopsBackgroundPaint(this.stopStyle, this.stopFade(null)),
    });

    this.map.addLayer({
      id: STOP_FOCUS_TOP_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      'source-layer': STOPS_SOURCE_LAYER,
      minzoom: this.stopsMinZoom(),
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: focusTopPaint(this.stopStyle),
    });

    this.map.addLayer({
      id: STOPS_STATION_DOT_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      'source-layer': STOPS_SOURCE_LAYER,
      minzoom: this.stopsMinZoom(),
      // The viewer never expands a station, so the stop filter is always the
      // default one and the station-dot filter needs no composition.
      filter: stationDotFilter(null),
      paint: stationDotPaint(this.stationFade(null)),
    });

    // The hit radius mirrors the visible layer's fade: it collapses to 0 where
    // plain stops are fully faded out, so invisible stops are simply not
    // returned by queryRenderedFeatures: no JS-side visibility predicate to
    // keep in sync.
    this.map.addLayer({
      id: STOPS_CLICKAREA_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      'source-layer': STOPS_SOURCE_LAYER,
      minzoom: this.stopsMinZoom(),
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: {
        'circle-radius': this.clickAreaRadius(),
        'circle-color': 'transparent',
        'circle-opacity': 0,
      },
    });
  }

  /** Resizes the vehicle layers when the crowd in view changes. */
  private rescaleVehicles(): void {
    const next = crowdScale(this.map, this.vehiclesData.features);
    if (next === this.vehicleScale) {
      return;
    }
    this.vehicleScale = next;
    for (const [id, kind, prop, value] of vehicleSizes(next)) {
      if (!this.map.getLayer(id)) {
        continue;
      }
      if (kind === 'paint') {
        this.map.setPaintProperty(id, prop, value);
      } else {
        this.map.setLayoutProperty(id, prop, value);
      }
    }
  }

  /**
   * A route-colored dot, or a route-colored arrow for vehicles with a bearing,
   * both in an inner ring then a dark ring, plus a halo around the focused one.
   * A scheduled vehicle is hollow: white fill, route-colored inner ring. Sizes
   * shrink by `vehicleScale` where vehicles crowd.
   */
  private addVehicleLayers(): void {
    if (this.map.getLayer(VEHICLES_DOT_LAYER)) {
      return;
    }
    const size = new Map(
      vehicleSizes(this.vehicleScale).map(([id, , prop, value]) => [
        `${id} ${prop}`,
        value,
      ])
    );
    const sized = (id: string, prop: string) => size.get(`${id} ${prop}`)!;
    const fill = [
      'case',
      SCHEDULED,
      VEHICLE_SCHEDULED_FILL,
      ['get', 'color'],
    ] as unknown as ExpressionSpecification;
    const inner = [
      'case',
      SCHEDULED,
      ['get', 'color'],
      '#ffffff',
    ] as unknown as ExpressionSpecification;
    const noBearing = [
      '==',
      ['get', 'has_bearing'],
      false,
    ] as unknown as FilterSpecification;
    const bearing = [
      '==',
      ['get', 'has_bearing'],
      true,
    ] as unknown as FilterSpecification;

    // Focus halo: a soft ring that only exists for the focused vehicle. The
    // arrow's size is a layout property and so cannot read feature-state; the
    // halo carries the emphasis instead.
    this.map.addLayer({
      id: VEHICLES_HALO_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      paint: {
        'circle-radius': sized(VEHICLES_HALO_LAYER, 'circle-radius'),
        'circle-color': this.accent,
        'circle-opacity': 0.25,
        'circle-stroke-color': this.accent,
        'circle-stroke-width': ['case', FOCUSED, 2, 0],
      },
    });

    // Dark circle under the dot: the dot's stroke is the inner ring and leaves
    // the casing's edge showing as the dark ring.
    this.map.addLayer({
      id: VEHICLES_CASING_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      filter: noBearing,
      paint: {
        'circle-radius': sized(VEHICLES_CASING_LAYER, 'circle-radius'),
        'circle-color': VEHICLE_CASING_COLOR,
      },
    });

    this.map.addLayer({
      id: VEHICLES_DOT_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      filter: noBearing,
      paint: {
        'circle-radius': sized(VEHICLES_DOT_LAYER, 'circle-radius'),
        'circle-color': fill,
        'circle-stroke-color': inner,
        'circle-stroke-width': sized(VEHICLES_DOT_LAYER, 'circle-stroke-width'),
      },
    });

    // The arrow as the dot: a dark arrow with a dark halo out to both rings,
    // under the filled arrow with the inner ring as its halo.
    for (const [id, color, halo] of [
      [VEHICLES_ARROW_CASING_LAYER, VEHICLE_CASING_COLOR, VEHICLE_CASING_COLOR],
      [VEHICLES_ARROW_LAYER, fill, inner],
    ] as const) {
      this.map.addLayer({
        id,
        type: 'symbol',
        source: VEHICLES_SOURCE,
        filter: bearing,
        layout: {
          'icon-image': 'vehicle-arrow',
          'icon-size': sized(id, 'icon-size'),
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': color,
          'icon-halo-color': halo,
          'icon-halo-width': sized(id, 'icon-halo-width'),
        },
      });
    }

    // Never smaller than the largest drawn vehicle (focused halo aside): the
    // clickarea is the sole hit-test layer, same contract as the stops one.
    this.map.addLayer({
      id: VEHICLES_CLICKAREA_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      paint: {
        'circle-radius': sized(VEHICLES_CLICKAREA_LAYER, 'circle-radius'),
        'circle-color': 'transparent',
        'circle-opacity': 0,
      },
    });
  }

  /**
   * A north-pointing arrow as an SDF, so `icon-color` tints it per route: each
   * pixel's alpha is MapLibre's encoding of its signed distance d to the
   * outline, (6 - d) / 8 with d > 0 outside, so halos are even rings out to
   * 6 pixels.
   *
   * Separate from `gtfs-zone-web-common`'s `map-icons.ts`: that file's `route-arrow` is a
   * white-on-dark chevron laid along a line, not a tintable vehicle marker.
   */
  private addArrowImage(): void {
    if (this.map.hasImage('vehicle-arrow')) {
      return;
    }

    const size = 48;
    const shape: [number, number][] = [
      [size / 2, 6],
      [size - 10, size - 8],
      [size / 2, size - 16],
      [10, size - 8],
    ];
    const edges = shape.map((a, i) => [a, shape[(i + 1) % shape.length]]);
    const segmentDistance = (
      x: number,
      y: number,
      [[ax, ay], [bx, by]]: [number, number][]
    ) => {
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))
      );
      return Math.hypot(x - ax - t * dx, y - ay - t * dy);
    };
    // Even-odd crossings of a ray to the right.
    const inside = (x: number, y: number) =>
      edges.filter(
        ([[ax, ay], [bx, by]]) =>
          ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)
      ).length %
        2 ===
      1;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = px + 0.5;
        const y = py + 0.5;
        const d =
          Math.min(...edges.map((e) => segmentDistance(x, y, e))) *
          (inside(x, y) ? -1 : 1);
        data[(py * size + px) * 4 + 3] = Math.round((255 * (6 - d)) / 8);
      }
    }
    this.map.addImage(
      'vehicle-arrow',
      { width: size, height: size, data },
      { sdf: true }
    );
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  /**
   * One map-level handler rather than one per layer: overlapping features (a
   * vehicle parked on its own stop) would otherwise fire two selections.
   */
  attachInteraction(): void {
    onMapClick(this.map, {
      layers: HIT_LAYERS,
      onFeature: (features) => {
        const hit = this.topTarget(features);
        if (hit) {
          this.onSelect?.(hit);
        } else {
          this.onEmptySelect?.();
        }
      },
      onEmpty: () => this.onEmptySelect?.(),
    });
  }

  /** The hit feature of the highest-priority layer in `HIT_LAYERS`. */
  private topTarget(features: MapGeoJSONFeature[]): MapFocusTarget<X> | null {
    for (const layer of HIT_LAYERS) {
      for (const feature of features) {
        if (feature.layer.id !== layer) {
          continue;
        }
        const props = feature.properties ?? {};
        if (layer === VEHICLES_CLICKAREA_LAYER && props.vehicle_id) {
          return {
            ...(this.vehicleExtra?.target(props) ?? ({} as X)),
            kind: 'vehicle',
            id: String(props.vehicle_id),
          };
        }
        if (layer === STOPS_CLICKAREA_LAYER && props.stop_id) {
          return { kind: 'stop', id: String(props.stop_id) };
        }
        if (layer === ROUTES_CLICKAREA_LAYER && props.route_id) {
          return { kind: 'route', id: String(props.route_id) };
        }
      }
    }
    return null;
  }

  // ── GeoJSON builders ───────────────────────────────────────────────────────

  private buildVehicles(positions: V[]): GeoJSON.FeatureCollection {
    const feed = this.feed;
    let unmatched = 0;
    const seenKeys = new Set<string>();
    let duplicateKeys = 0;

    const features = positions.map((v) => {
      const routeId = vehicleRouteId(feed, v);
      const route = routeId ? feed?.routes.get(routeId) : undefined;
      if (!route) {
        unmatched++;
      }
      if (seenKeys.has(v.key)) {
        duplicateKeys++;
      } else {
        seenKeys.add(v.key);
      }

      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
        properties: {
          ...this.vehicleExtra?.properties(v),
          vehicle_id: v.key,
          bearing: v.bearing ?? 0,
          has_bearing: v.bearing !== undefined,
          scheduled: v.scheduled === true,
          color: route?.color ?? VEHICLE_UNMATCHED_COLOR,
          route_id: routeId ?? '',
          trip_id: v.tripId ?? '',
        },
      };
    });

    this.issues.vehiclesUnmatched = unmatched;
    this.issues.vehiclesDuplicateKeys = duplicateKeys;
    return { type: 'FeatureCollection', features };
  }

  /**
   * Every *drawn* stop served by a route. `stop_times` names platforms, which
   * are page-only and never drawn, so each stop id is
   * mapped up to its drawn ancestor — otherwise a subway route's `onRoute`
   * state lands on nothing and its stations get dimmed with everything else.
   */
  private stopIdsForRoute(routeId: string): string[] {
    const feed = this.feed;
    if (!feed) {
      return [];
    }
    const ids = new Set<string>();
    for (const stopId of feed.stopsForRoute(routeId)) {
      ids.add(this.drawnAncestor(stopId));
    }
    return [...ids];
  }

  /**
   * The nearest ancestor of a stop that is actually drawn on the map — a
   * top-level stop or a station. Platforms resolve up to their station; a
   * platform whose ancestry is not drawn resolves to itself and simply gets no
   * highlight.
   */
  private drawnAncestor(stopId: string): string {
    const feed = this.feed;
    if (!feed) {
      return stopId;
    }
    const stop = feed.stops.get(stopId);
    if (!stop) {
      return stopId;
    }
    // Drawn: a station, or a stop with no parent (TOP_LEVEL_STOPS_FILTER).
    if (stop.location_type === 1 || !stop.parent_station) {
      return stopId;
    }
    const root = feed.stationRoot(stopId);
    return feed.stops.has(root) ? root : stopId;
  }
}

/** The source layer of a vector source, undefined for GeoJSON. */
function sourceLayerOf(source: string): string | undefined {
  if (source === ROUTES_SOURCE) {
    return ROUTES_SOURCE_LAYER;
  }
  return source === STOPS_SOURCE ? STOPS_SOURCE_LAYER : undefined;
}

/** The source a focus kind's features live in. */
function sourceFor(kind: 'stop' | 'route' | 'vehicle'): string {
  if (kind === 'route') {
    return ROUTES_SOURCE;
  }
  return kind === 'stop' ? STOPS_SOURCE : VEHICLES_SOURCE;
}

function corners(
  box: [number, number, number, number] | null
): [[number, number], [number, number]] | null {
  return box
    ? [
        [box[0], box[1]],
        [box[2], box[3]],
      ]
    : null;
}
