import * as maplibregl from 'maplibre-gl';
import type { GTFSScheduled } from '../gtfs/scheduled';
import type { VehiclePosition } from '../gtfs/rt-types';
import {
  BasemapControl,
  initialMapStyle,
  onBasemapChanged,
} from './basemap-control';
import type { MapAppearance } from './basemap-control';
import { AutoZoom } from './auto-zoom';
import { MAP_MAX_ZOOM } from './basemap-styles';
import { fitPadding } from './fit-padding';
import { SearchPlaceMarker } from './place-search';
import type { PlacePayload } from './place-search';
import {
  LayerManager,
  type MapDataIssues,
  type MapFocusTarget,
  type VehicleExtra,
} from './layer-manager';

/** Minimum zoom a stop or vehicle focus eases in to. */
const STOP_FOCUS_ZOOM = 16;
const FOCUS_POINT_DURATION = 1500;
const FOCUS_BOUNDS_DURATION = 2000;
/** Ease length for each follow re-centre; shorter than a position push. */
const FOLLOW_DURATION = 300;
const VIEW_SAVE_DEBOUNCE = 400;
/** Max zoom when framing a route or any other bounded focus. */
const FOCUS_MAX_ZOOM = 15;

interface RtMapOptions<V extends VehiclePosition, X extends object> {
  /** localStorage key for the camera view. */
  viewKey: string;
  /** localStorage key for the basemap appearance. */
  appearanceKey: string;
  /** Vite-built maplibre worker (`maplibre-gl-worker.mjs?worker&url`). */
  workerUrl: string;
  /** Extra per-vehicle data carried on the vehicle feature. */
  vehicleExtra?: VehicleExtra<V, X>;
}

interface MapView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

const DEFAULT_VIEW: MapView = {
  center: [0, 30],
  zoom: 2,
  bearing: 0,
  pitch: 0,
};

type Bounds = [[number, number], [number, number]];

/**
 * Map view and appearance live in localStorage rather than the URL: they are
 * per-device preferences, not part of what a shared link describes.
 */
function readStored<T>(key: string): Partial<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing / quota: the preference simply won't persist.
  }
}

function restoreView(key: string): MapView {
  const stored = readStored<MapView>(key);
  if (
    !stored ||
    !Array.isArray(stored.center) ||
    stored.center.length !== 2 ||
    !stored.center.every(Number.isFinite) ||
    typeof stored.zoom !== 'number'
  ) {
    return DEFAULT_VIEW;
  }
  return {
    center: stored.center as [number, number],
    zoom: stored.zoom,
    bearing: stored.bearing ?? 0,
    pitch: stored.pitch ?? 0,
  };
}

/**
 * MapLibre setup, camera moves, focus and vehicle follow for a realtime map.
 * Generic over the app's page state `S`; a subclass maps a clicked feature to
 * an `S` and an `S` to a focus with the protected `focus*` helpers.
 */
export abstract class RtMapController<
  S,
  V extends VehiclePosition = VehiclePosition,
  X extends object = object,
> {
  protected map!: maplibregl.Map;
  protected layers!: LayerManager<V, X>;
  /** Rings the place picked from search until the next map click. */
  private placeMarker!: SearchPlaceMarker;
  private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private viewSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Height of the mobile bottom sheet, kept out of the camera's way. */
  private bottomPadding = 0;

  /**
   * Flips true exactly once, on the first `load`, and never back. Work issued
   * before that point is queued and flushed in order; nothing else consults
   * `map.loaded()`, which goes false on every dirty frame and would silently
   * drop map updates issued mid-repaint.
   */
  protected ready = false;
  private pending: Array<() => void> = [];

  /** The parsed feed, for subclasses drawing geometry LayerManager does not hold. */
  protected feed: GTFSScheduled | null = null;

  /**
   * The last positions handed to `showVehicles`, held outside `whenLoaded` so a
   * focus that lands before the style is up can still resolve them.
   */
  protected positions: V[] = [];

  /**
   * Resolves the vehicle being followed from each positions push, or null.
   * Set by `focusVehicle`; every other focus clears it, and so does a user
   * camera gesture (see `initialize`).
   */
  private following: ((positions: V[]) => V | undefined) | null = null;

  /**
   * The focus the camera is currently showing. Kept so the auto-zoom refit can
   * re-run the camera move for it the moment the toggle goes back on.
   */
  private currentFocus: S;

  /**
   * Navigation-driven camera moves are suppressed while this is off. The feed
   * fit and the follow ease bypass it deliberately: see `fitFeed` and
   * `showVehicles`.
   */
  protected autoZoom = new AutoZoom(() => this.focus(this.currentFocus));

  /** Called when the user clicks a stop, route, or vehicle on the map. */
  onSelect: ((state: S) => void) | null = null;

  /** Called when the user clicks the map away from any feature. */
  onEmptySelect: (() => void) | null = null;

  constructor(
    private options: RtMapOptions<V, X>,
    home: S
  ) {
    this.currentFocus = home;
  }

  /** The page state a click on a map feature navigates to, or null. */
  protected abstract targetState(target: MapFocusTarget<X>): S | null;

  /** Highlight `state` and move the camera to it, with the `focus*` helpers. */
  protected abstract applyFocus(state: S): void;

  /** Re-add subclass-owned sources and layers after `setStyle` dropped them. */
  protected onStyleRebuilt(): void {}

  initialize(container: string): void {
    const view = restoreView(this.options.viewKey);
    const appearance =
      readStored<MapAppearance>(this.options.appearanceKey) ?? {};

    // maplibre resolves its worker relative to its own module URL, which
    // breaks once Vite bundles or pre-bundles it; point it at a Vite-built copy.
    maplibregl.setWorkerUrl(this.options.workerUrl);
    this.map = new maplibregl.Map({
      container,
      style: initialMapStyle(appearance),
      center: view.center,
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      maxZoom: MAP_MAX_ZOOM,
    });
    // Bottom-left is the only free corner: `#map-controls` covers the top strip
    // and the basemap FAB owns bottom-right.
    this.map.addControl(new maplibregl.NavigationControl(), 'bottom-left');

    this.layers = new LayerManager(this.map, this.options.vehicleExtra);
    this.layers.onSelect = (target) => {
      const state = this.targetState(target);
      if (state) {
        this.onSelect?.(state);
      }
    };
    this.layers.onEmptySelect = () => this.onEmptySelect?.();
    this.placeMarker = new SearchPlaceMarker(this.map);
    this.map.on('click', () => this.placeMarker.clear());

    new BasemapControl(this.map, {
      initial: appearance,
      onAppearanceChange: (next) =>
        writeStored(this.options.appearanceKey, next),
    });

    this.map.once('load', () => {
      this.layers.rebuild();
      this.layers.attachInteraction();
      this.ready = true;
      const queued = this.pending;
      this.pending = [];
      for (const fn of queued) {
        fn();
      }
    });

    // setStyle drops every source and layer we own, so each basemap change
    // has to re-add them. Without it, switching basemaps blanks all GTFS data.
    onBasemapChanged(this.map, () => {
      this.layers.rebuild();
      this.placeMarker.redraw();
      this.onStyleRebuilt();
    });

    this.map.on('moveend', () => this.queueViewSave());

    // A user-initiated camera gesture unlocks follow for the current focus.
    // Programmatic easeTo/fitBounds carry no `originalEvent`, which is what
    // distinguishes them from a real drag/scroll/rotate/pitch, so the follow
    // ease itself never unlocks.
    for (const type of [
      'dragstart',
      'zoomstart',
      'rotatestart',
      'pitchstart',
    ] as const) {
      this.map.on(type, (e) => {
        if ((e as { originalEvent?: unknown }).originalEvent) {
          this.following = null;
        }
      });
    }
  }

  getAutoZoom(): AutoZoom {
    return this.autoZoom;
  }

  isAutoZoomEnabled(): boolean {
    return this.autoZoom.isEnabled();
  }

  /** Feed problems the map found, for the status page. */
  get issues(): MapDataIssues {
    return this.layers.issues;
  }

  private queueViewSave(): void {
    if (this.viewSaveTimeout) {
      clearTimeout(this.viewSaveTimeout);
    }
    this.viewSaveTimeout = setTimeout(() => {
      const center = this.map.getCenter();
      writeStored(this.options.viewKey, {
        center: [center.lng, center.lat],
        zoom: this.map.getZoom(),
        bearing: this.map.getBearing(),
        pitch: this.map.getPitch(),
      } satisfies MapView);
      this.viewSaveTimeout = null;
    }, VIEW_SAVE_DEBOUNCE);
  }

  protected whenLoaded(fn: () => void): void {
    if (this.ready) {
      fn();
    } else {
      this.pending.push(fn);
    }
  }

  loadScheduledFeed(feed: GTFSScheduled): void {
    this.feed = feed;
    this.whenLoaded(() => {
      this.layers.setScheduledFeed(feed);
      this.fitFeed();
    });
  }

  clearScheduledFeed(): void {
    this.feed = null;
    this.whenLoaded(() => this.layers.setScheduledFeed(null));
  }

  showVehicles(positions: V[]): void {
    this.positions = positions;
    this.whenLoaded(() => {
      this.layers.setVehicles(positions);
      // Follow: re-centre on the followed vehicle's new position. If it has
      // gone, leave the camera where it is; the page says so in words. Ungated
      // by auto-zoom: pressing Follow is a request for camera movement, not a
      // navigation.
      const v = this.following?.(positions);
      if (v) {
        this.map.easeTo({
          center: [v.lon, v.lat],
          duration: FOLLOW_DURATION,
          essential: true,
        });
      }
    });
  }

  clearVehicles(): void {
    this.positions = [];
    this.whenLoaded(() => this.layers.setVehicles([]));
  }

  /**
   * Frame the loaded feed. Every schedule load refits, reloads included.
   *
   * Instant, with no duration: on the boot path a deep link's focus ease runs
   * right after this and would visibly interrupt an animated fit.
   *
   * Ungated by auto-zoom, matching gtfs-zone-editor's feed-load exemption: a
   * freshly loaded feed has to frame itself or the map opens on nothing.
   */
  private fitFeed(): void {
    const bounds = this.layers.feedBounds();
    if (!bounds) {
      return;
    }
    this.map.fitBounds(bounds, { padding: this.padding() });
  }

  private padding(): maplibregl.PaddingOptions {
    return fitPadding(this.map, 40, this.bottomPadding);
  }

  /**
   * Reserve space at the bottom of the map for the mobile bottom sheet, so a
   * focused feature isn't hidden behind it.
   */
  setBottomPadding(px: number): void {
    this.bottomPadding = px;
  }

  // ── Focus ──────────────────────────────────────────────────────────────────

  /** Move to a place picked from search and ring it. */
  focusPlace(place: PlacePayload): void {
    this.whenLoaded(() => this.placeMarker.focus(place, this.padding()));
  }

  /** Biases the place search towards what is on screen. */
  getCenter(): { lng: number; lat: number } {
    return this.map.getCenter();
  }

  /**
   * Highlight the focused object and move the camera to it. Called for every
   * focus change, including one restored from a link.
   */
  focus(state: S): void {
    this.currentFocus = state;
    this.whenLoaded(() => {
      // Only `focusVehicle` re-arms follow; every other focus leaves it.
      this.following = null;
      this.applyFocus(state);
    });
  }

  /**
   * Light up a stop the pointer is over elsewhere in the app (a route strip
   * row). Purely visual: no camera move, no focus change, no spotlight. Not
   * wrapped in `whenLoaded`: a hover queued behind style load would fire long
   * after the pointer left.
   */
  hoverStop(stop_id: string | null): void {
    this.layers?.setHoveredStop(stop_id);
  }

  /**
   * Repaint the accent-colored map layers against the now-active theme. The
   * accent is resolved from the DaisyUI palette, so it only changes here.
   */
  refreshAccentColor(): void {
    this.layers?.refreshAccentColor();
  }

  /** Unfocus and frame the whole feed, mirroring how a route frames itself. */
  protected focusHome(): void {
    this.layers.setFocus(null);
    const bounds = this.layers.feedBounds();
    if (bounds) {
      this.autoZoom.fitBounds(this.map, new maplibregl.LngLatBounds(bounds), {
        padding: this.padding(),
        duration: FOCUS_BOUNDS_DURATION,
        essential: true,
      });
    }
  }

  /** Clear the highlight and leave the camera where the reader left it. */
  protected focusNone(): void {
    this.layers.setFocus(null);
  }

  protected focusRoute(routeId: string): void {
    this.layers.setFocus({ kind: 'route', id: routeId });
    this.fitFocusBounds(this.layers.routeBounds(routeId));
  }

  protected focusStop(stopId: string): void {
    this.layers.setFocus({ kind: 'stop', id: stopId });
    this.easeToPoint(this.layers.focusPosition(stopId));
  }

  /**
   * Spotlight a vehicle, ease to it and follow it on every positions push.
   * `resolve` picks the followed vehicle from the latest positions. `key`
   * spotlights a vehicle before it has reported; without it the spotlight goes
   * on whatever `resolve` finds now.
   */
  protected focusVehicle(
    resolve: (positions: V[]) => V | undefined,
    key?: string
  ): void {
    const vehicle = resolve(this.positions);
    const id = key ?? vehicle?.key;
    this.layers.setFocus(id ? { kind: 'vehicle', id } : null);
    this.following = resolve;
    if (vehicle) {
      this.easeToPoint([vehicle.lon, vehicle.lat]);
    }
  }

  /** Frame bounds whenever auto-zoom allows it. */
  protected fitFocusBounds(bounds: Bounds | null): void {
    if (!bounds) {
      return;
    }
    // AutoZoom takes a real LngLatBounds; callers hand back the corner tuple.
    this.autoZoom.fitBounds(this.map, new maplibregl.LngLatBounds(bounds), {
      padding: this.padding(),
      maxZoom: FOCUS_MAX_ZOOM,
      duration: FOCUS_BOUNDS_DURATION,
      essential: true,
    });
  }

  /**
   * Ease to a point whenever auto-zoom allows it. Focusing something always
   * moves the camera to it, even when it is already visible, so a panel click
   * never feels like it did nothing.
   */
  private easeToPoint(point: [number, number] | null): void {
    if (!point) {
      return;
    }
    this.autoZoom.easeTo(this.map, {
      center: point,
      zoom: Math.max(this.map.getZoom(), STOP_FOCUS_ZOOM),
      padding: { top: 0, left: 0, right: 0, bottom: this.bottomPadding },
      duration: FOCUS_POINT_DURATION,
      essential: true,
    });
  }

  // ── Sizing ─────────────────────────────────────────────────────────────────

  /** Immediate resize, called on every frame of a panel drag. */
  resizeNow(): void {
    this.map?.resize();
  }

  /**
   * Deferred resize for after a CSS transition settles. Restores center and
   * zoom so the viewport doesn't jump when the canvas changes size.
   */
  forceMapResize(): void {
    if (!this.map) {
      return;
    }

    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    this.resizeTimeout = setTimeout(() => {
      const center = this.map.getCenter();
      const zoom = this.map.getZoom();

      this.map.resize();
      this.map.setCenter(center);
      this.map.setZoom(zoom);

      this.resizeTimeout = null;
    }, 350);
  }
}
