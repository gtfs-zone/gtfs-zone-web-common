import { routeColor, routeTextColor, setFeedRouteColors } from './route-colors';
import {
  FeedStoreClient,
  type FeedSummary,
  type LoadProgress,
  type RouteGeometry,
  type Row,
  type StopTimesMode,
  type StoreInput,
} from './store/store-client';

/** Verbatim CSV rows, kept so object pages can dump every column. */
export type RawRow = Record<string, string>;

/**
 * Every entity keeps its parsed convenience fields *and* the original CSV row,
 * so an object page can show a typed summary above a verbatim column table.
 * `StopTime` is the exception: it has no object page.
 */
export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  location_type: number;
  parent_station: string;
  raw: RawRow;
}

export interface Route {
  id: string;
  short_name: string;
  long_name: string;
  color: string;
  text_color: string;
  type: number;
  agency_id: string;
  raw: RawRow;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  service_id: string;
  shape_id: string;
  headsign: string;
  direction_id: string;
  raw: RawRow;
}

export interface StopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: number;
  arrival_time: string;
  departure_time: string;
}

/** A trip's stop without times: what route sequences and geometry need. */
export interface StopRef {
  stop_id: string;
  stop_sequence: number;
}

export interface Agency {
  id: string;
  name: string;
  url: string;
  timezone: string;
  raw: RawRow;
}

export interface Calendar {
  service_id: string;
  start_date: string;
  end_date: string;
  /** Monday-first, indexed 0–6. */
  days: boolean[];
  raw: RawRow;
}

export interface CalendarDate {
  service_id: string;
  date: string;
  /** 1 = service added, 2 = service removed. */
  exception_type: number;
  raw: RawRow;
}

export interface FeedInfo {
  publisher_name: string;
  publisher_url: string;
  lang: string;
  version: string;
  raw: RawRow;
}

export interface LoadHooks {
  onProgress?: (progress: LoadProgress) => void;
  /** Aborts the whole load: download and parse. */
  signal?: AbortSignal;
}

/**
 * What is kept on the main thread besides the small tables:
 * - `small`: nothing more; `trips`, `tripsByRoute` and `stopTimesByTrip` hold
 *   only what `loadTrips` / `loadRoute` fetched.
 * - `trips`: every trip, so `trips` and `tripsByRoute` are complete.
 * - `all`: also every stop_time, shape and calendar date. For apps that only
 *   ever load small feeds.
 */
export type MirrorLevel = 'small' | 'trips' | 'all';

export interface ScheduledOptions {
  mirror?: MirrorLevel;
  stopTimes?: StopTimesMode;
  /** Tables not to load, by name without `.txt`. */
  skipTables?: string[];
}

export interface ScheduledCounts {
  stops: number;
  routes: number;
  trips: number;
  shapes: number;
  agencies: number;
  services: number;
  stopTimes: number;
}

/** A CSV column that carried leading/trailing whitespace, and how many rows had it. */
export interface PaddedColumn {
  file: string;
  column: string;
  rows: number;
}

/**
 * Tables kept on the main thread in every mode. The GTFS reference forbids
 * leading and trailing spaces in values, but producers that right-align
 * numeric columns are common (RIPTA stores stop_id as "      5"), so every
 * value is trimmed at parse time and the padding reported in `paddedColumns`.
 */
const SMALL_TABLES = ['agency', 'feed_info', 'calendar', 'stops', 'routes'];
const MIRRORED: Record<MirrorLevel, string[]> = {
  small: SMALL_TABLES,
  trips: [...SMALL_TABLES, 'trips'],
  all: [...SMALL_TABLES, 'trips', 'calendar_dates'],
};

/** Trips whose stop_times `loadTrips` keeps before the oldest are dropped. */
const TRIP_CACHE_LIMIT = 20_000;

const DAY_FIELDS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/**
 * A scheduled feed held by a store worker, with the small tables and the
 * per-feed aggregates kept here for synchronous reads. Fires `dataloaded`
 * when `loadRoute` brings in data a page may be waiting for.
 *
 * Big tables are complete on the main thread as far as the `MirrorLevel`
 * says. Beyond that, `trips` and `stopTimesByTrip` hold the trips fetched by
 * `loadTrips` (the realtime-referenced ones, refreshed per poll), and
 * `tripsByRoute` / `stopRefs` the routes fetched by `loadRoute`.
 */
export class GTFSScheduled extends EventTarget {
  stops = new Map<string, Stop>();
  routes = new Map<string, Route>();
  agencies: Agency[] = [];
  feedInfo: FeedInfo[] = [];
  calendar: Calendar[] = [];
  calendarDates: CalendarDate[] = [];

  trips = new Map<string, Trip>();
  /** Trip stop_times, sorted by `stop_sequence`. */
  stopTimesByTrip = new Map<string, StopTime[]>();
  tripsByRoute = new Map<string, Trip[]>();
  shapes = new Map<string, [number, number][]>();

  /** Trip ids serving a stop, in first-seen order. Filled only when `stopTimesComplete`. */
  stopTrips = new Map<string, string[]>();
  /** Which routes serve a stop (stop_times -> trips), for every stop. */
  routesByStop = new Map<string, Set<string>>();
  tripCountByRoute = new Map<string, number>();
  tripCountByStop = new Map<string, number>();
  /** Each route's distinct lines, shapes or stop-to-stop fallbacks. */
  routeGeometry = new Map<string, RouteGeometry>();

  /** Direct children of each stop, keyed by parent `stop_id`. */
  childrenByParent = new Map<string, string[]>();
  /**
   * Malformed `parent_station` references, surfaced on the status page rather
   * than thrown. A station page aggregates over its children, so a feed that
   * mis-wires the hierarchy is worth reporting.
   */
  stationIssues = { danglingParent: 0, nonStationParent: 0, cyclicStops: 0 };
  /** CSV columns that arrived padded with whitespace and were trimmed. */
  paddedColumns: PaddedColumn[] = [];

  /** Every trip is in `trips` and `tripsByRoute`. */
  readonly tripsComplete: boolean;
  /** Every trip's stop_times is in `stopTimesByTrip`. */
  readonly stopTimesComplete: boolean;

  /** Stop lists of routes fetched by `loadRoute`, per trip. */
  private routeStops = new Map<string, Map<string, StopRef[]>>();
  /** Trips fetched by `loadTrips`, oldest first. */
  private fetched = new Set<string>();
  private summary: FeedSummary;

  private constructor(
    readonly store: FeedStoreClient,
    readonly mirror: MirrorLevel
  ) {
    super();
    this.summary = store.loaded.summary;
    this.tripsComplete = mirror !== 'small';
    this.stopTimesComplete =
      mirror === 'all' && store.loaded.stopTimesMode === 'full';
  }

  static async load(
    input: StoreInput,
    options: ScheduledOptions = {},
    hooks: LoadHooks = {}
  ): Promise<GTFSScheduled> {
    const mirror = options.mirror ?? 'small';
    const store = await FeedStoreClient.load(
      input,
      {
        stopTimes: options.stopTimes,
        skipTables: options.skipTables,
        mirror: MIRRORED[mirror],
      },
      hooks
    );
    try {
      const feed = new GTFSScheduled(store, mirror);
      await feed.ingest();
      return feed;
    } catch (err) {
      store.release();
      throw err;
    }
  }

  /** Terminate the worker. Every async read fails after this. */
  release(): void {
    this.store.release();
  }

  private mirrorRows(table: string): Row[] {
    return [...(this.store.mirror.get(table)?.values() ?? [])];
  }

  private async ingest(): Promise<void> {
    const { stream } = this.store.loaded;
    for (const [key, rows] of Object.entries(stream.padded)) {
      const dot = key.indexOf('.');
      this.paddedColumns.push({
        file: `${key.slice(0, dot)}.txt`,
        column: key.slice(dot + 1),
        rows,
      });
    }
    this.ingestAgencies(this.mirrorRows('agency'));
    this.ingestFeedInfo(this.mirrorRows('feed_info'));
    this.ingestCalendar(this.mirrorRows('calendar'));
    this.ingestStops(this.mirrorRows('stops'));
    this.ingestRoutes(this.mirrorRows('routes'));
    this.buildStationIndex();

    const s = this.summary;
    for (const [stop, routes] of Object.entries(s.routesPerStop)) {
      this.routesByStop.set(stop, new Set(routes));
    }
    this.tripCountByRoute = new Map(Object.entries(s.tripsPerRoute));
    this.tripCountByStop = new Map(Object.entries(s.tripsPerStop));
    for (const g of await this.store.call('routeGeometries')) {
      this.routeGeometry.set(g.routeId, g);
    }

    if (this.tripsComplete) {
      for (const row of this.mirrorRows('trips')) {
        const trip = toTrip(row);
        this.trips.set(trip.trip_id, trip);
        let forRoute = this.tripsByRoute.get(trip.route_id);
        if (!forRoute) {
          this.tripsByRoute.set(trip.route_id, (forRoute = []));
        }
        forRoute.push(trip);
      }
      this.store.mirror.delete('trips');
    }
    if (this.mirror === 'all') {
      this.ingestCalendarDates(this.mirrorRows('calendar_dates'));
      this.store.mirror.delete('calendar_dates');
      if (this.stopTimesComplete) {
        const all = await this.store.call('allStopTimes');
        for (const [tripId, rows] of Object.entries(all)) {
          const times = rows.map(toStopTime);
          this.stopTimesByTrip.set(tripId, times);
          for (const st of times) {
            let trips = this.stopTrips.get(st.stop_id);
            if (!trips) {
              this.stopTrips.set(st.stop_id, (trips = []));
            }
            if (trips[trips.length - 1] !== tripId) {
              trips.push(tripId);
            }
          }
        }
      }
      for (const [id, coords] of Object.entries(
        await this.store.call('allShapes')
      )) {
        const pts: [number, number][] = [];
        for (let i = 0; i < coords.length; i += 2) {
          pts.push([coords[i], coords[i + 1]]);
        }
        this.shapes.set(id, pts);
      }
    }
    console.log(
      `[GTFSScheduled] ready: ${this.stops.size} stops, ${this.routes.size} routes, ${s.counts.trips ?? 0} trips (mirror: ${this.mirror})`
    );
  }

  counts(): ScheduledCounts {
    const c = this.summary.counts;
    return {
      stops: this.stops.size,
      routes: this.routes.size,
      trips: c.trips ?? 0,
      shapes: this.summary.shapeCount,
      agencies: this.agencies.length,
      services: this.calendar.length,
      stopTimes: c.stop_times ?? 0,
    };
  }

  /**
   * Fetch trips and their stop_times into `trips` / `stopTimesByTrip`. A no-op
   * when both are already complete. The most recently requested trips are
   * kept; older ones are dropped (from `trips` too, unless it is complete).
   */
  async loadTrips(tripIds: Iterable<string>): Promise<void> {
    if (this.stopTimesComplete) {
      return;
    }
    const want: string[] = [];
    for (const id of new Set(tripIds)) {
      if (this.fetched.has(id)) {
        // Refresh its place in the eviction order.
        this.fetched.delete(id);
        this.fetched.add(id);
      } else {
        want.push(id);
      }
    }
    if (want.length) {
      const info = await this.store.call('tripsInfo', want);
      for (const id of want) {
        const row = info.trips[id];
        if (row && !this.tripsComplete) {
          this.trips.set(id, toTrip(row));
        }
        const st = info.stopTimes[id];
        if (st?.length) {
          this.stopTimesByTrip.set(id, st.map(toStopTime));
        }
        this.fetched.add(id);
      }
    }
    for (const id of this.fetched) {
      if (this.fetched.size <= TRIP_CACHE_LIMIT) {
        break;
      }
      this.fetched.delete(id);
      this.stopTimesByTrip.delete(id);
      if (!this.tripsComplete) {
        this.trips.delete(id);
      }
    }
  }

  /** Whether `tripsByRoute` and `stopRefs` are complete for a route. */
  routeLoaded(routeId: string): boolean {
    return this.stopTimesComplete || this.routeStops.has(routeId);
  }

  /**
   * Fetch a route's trips and their stop lists, for `tripsByRoute` and
   * `stopRefs`, then fire `dataloaded`. A no-op when they are already here.
   */
  async loadRoute(routeId: string): Promise<void> {
    if (this.routeLoaded(routeId)) {
      return;
    }
    const r = await this.store.call('routeTrips', routeId);
    const lists = r.stopLists.map((l) =>
      l.map((s) => ({
        stop_id: s.stop_id,
        stop_sequence: parseInt(s.stop_sequence),
      }))
    );
    const trips: Trip[] = [];
    const stops = new Map<string, StopRef[]>();
    r.trips.forEach((row, i) => {
      const trip = toTrip(row);
      trips.push(trip);
      if (r.tripList[i] >= 0) {
        stops.set(trip.trip_id, lists[r.tripList[i]]);
      }
    });
    if (!this.tripsComplete) {
      this.tripsByRoute.set(routeId, trips);
    }
    this.routeStops.set(routeId, stops);
    console.log(
      `[GTFSScheduled] route ${routeId}: ${trips.length} trips loaded`
    );
    this.dispatchEvent(new Event('dataloaded'));
  }

  /**
   * A trip's stops in order: from `stopTimesByTrip`, else from a route
   * fetched by `loadRoute`. Undefined when neither has the trip.
   */
  stopRefs(tripId: string, routeId?: string): StopRef[] | undefined {
    const times = this.stopTimesByTrip.get(tripId);
    if (times) {
      return times;
    }
    if (routeId !== undefined) {
      return this.routeStops.get(routeId)?.get(tripId);
    }
    for (const stops of this.routeStops.values()) {
      const hit = stops.get(tripId);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

  /** Every stop a route serves, by stop_times. */
  stopsForRoute(routeId: string): string[] {
    const out: string[] = [];
    for (const [stop, routes] of this.routesByStop) {
      if (routes.has(routeId)) {
        out.push(stop);
      }
    }
    return out;
  }

  /**
   * Index the station hierarchy and count malformed `parent_station` links.
   *
   * Spec: a platform / entrance / generic node (`location_type` 0 / 2 / 3) has a
   * station (type 1) parent; a boarding area (type 4) has a platform (type 0)
   * parent. Anything else is a feed defect: counted, not thrown.
   */
  private buildStationIndex(): void {
    const expectedParentType: Record<number, number> = {
      0: 1,
      2: 1,
      3: 1,
      4: 0,
    };
    for (const stop of this.stops.values()) {
      const parentId = stop.parent_station;
      if (!parentId) {
        continue;
      }
      const parent = this.stops.get(parentId);
      if (!parent) {
        this.stationIssues.danglingParent++;
        continue;
      }
      const expected = expectedParentType[stop.location_type];
      if (expected !== undefined && parent.location_type !== expected) {
        this.stationIssues.nonStationParent++;
      }
      let children = this.childrenByParent.get(parentId);
      if (!children) {
        this.childrenByParent.set(parentId, (children = []));
      }
      children.push(stop.id);
    }

    // A parent_station cycle would hang descendants(); count the stops caught
    // in one so the traversal's visited-guard is a reported fact, not a silent
    // save.
    for (const stop of this.stops.values()) {
      const seen = new Set<string>([stop.id]);
      let current: string | undefined = stop.parent_station;
      while (current && this.stops.has(current)) {
        if (seen.has(current)) {
          this.stationIssues.cyclicStops++;
          break;
        }
        seen.add(current);
        current = this.stops.get(current)?.parent_station;
      }
    }
  }

  /** Walk `parent_station` to the topmost ancestor, guarding against cycles. */
  stationRoot(stopId: string): string {
    const seen = new Set<string>([stopId]);
    let current = stopId;
    for (;;) {
      const parent = this.stops.get(current)?.parent_station;
      if (!parent || !this.stops.has(parent) || seen.has(parent)) {
        return current;
      }
      seen.add(parent);
      current = parent;
    }
  }

  /** Every stop beneath `stopId` in the hierarchy, recursive, cycle-guarded. */
  descendants(stopId: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([stopId]);
    const stack = [...(this.childrenByParent.get(stopId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      out.push(id);
      for (const child of this.childrenByParent.get(id) ?? []) {
        if (!seen.has(child)) {
          stack.push(child);
        }
      }
    }
    return out;
  }

  /** Boardable descendants only (`location_type` 0): the service-bearing ones. */
  boardableDescendants(stopId: string): string[] {
    return this.descendants(stopId).filter(
      (id) => this.stops.get(id)?.location_type === 0
    );
  }

  /** The stop's own position, or the nearest ancestor's with valid coordinates. */
  resolvedPosition(stopId: string): [number, number] | null {
    const seen = new Set<string>();
    let current: string | undefined = stopId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const stop = this.stops.get(current);
      if (!stop) {
        return null;
      }
      if (Number.isFinite(stop.lat) && Number.isFinite(stop.lon)) {
        return [stop.lon, stop.lat];
      }
      current = stop.parent_station;
    }
    return null;
  }

  private ingestAgencies(rows: RawRow[]): void {
    this.agencies = rows.map((row) => ({
      id: row.agency_id ?? '',
      name: row.agency_name ?? '',
      url: row.agency_url ?? '',
      timezone: row.agency_timezone ?? '',
      raw: row,
    }));
  }

  private ingestFeedInfo(rows: RawRow[]): void {
    this.feedInfo = rows.map((row) => ({
      publisher_name: row.feed_publisher_name ?? '',
      publisher_url: row.feed_publisher_url ?? '',
      lang: row.feed_lang ?? '',
      version: row.feed_version ?? '',
      raw: row,
    }));
  }

  private ingestCalendar(rows: RawRow[]): void {
    this.calendar = rows.map((row) => ({
      service_id: row.service_id,
      start_date: row.start_date ?? '',
      end_date: row.end_date ?? '',
      days: DAY_FIELDS.map((d) => row[d] === '1'),
      raw: row,
    }));
  }

  private ingestCalendarDates(rows: RawRow[]): void {
    this.calendarDates = rows.map((row) => ({
      service_id: row.service_id,
      date: row.date ?? '',
      exception_type: parseInt(row.exception_type ?? '1'),
      raw: row,
    }));
  }

  private ingestStops(rows: RawRow[]): void {
    for (const row of rows) {
      this.stops.set(row.stop_id, {
        id: row.stop_id,
        name: row.stop_name ?? '',
        lat: parseFloat(row.stop_lat),
        lon: parseFloat(row.stop_lon),
        location_type: parseInt(row.location_type || '0'),
        parent_station: row.parent_station ?? '',
        raw: row,
      });
    }
  }

  private ingestRoutes(rows: RawRow[]): void {
    setFeedRouteColors(rows.map((row) => row.route_color));
    for (const row of rows) {
      // A feed that omits route_color gets a hue hashed from its route_id, so
      // colorless routes are still told apart on the map instead of all
      // rendering in one flat house color. See utils/route-colors.ts.
      const color = routeColor(row.route_id, row.route_color);
      const type = parseInt(row.route_type ?? '3');
      if (Number.isNaN(type)) {
        console.warn(
          `[GTFSScheduled] Route ${row.route_id} has a non-numeric route_type ${JSON.stringify(row.route_type)}`
        );
      }
      this.routes.set(row.route_id, {
        id: row.route_id,
        short_name: row.route_short_name ?? '',
        long_name: row.route_long_name ?? '',
        color,
        text_color: routeTextColor(color, row.route_text_color),
        type,
        agency_id: row.agency_id ?? '',
        raw: row,
      });
    }
  }
}

function toTrip(row: RawRow): Trip {
  return {
    trip_id: row.trip_id,
    route_id: row.route_id,
    service_id: row.service_id ?? '',
    shape_id: row.shape_id ?? '',
    headsign: row.trip_headsign ?? '',
    direction_id: row.direction_id ?? '',
    raw: row,
  };
}

// `stop_sequence` is a string in the CSV and must be compared numerically:
// '10' < '9' lexically, which would scramble every trip.
function toStopTime(row: RawRow): StopTime {
  return {
    trip_id: row.trip_id,
    stop_id: row.stop_id ?? '',
    stop_sequence: parseInt(row.stop_sequence ?? '0'),
    arrival_time: row.arrival_time ?? '',
    departure_time: row.departure_time ?? '',
  };
}
