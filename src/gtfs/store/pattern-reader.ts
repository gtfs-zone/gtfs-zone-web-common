/**
 * Read-only access to a store's stop_times as trip patterns, for comparing two
 * stores without materializing rows.
 *
 * Trips are numbered 0..tripCount-1 and patterns 0..patternCount-1 within one
 * store; across stores, match trips by `tripId` and patterns by `patternHash`
 * / `patternKey`, which depend only on cell text. Times are in the store's
 * encoding: `v >> 1` is seconds since midnight, bit 0 is set when the hour
 * had one digit ("8:00:00"), `TIME_EMPTY` is an empty cell and
 * `TIME_VERBATIM` a value kept as text (read it with `timeText`).
 *
 * This reads the loaded base. Trips whose stop_times were edited since are
 * flagged by `isEdited`; read those with `FeedStore.stopTimesForTrip`.
 */

import type { TripStop } from './feed-store';
import type { Patterns } from './patterns';

export const TIME_EMPTY = -1;
export const TIME_VERBATIM = -2;

const TIME_COLS = new Set(['trip_id', 'arrival_time', 'departure_time']);
const CELL_SEP = '\x1f';
const ROW_SEP = '\x1e';

/** 53-bit string hash (cyrb53). */
function hash53(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export class PatternReader {
  /** Pattern columns (stop_times minus trip_id and times), sorted by name. */
  readonly columns: string[];
  private cols;

  constructor(
    private p: Patterns,
    private edited: ReadonlyMap<string, unknown>
  ) {
    this.columns = p.header.filter((c) => !TIME_COLS.has(c)).sort();
    this.cols = this.columns.map((c) => [c, p.rows.col(c)!] as const);
  }

  get tripCount(): number {
    return this.p.tripCount;
  }

  get patternCount(): number {
    return this.p.patternCount;
  }

  /** False when stop_times was loaded without times (`patterns` mode). */
  get hasTimes(): boolean {
    return this.p.arr !== null && this.p.dep !== null;
  }

  tripId(t: number): string {
    return this.p.tripId(t);
  }

  /** Index of a trip, or -1. */
  tripIndex(tripId: string): number {
    return this.p.tripIndex(tripId);
  }

  isEdited(t: number): boolean {
    return this.edited.size > 0 && this.edited.has(this.p.tripId(t));
  }

  /**
   * Source lines of trip `t`'s rows, in stop_sequence order, or null when
   * the parser did not count lines or the trip was edited.
   */
  tripLines(t: number): Uint32Array | null {
    return this.isEdited(t) ? null : this.p.tripLines(t);
  }

  tripPattern(t: number): number {
    return this.p.tripPattern[t];
  }

  /** Trip indexes using pattern `p`. A view: do not write to it. */
  patternTrips(p: number): Uint32Array {
    return this.p.patternTrips.get(p);
  }

  /** Number of stop_times rows in pattern `p`. */
  patternLength(p: number): number {
    return this.p.patStart[p + 1] - this.p.patStart[p];
  }

  patternStops(p: number): TripStop[] {
    return this.p.patternStopRefs(p);
  }

  /**
   * Content of pattern `p` as one string: per row, the non-empty cells as
   * `name=value` in column name order. Column order and absent vs empty
   * columns do not change it.
   */
  patternKey(p: number): string {
    const rows: string[] = [];
    const cells: string[] = [];
    for (let r = this.p.patStart[p]; r < this.p.patStart[p + 1]; r++) {
      cells.length = 0;
      for (const [name, col] of this.cols) {
        const v = col.get(r);
        if (v !== '') {
          cells.push(`${name}=${v}`);
        }
      }
      rows.push(cells.join(CELL_SEP));
    }
    return rows.join(ROW_SEP);
  }

  /** Hash of `patternKey(p)`; equal keys give equal hashes in any store. */
  patternHash(p: number): number {
    return hash53(this.patternKey(p));
  }

  /**
   * Arrival and departure times of trip `t`, one per pattern row, encoded as
   * described above. Views over the store: do not write to them.
   */
  encodedTimes(t: number): { arr: Int32Array; dep: Int32Array } {
    const { arr, dep } = this.p;
    if (!arr || !dep) {
      throw new Error('[PatternReader] stop_times loaded without times');
    }
    const start = this.p.tripTimeStart[t];
    const end = start + this.patternLength(this.p.tripPattern[t]);
    return {
      arr: (arr.data.trim() as Int32Array).subarray(start, end),
      dep: (dep.data.trim() as Int32Array).subarray(start, end),
    };
  }

  /** Time text of row `k` of trip `t`, exactly as in the file. */
  timeText(t: number, k: number, which: 'arr' | 'dep'): string {
    const col = which === 'arr' ? this.p.arr : this.p.dep;
    if (!col) {
      throw new Error('[PatternReader] stop_times loaded without times');
    }
    return col.get(this.p.tripTimeStart[t] + k);
  }
}
