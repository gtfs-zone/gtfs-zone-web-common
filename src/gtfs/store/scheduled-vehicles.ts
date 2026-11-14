/**
 * Vehicle positions simulated from the timetable, for feeds without realtime.
 *
 * Per service date, the trips running that day (calendar + calendar_dates,
 * frequencies expanded into instances) are indexed once as
 * [first departure, last arrival], sorted by start. A query takes the runs
 * covering a second and places each one by time: at a stop between its
 * arrival and departure, otherwise between two stops along the trip's shape
 * (see `along-shape.ts`), or on the straight line between them when the
 * trip has no usable shape.
 *
 * Built lazily per store and rebuilt when the store is edited.
 */

import type { FeedStore } from './feed-store';
import { clockSeconds } from './columns';
import type { TripTimes } from './patterns';
import {
  bearingOf,
  metres,
  pointAt,
  shapeLine,
  stopDistances,
  type ShapeLine,
} from './along-shape';

/** A service date and the seconds since its service day start (noon - 12h). */
export interface ServiceWindow {
  date: string;
  seconds: number;
}

interface ScheduledVehicle {
  /** Unique per run: trip, service date and, for frequency trips, start time. */
  key: string;
  tripId: string;
  routeId: string;
  directionId: string;
  startDate: string;
  /** Start of a frequencies.txt instance (HH:MM:SS); absent for other trips. */
  startTime?: string;
  lon: number;
  lat: number;
  /** Degrees clockwise from north, toward the next stop. */
  bearing?: number;
  stopId: string;
  stopSequence: string;
  /** VehicleStopStatus: 1 STOPPED_AT, 2 IN_TRANSIT_TO. */
  status: 1 | 2;
}

interface ScheduledVehicles {
  vehicles: ScheduledVehicle[];
  /** Runs found before the cap cut the list. */
  running: number;
}

const SCHEDULED_VEHICLE_CAP = 5000;

/** Dates kept indexed; a tick only touches today and yesterday. */
const DAY_CACHE = 4;

/** Shape points kept decoded across ticks, least recently used dropped first. */
const SHAPE_CACHE_POINTS = 4_000_000;

interface Run {
  start: number;
  end: number;
  tripId: string;
  routeId: string;
  directionId: string;
  shapeId: string;
  /** Seconds added to the trip's times (frequency instances; 0 otherwise). */
  offset: number;
  startTime?: string;
}

interface DayIndex {
  /** Sorted by start. */
  runs: Run[];
  /** Longest run, to bound the search back from a second. */
  maxSpan: number;
}

interface CalendarRow {
  serviceId: string;
  start: string;
  end: string;
  /** Sunday first, as `Date.getUTCDay()`. */
  days: boolean[];
}

interface Frequency {
  start: number;
  end: number;
  headway: number;
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

class Simulator {
  readonly editCount: number;
  private days = new Map<string, DayIndex>();
  private stopPos = new Map<string, [number, number]>();
  private calendar: CalendarRow[] = [];
  private frequencies = new Map<string, Frequency[]>();
  private lines = new Map<string, ShapeLine | null>();
  private linePoints = 0;
  /** Stop metres along the shape per stop list + shape; null for straight lines. */
  private tracks = new Map<string, Float64Array | null>();
  /** Stop lists placed since the last log: how, and why not along the shape. */
  private placed = new Map<string, number>();
  private fallbacks = new Map<string, number>();

  constructor(private store: FeedStore) {
    this.editCount = store.editCount;
    this.readStops();
    this.store.scan(
      'calendar',
      ['service_id', 'start_date', 'end_date', ...WEEKDAYS],
      ([serviceId, start, end, ...days]) => {
        this.calendar.push({
          serviceId,
          start,
          end,
          days: days.map((d) => d === '1'),
        });
      }
    );
    let badHeadways = 0;
    this.store.scan(
      'frequencies',
      ['trip_id', 'start_time', 'end_time', 'headway_secs'],
      ([tripId, start, end, headway]) => {
        const f = {
          start: clockSeconds(start),
          end: clockSeconds(end),
          headway: Number(headway),
        };
        if (
          !Number.isFinite(f.start) ||
          !Number.isFinite(f.end) ||
          !(f.headway > 0)
        ) {
          badHeadways++;
          return;
        }
        let list = this.frequencies.get(tripId);
        if (!list) {
          this.frequencies.set(tripId, (list = []));
        }
        list.push(f);
      }
    );
    if (badHeadways) {
      console.warn(
        `[ScheduledVehicles] skipped ${badHeadways} frequencies rows without valid times or headway_secs`
      );
    }
    console.log(
      `[ScheduledVehicles] ready: ${this.stopPos.size} stops placed, ${this.calendar.length} calendar rows, ${this.frequencies.size} frequency trips`
    );
  }

  /** Stop coordinates, falling back to the parent station's. */
  private readStops(): void {
    const parents = new Map<string, string>();
    this.store.scan(
      'stops',
      ['stop_id', 'stop_lon', 'stop_lat', 'parent_station'],
      ([id, lon, lat, parent]) => {
        const x = parseFloat(lon);
        const y = parseFloat(lat);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          this.stopPos.set(id, [x, y]);
        } else if (parent) {
          parents.set(id, parent);
        }
      }
    );
    for (const [id, parent] of parents) {
      const p = this.stopPos.get(parent);
      if (p) {
        this.stopPos.set(id, p);
      }
    }
  }

  /** Service ids active on a `YYYYMMDD` date. */
  private activeServices(date: string): Set<string> {
    const out = new Set<string>();
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(date);
    if (!m) {
      throw new Error(`[ScheduledVehicles] bad service date ${date}`);
    }
    const weekday = new Date(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    ).getUTCDay();
    for (const c of this.calendar) {
      if (c.days[weekday] && c.start <= date && date <= c.end) {
        out.add(c.serviceId);
      }
    }
    if (this.store.hasTable('calendar_dates')) {
      for (const { row } of this.store.find('calendar_dates', 'date', date)) {
        if (row.exception_type === '1') {
          out.add(row.service_id);
        } else if (row.exception_type === '2') {
          out.delete(row.service_id);
        }
      }
    }
    return out;
  }

  private day(date: string): DayIndex {
    const cached = this.days.get(date);
    if (cached) {
      // Re-insert to mark it most recently used.
      this.days.delete(date);
      this.days.set(date, cached);
      return cached;
    }
    const t0 = performance.now();
    const services = this.activeServices(date);
    const runs: Run[] = [];
    let untimed = 0;
    this.store.scan(
      'trips',
      ['trip_id', 'service_id', 'route_id', 'direction_id', 'shape_id'],
      ([tripId, serviceId, routeId, directionId, shapeId]) => {
        if (!services.has(serviceId)) {
          return;
        }
        const tt = this.store.tripTimes(tripId);
        if (!tt || tt.stopIds.length < 2) {
          return;
        }
        const n = tt.stopIds.length;
        // The vehicle is shown from its first arrival to its last departure;
        // frequency instances count from the first departure.
        const first = pick(tt.dep[0], tt.arr[0]);
        const from = pick(tt.arr[0], tt.dep[0]);
        const to = pick(tt.dep[n - 1], tt.arr[n - 1]);
        if (!Number.isFinite(first) || !Number.isFinite(to)) {
          untimed++;
          return;
        }
        const freqs = this.frequencies.get(tripId);
        if (!freqs) {
          runs.push({
            start: from,
            end: to,
            tripId,
            routeId,
            directionId,
            shapeId,
            offset: 0,
          });
          return;
        }
        for (const f of freqs) {
          for (let s = f.start; s < f.end; s += f.headway) {
            runs.push({
              start: s + from - first,
              end: s + to - first,
              tripId,
              routeId,
              directionId,
              shapeId,
              offset: s - first,
              startTime: formatClock(s),
            });
          }
        }
      }
    );
    runs.sort((a, b) => a.start - b.start);
    let maxSpan = 0;
    for (const r of runs) {
      maxSpan = Math.max(maxSpan, r.end - r.start);
    }
    if (untimed) {
      console.warn(
        `[ScheduledVehicles] ${date}: skipped ${untimed} trips without a first or last time`
      );
    }
    console.log(
      `[ScheduledVehicles] ${date}: ${services.size} services, ${runs.length} runs indexed in ${Math.round(performance.now() - t0)}ms`
    );
    const index = { runs, maxSpan };
    this.days.set(date, index);
    if (this.days.size > DAY_CACHE) {
      this.days.delete(this.days.keys().next().value!);
    }
    return index;
  }

  /** Runs covering `seconds` of the service day `date`. */
  private running(date: string, seconds: number): Run[] {
    const { runs, maxSpan } = this.day(date);
    const from = seconds - maxSpan;
    let lo = 0;
    let hi = runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (runs[mid].start < from) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const out: Run[] = [];
    for (let i = lo; i < runs.length && runs[i].start <= seconds; i++) {
      if (runs[i].end >= seconds) {
        out.push(runs[i]);
      }
    }
    return out;
  }

  vehicles(windows: ServiceWindow[], cap: number): ScheduledVehicles {
    const found: [ServiceWindow, Run][] = [];
    for (const w of windows) {
      for (const run of this.running(w.date, w.seconds)) {
        found.push([w, run]);
      }
    }
    const vehicles: ScheduledVehicle[] = [];
    for (const [w, run] of found) {
      if (vehicles.length >= cap) {
        break;
      }
      const v = this.place(run, w, w.seconds - run.offset);
      if (v) {
        vehicles.push(v);
      }
    }
    if (found.length > cap) {
      console.warn(
        `[ScheduledVehicles] ${found.length} runs, capped to ${cap}`
      );
    }
    for (const [by, n] of this.placed) {
      console.log(`[ScheduledVehicles] ${n} stop lists placed by ${by}`);
    }
    for (const [reason, n] of this.fallbacks) {
      console.warn(
        `[ScheduledVehicles] ${n} stop lists drawn stop to stop: ${reason}`
      );
    }
    this.placed.clear();
    this.fallbacks.clear();
    return { vehicles, running: found.length };
  }

  /** A shape's polyline, decoded once and kept while it fits the cache. */
  private line(shapeId: string): ShapeLine | null {
    if (this.lines.has(shapeId)) {
      const cached = this.lines.get(shapeId)!;
      this.lines.delete(shapeId);
      this.lines.set(shapeId, cached);
      return cached;
    }
    const line = shapeLine(this.store.shapeCoords(shapeId));
    this.lines.set(shapeId, line);
    this.linePoints += line?.m.length ?? 0;
    for (const [id, l] of this.lines) {
      if (this.linePoints <= SHAPE_CACHE_POINTS || id === shapeId) {
        break;
      }
      this.lines.delete(id);
      this.linePoints -= l?.m.length ?? 0;
    }
    return line;
  }

  /**
   * Metres along the shape of each of the trip's stops, cached per stop
   * list and shape. Null when the trip is drawn stop to stop.
   */
  private track(
    run: Run,
    tt: TripTimes,
    pos: ([number, number] | null)[]
  ): Float64Array | null {
    if (!run.shapeId) {
      return null;
    }
    const key = `${this.store.stopListKey(run.tripId)}\n${run.shapeId}`;
    if (this.tracks.has(key)) {
      return this.tracks.get(key)!;
    }
    // Read with shape_dist_traveled, which the cached line leaves out.
    const line = shapeLine(
      this.store.shapeCoords(run.shapeId),
      this.store.shapeDists(run.shapeId)
    );
    let along: Float64Array | null = null;
    if (!line) {
      this.fallback('shape_id with fewer than two points in shapes.txt');
    } else {
      const r = stopDistances(line, tt.dist, pos);
      if (r.along) {
        along = r.along;
        const by =
          r.by === 'dist' ? 'shape_dist_traveled' : 'projection onto the shape';
        this.placed.set(by, (this.placed.get(by) ?? 0) + 1);
      } else {
        this.fallback(r.reason);
      }
    }
    this.tracks.set(key, along);
    return along;
  }

  private fallback(reason: string): void {
    this.fallbacks.set(reason, (this.fallbacks.get(reason) ?? 0) + 1);
  }

  /** The run's position at second `t` of its trip's own times. */
  private place(
    run: Run,
    w: ServiceWindow,
    t: number
  ): ScheduledVehicle | null {
    const tt = this.store.tripTimes(run.tripId);
    if (!tt) {
      return null;
    }
    const pos = tt.stopIds.map((id) => this.stopPos.get(id) ?? null);
    const along = this.track(run, tt, pos);
    const line = along ? this.line(run.shapeId) : null;
    fillTimes(tt, pos, along);
    // Only stops with times and a place (on the shape, else coordinates)
    // can carry the vehicle.
    const rows: number[] = [];
    for (let i = 0; i < pos.length; i++) {
      if ((line || pos[i]) && Number.isFinite(tt.arr[i])) {
        rows.push(i);
      }
    }
    if (!rows.length) {
      return null;
    }
    const base = {
      key: `sched:${run.tripId}:${w.date}${run.startTime ? `:${run.startTime}` : ''}`,
      tripId: run.tripId,
      routeId: run.routeId,
      directionId: run.directionId,
      startDate: w.date,
      startTime: run.startTime,
    };
    const vehicle = (
      i: number,
      status: 1 | 2,
      lonLat: [number, number],
      bearing: number | undefined
    ): ScheduledVehicle => ({
      ...base,
      lon: lonLat[0],
      lat: lonLat[1],
      bearing,
      stopId: tt.stopIds[i],
      stopSequence: tt.stopSequences[i],
      status,
    });
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k];
      const last = k === rows.length - 1;
      if (!last && t > tt.dep[i]) {
        continue;
      }
      if (k === 0 || t >= tt.arr[i]) {
        // At the stop, facing the next one; no bearing at the last stop.
        if (line) {
          const p = pointAt(line, along![i]);
          return vehicle(i, 1, p.lonLat, last ? undefined : p.bearing);
        }
        const next = rows[k + 1];
        return vehicle(
          i,
          1,
          pos[i]!,
          last ? undefined : bearingOf(pos[i]!, pos[next]!)
        );
      }
      // Between the previous stop's departure and this stop's arrival.
      const h = rows[k - 1];
      const span = tt.arr[i] - tt.dep[h];
      const f = span > 0 ? clamp((t - tt.dep[h]) / span) : 1;
      const arrived = f >= 1 && last;
      if (line) {
        const p = pointAt(line, along![h] + (along![i] - along![h]) * f);
        return vehicle(i, 2, p.lonLat, arrived ? undefined : p.bearing);
      }
      const a = pos[h]!;
      const b = pos[i]!;
      const at: [number, number] = [
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
      ];
      return vehicle(i, 2, at, f < 1 ? bearingOf(at, b) : undefined);
    }
    return null;
  }
}

const sims = new WeakMap<FeedStore, Simulator>();

/**
 * Scheduled vehicles running at each window, at most `cap` of them. The
 * main thread builds the windows, since only it knows the feed's zone.
 */
export function scheduledVehicles(
  store: FeedStore,
  windows: ServiceWindow[],
  cap = SCHEDULED_VEHICLE_CAP
): ScheduledVehicles {
  let sim = sims.get(store);
  if (!sim || sim.editCount !== store.editCount) {
    sim = new Simulator(store);
    sims.set(store, sim);
  }
  return sim.vehicles(windows, cap);
}

function pick(a: number, b: number): number {
  return Number.isFinite(a) ? a : b;
}

function clamp(f: number): number {
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

function formatClock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

/**
 * Fill empty times in place: a lone arrival or departure stands for both,
 * and stops with neither are interpolated between the known stops around
 * them, by metres along the shape when the trip has a track, else by
 * shape_dist_traveled when every stop in the gap has it, else by
 * straight-line distance, else evenly.
 */
function fillTimes(
  tt: TripTimes,
  pos: ([number, number] | null)[],
  along: Float64Array | null
): void {
  const { arr, dep, dist } = tt;
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(arr[i])) {
      arr[i] = dep[i];
    } else if (Number.isNaN(dep[i])) {
      dep[i] = arr[i];
    }
  }
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(arr[i])) {
      continue;
    }
    if (prev >= 0 && i - prev > 1) {
      const gap = gapDistances(prev, i, along ?? dist, pos);
      const total = gap[gap.length - 1];
      for (let k = prev + 1; k < i; k++) {
        const f = total > 0 ? gap[k - prev] / total : (k - prev) / (i - prev);
        arr[k] = dep[k] = dep[prev] + (arr[i] - dep[prev]) * f;
      }
    }
    prev = i;
  }
}

/** Cumulative distance from stop `a` to each stop up to `b`. */
function gapDistances(
  a: number,
  b: number,
  dist: Float64Array,
  pos: ([number, number] | null)[]
): number[] {
  const out = [0];
  let byShape = true;
  for (let k = a; k <= b; k++) {
    if (!Number.isFinite(dist[k]) || (k > a && dist[k] < dist[k - 1])) {
      byShape = false;
    }
  }
  if (byShape) {
    for (let k = a + 1; k <= b; k++) {
      out.push(dist[k] - dist[a]);
    }
    return out;
  }
  let sum = 0;
  for (let k = a + 1; k <= b; k++) {
    const p = pos[k - 1];
    const q = pos[k];
    if (!p || !q) {
      // One stop without coordinates makes the gap even.
      return new Array<number>(b - a + 1).fill(0);
    }
    sum += metres(p, q);
    out.push(sum);
  }
  return out;
}
