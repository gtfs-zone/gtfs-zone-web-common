/**
 * Distances of a trip's stops along its shape, and points at a distance.
 *
 * Every distance here is in metres along the shape's polyline. Stops are
 * placed by shape_dist_traveled when the trip and the shape both carry it,
 * else by projecting each stop onto the shape in order (a best fit over the
 * whole stop list, so a loop that passes a stop twice keeps it in sequence).
 */

/** A shape as a polyline with cumulative metres. */
export interface ShapeLine {
  lon: Float64Array;
  lat: Float64Array;
  /** Metres from the first point. */
  m: Float64Array;
  /** shape_dist_traveled per point (NaN when empty); null when not read. */
  dist: Float64Array | null;
}

/** Stops further than this from their shape make the trip fall back to straight lines. */
const MAX_STOP_OFFSET_M = 500;

/**
 * Cost per metre between the first stop and the shape's start, and between
 * the last stop and its end. Small next to the stop offsets, it only decides
 * near-ties, such as a loop that starts and ends at the same stop.
 */
const END_PULL = 0.01;

/** Slack, as a share of the shape's range, for stop distances past its ends. */
const DIST_RANGE_SLACK = 0.01;

/**
 * A polyline from `coords` ([lon, lat, ...]) and, when given, `dists`,
 * skipping points without coordinates. Null when fewer than two points
 * remain.
 */
export function shapeLine(
  coords: Float64Array,
  dists?: Float64Array
): ShapeLine | null {
  const keep: number[] = [];
  for (let i = 0; i < coords.length / 2; i++) {
    if (Number.isFinite(coords[2 * i]) && Number.isFinite(coords[2 * i + 1])) {
      keep.push(i);
    }
  }
  if (keep.length < 2) {
    return null;
  }
  const n = keep.length;
  const line: ShapeLine = {
    lon: new Float64Array(n),
    lat: new Float64Array(n),
    m: new Float64Array(n),
    dist: dists ? new Float64Array(n) : null,
  };
  for (let k = 0; k < n; k++) {
    const i = keep[k];
    line.lon[k] = coords[2 * i];
    line.lat[k] = coords[2 * i + 1];
    if (line.dist) {
      line.dist[k] = i < dists!.length ? dists![i] : NaN;
    }
    if (k > 0) {
      line.m[k] =
        line.m[k - 1] +
        metres([line.lon[k - 1], line.lat[k - 1]], [line.lon[k], line.lat[k]]);
    }
  }
  return line;
}

type StopDistances =
  | { along: Float64Array; by: 'dist' | 'projection' }
  | { along: null; reason: string };

/**
 * Metres along `line` of each stop. `stopDist` is the trip's
 * shape_dist_traveled per stop (NaN where empty), `stopPos` its coordinates.
 */
export function stopDistances(
  line: ShapeLine,
  stopDist: Float64Array,
  stopPos: ([number, number] | null)[]
): StopDistances {
  const byDist = fromShapeDist(line, stopDist);
  if (byDist) {
    return { along: byDist, by: 'dist' };
  }
  if (stopPos.some((p) => !p)) {
    return { along: null, reason: 'a stop without coordinates' };
  }
  const { along, maxOffset } = project(line, stopPos as [number, number][]);
  if (maxOffset > MAX_STOP_OFFSET_M) {
    return {
      along: null,
      reason: `a stop more than ${MAX_STOP_OFFSET_M}m from the shape`,
    };
  }
  return { along, by: 'projection' };
}

/**
 * Stop metres from shape_dist_traveled, or null unless every stop and every
 * shape point has it, both never decrease, and the stops fall within the
 * shape's range.
 */
function fromShapeDist(
  line: ShapeLine,
  stopDist: Float64Array
): Float64Array | null {
  const dist = line.dist;
  if (!dist || !nonDecreasing(stopDist) || !nonDecreasing(dist)) {
    return null;
  }
  const n = dist.length;
  const lo = dist[0];
  const hi = dist[n - 1];
  const slack = (hi - lo) * DIST_RANGE_SLACK;
  if (
    !(hi > lo) ||
    stopDist[0] < lo - slack ||
    stopDist[stopDist.length - 1] > hi + slack
  ) {
    return null;
  }
  return Float64Array.from(stopDist, (d) => {
    if (d <= lo) {
      return 0;
    }
    if (d >= hi) {
      return line.m[n - 1];
    }
    // Last point at or before d.
    let a = 0;
    let b = n - 1;
    while (b - a > 1) {
      const mid = (a + b) >>> 1;
      if (dist[mid] <= d) {
        a = mid;
      } else {
        b = mid;
      }
    }
    const span = dist[b] - dist[a];
    const f = span > 0 ? (d - dist[a]) / span : 0;
    return line.m[a] + (line.m[b] - line.m[a]) * f;
  });
}

function nonDecreasing(a: Float64Array): boolean {
  if (!a.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || (i > 0 && a[i] < a[i - 1])) {
      return false;
    }
  }
  return true;
}

/**
 * Projects stops onto the shape in order, minimising the summed distance
 * from each stop to its point under the rule that a stop never lies on an
 * earlier segment than the stop before it. Runs in stops x segments.
 */
function project(
  line: ShapeLine,
  stops: [number, number][]
): { along: Float64Array; maxOffset: number } {
  const plane = localPlane(line);
  const segs = line.lon.length - 1;
  const total = line.m[segs];
  const s = stops.length;
  const back = new Int32Array(s * segs);
  let prev = new Float64Array(segs);
  let cur = new Float64Array(segs);
  for (let k = 0; k < s; k++) {
    const [px, py] = plane.xy(stops[k]);
    let best = Infinity;
    let bestJ = -1;
    for (let j = 0; j < segs; j++) {
      if (k > 0 && prev[j] < best) {
        best = prev[j];
        bestJ = j;
      }
      const hit = onSegment(plane, j, px, py);
      let c = hit.d + (k > 0 ? best : 0);
      if (k === 0 || k === s - 1) {
        const m = line.m[j] + (line.m[j + 1] - line.m[j]) * hit.t;
        c += END_PULL * ((k === 0 ? m : 0) + (k === s - 1 ? total - m : 0));
      }
      cur[j] = c;
      back[k * segs + j] = bestJ;
    }
    [prev, cur] = [cur, prev];
  }
  let j = 0;
  for (let i = 1; i < segs; i++) {
    if (prev[i] < prev[j]) {
      j = i;
    }
  }
  const along = new Float64Array(s);
  let maxOffset = 0;
  for (let k = s - 1; k >= 0; k--) {
    const [px, py] = plane.xy(stops[k]);
    const hit = onSegment(plane, j, px, py);
    along[k] = line.m[j] + (line.m[j + 1] - line.m[j]) * hit.t;
    maxOffset = Math.max(maxOffset, hit.d);
    j = back[k * segs + j];
  }
  // Two stops on one segment can project out of order; hold the later one.
  for (let k = 1; k < s; k++) {
    along[k] = Math.max(along[k], along[k - 1]);
  }
  return { along, maxOffset };
}

interface Plane {
  x: Float64Array;
  y: Float64Array;
  xy(p: [number, number]): [number, number];
}

/** Equirectangular metres around the shape's mean latitude. */
function localPlane(line: ShapeLine): Plane {
  let sum = 0;
  for (const lat of line.lat) {
    sum += lat;
  }
  const ky = EARTH_M * RAD;
  const kx = ky * Math.cos((sum / line.lat.length) * RAD);
  return {
    x: Float64Array.from(line.lon, (v) => v * kx),
    y: Float64Array.from(line.lat, (v) => v * ky),
    xy: (p) => [p[0] * kx, p[1] * ky],
  };
}

/** Nearest point of segment `j` to (px, py): its fraction and distance. */
function onSegment(
  plane: Plane,
  j: number,
  px: number,
  py: number
): { t: number; d: number } {
  const ax = plane.x[j];
  const ay = plane.y[j];
  const dx = plane.x[j + 1] - ax;
  const dy = plane.y[j + 1] - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { t, d: Math.hypot(ax + dx * t - px, ay + dy * t - py) };
}

/** The point `m` metres along `line`, with the bearing of its segment. */
export function pointAt(
  line: ShapeLine,
  m: number
): { lonLat: [number, number]; bearing: number | undefined } {
  const n = line.m.length;
  // Last segment start at or before m.
  let a = 0;
  let b = n - 1;
  while (b - a > 1) {
    const mid = (a + b) >>> 1;
    if (line.m[mid] <= m) {
      a = mid;
    } else {
      b = mid;
    }
  }
  const span = line.m[b] - line.m[a];
  const f = span > 0 ? Math.min(1, Math.max(0, (m - line.m[a]) / span)) : 0;
  const lonLat: [number, number] = [
    line.lon[a] + (line.lon[b] - line.lon[a]) * f,
    line.lat[a] + (line.lat[b] - line.lat[a]) * f,
  ];
  // Skip repeated points to find the direction of travel.
  let next = b;
  while (next < n - 1 && line.m[next] === line.m[a]) {
    next++;
  }
  const bearing =
    line.m[next] > line.m[a]
      ? bearingOf([line.lon[a], line.lat[a]], [line.lon[next], line.lat[next]])
      : undefined;
  return { lonLat, bearing };
}

const RAD = Math.PI / 180;
const EARTH_M = 6_371_000;

/** Haversine distance in metres between two [lon, lat] points. */
export function metres(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north. */
export function bearingOf(a: [number, number], b: [number, number]): number {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x =
    Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
    Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
