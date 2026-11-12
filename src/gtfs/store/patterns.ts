/**
 * stop_times compressed into trip patterns.
 *
 * A pattern is a trip's rows minus `trip_id` and the two time columns; trips
 * with identical patterns share one copy and keep only their times. Rows are
 * folded in while streaming: one trip's rows are buffered, sorted by
 * `stop_sequence`, then matched against existing patterns by hash. A trip
 * whose rows arrive in several runs is merged when the file ends.
 */

import { ColTable, type Row } from './col-table';
import {
  Col,
  CSR,
  Grow,
  bsearch,
  encode,
  kindFor,
  permute,
  sortPermutation,
  type Encoded,
  type Interner,
  type Kind,
} from './columns';

const TIME_COLS = ['arrival_time', 'departure_time'] as const;

export class Patterns {
  constructor(
    /** stop_times.txt header, in file order. */
    readonly header: string[],
    /** Pattern rows: every column but trip_id and the times. */
    readonly rows: ColTable,
    /** Pattern p covers rows [patStart[p], patStart[p + 1]). */
    readonly patStart: Uint32Array,
    /** Trip intern ids, ascending. */
    readonly tripKeys: Uint32Array,
    readonly tripPattern: Uint32Array,
    /** First index of trip t's times in `arr` / `dep`. */
    readonly tripTimeStart: Uint32Array,
    /** Null when loaded without times. */
    readonly arr: Col | null,
    readonly dep: Col | null,
    /** Pattern row indexes by stop_id intern id. */
    readonly stopRows: CSR,
    readonly rowPattern: Uint32Array,
    /** Trip indexes by pattern. */
    readonly patternTrips: CSR,
    private pool: Interner
  ) {}

  get patternCount(): number {
    return this.patStart.length - 1;
  }

  get tripCount(): number {
    return this.tripKeys.length;
  }

  /** Index of the trip in `tripKeys`, or -1. */
  tripIndex(tripId: string): number {
    const id = this.pool.lookup(tripId);
    return id < 0 ? -1 : bsearch(this.tripKeys, id);
  }

  tripId(t: number): string {
    return this.pool.strs[this.tripKeys[t]];
  }

  tripLength(t: number): number {
    const p = this.tripPattern[t];
    return this.patStart[p + 1] - this.patStart[p];
  }

  /** Fresh row objects for trip index `t`, in stop_sequence order. */
  tripRows(t: number): Row[] {
    const p = this.tripPattern[t];
    const base = this.patStart[p];
    const len = this.patStart[p + 1] - base;
    const tripId = this.tripId(t);
    const cols = this.header.map((c) => [c, this.rows.col(c)] as const);
    const out: Row[] = [];
    for (let k = 0, i = this.tripTimeStart[t]; k < len; k++, i++) {
      const o: Row = {};
      for (const [c, col] of cols) {
        if (c === 'trip_id') {
          o[c] = tripId;
        } else if (c === 'arrival_time') {
          o[c] = this.arr ? this.arr.get(i) : '';
        } else if (c === 'departure_time') {
          o[c] = this.dep ? this.dep.get(i) : '';
        } else {
          o[c] = col!.get(base + k);
        }
      }
      out.push(o);
    }
    return out;
  }

  /** stop_id and stop_sequence of each row of pattern `p`, in order. */
  patternStopRefs(p: number): { stop_id: string; stop_sequence: string }[] {
    const stop = this.rows.col('stop_id');
    const seq = this.rows.col('stop_sequence');
    const out: { stop_id: string; stop_sequence: string }[] = [];
    for (let r = this.patStart[p]; r < this.patStart[p + 1]; r++) {
      out.push({
        stop_id: stop ? stop.get(r) : '',
        stop_sequence: seq ? seq.get(r) : '',
      });
    }
    return out;
  }

  /** Distinct patterns serving a stop. */
  patternsAtStop(stopId: string): number[] {
    const id = this.pool.lookup(stopId);
    if (id < 0) {
      return [];
    }
    const out = new Set<number>();
    for (const r of this.stopRows.get(id)) {
      out.add(this.rowPattern[r]);
    }
    return [...out];
  }

  bytes(): number {
    return (
      this.rows.bytes() +
      this.patStart.byteLength +
      this.tripKeys.byteLength +
      this.tripPattern.byteLength +
      this.tripTimeStart.byteLength +
      (this.arr?.bytes() ?? 0) +
      (this.dep?.bytes() ?? 0) +
      this.stopRows.bytes() +
      this.rowPattern.byteLength +
      this.patternTrips.bytes()
    );
  }

  exceptions(): number {
    return (
      this.rows.exceptions() +
      (this.arr?.exc.size ?? 0) +
      (this.dep?.exc.size ?? 0)
    );
  }
}

/** Numeric stop_sequence for sorting; a non-numeric value sorts last, stably. */
function seqKey(s: string | undefined): number {
  const n = Number(s);
  return s === undefined || s === '' || Number.isNaN(n) ? Infinity : n;
}

export class PatternBuilder {
  header: string[] = [];
  private patCols: string[] = [];
  private patIdx: number[] = [];
  private kinds: Kind[] = [];
  private tripI = -1;
  private seqI = -1;
  private timeI: number[] = [];
  private seqC = -1;
  private rows: ColTable;
  private arr: Col | null;
  private dep: Col | null;
  private patStart = new Grow(Uint32Array);
  private tripKeys = new Grow(Uint32Array);
  private tripPattern = new Grow(Uint32Array);
  private tripTimeStart = new Grow(Uint32Array);
  private byHash = new Map<number, number | number[]>();
  private buf: string[][] = [];
  private cur: string | null = null;
  private timeN = 0;
  private enc: Encoded = { v: 0, d: 0, x: undefined };
  // One trip's encoded pattern cells (row-major) and times.
  private sv: number[] = [];
  private sd: number[] = [];
  private sx: (string | undefined)[] = [];
  private tv: number[] = [];
  private tx: (string | undefined)[] = [];
  /** Trips whose rows arrived in more than one run. */
  fragmentedTrips = 0;

  constructor(
    private pool: Interner,
    private keepTimes: boolean
  ) {
    this.rows = new ColTable('stop_times_patterns', pool);
    this.arr = keepTimes ? new Col('time', pool) : null;
    this.dep = keepTimes ? new Col('time', pool) : null;
  }

  setHeader(cols: string[]): void {
    this.header = cols;
    this.tripI = cols.indexOf('trip_id');
    if (this.tripI < 0) {
      throw new Error('stop_times.txt has no trip_id column');
    }
    this.seqI = cols.indexOf('stop_sequence');
    this.timeI = TIME_COLS.map((c) => cols.indexOf(c));
    this.patCols = cols.filter(
      (c) => c !== 'trip_id' && c !== 'arrival_time' && c !== 'departure_time'
    );
    this.patIdx = this.patCols.map((c) => cols.indexOf(c));
    this.kinds = this.patCols.map(kindFor);
    this.seqC = this.patCols.indexOf('stop_sequence');
    this.rows.setHeader(this.patCols);
  }

  push(r: string[]): void {
    const t = r[this.tripI] ?? '';
    if (t !== this.cur) {
      this.flush();
      this.cur = t;
    }
    this.buf.push(r);
  }

  private clearScratch(): void {
    this.sv.length = 0;
    this.sd.length = 0;
    this.sx.length = 0;
    this.tv.length = 0;
    this.tx.length = 0;
  }

  private flush(): void {
    const buf = this.buf;
    if (!buf.length) {
      return;
    }
    const si = this.seqI;
    if (si >= 0) {
      buf.sort((a, b) => seqKey(a[si]) - seqKey(b[si]) || 0);
    }
    this.clearScratch();
    const enc = this.enc;
    for (const r of buf) {
      for (let c = 0; c < this.patIdx.length; c++) {
        encode(this.kinds[c], this.pool, r[this.patIdx[c]] ?? '', enc);
        this.sv.push(enc.v);
        this.sd.push(enc.d);
        this.sx.push(enc.x);
      }
      if (this.keepTimes) {
        for (const ti of this.timeI) {
          encode('time', this.pool, ti < 0 ? '' : (r[ti] ?? ''), enc);
          this.tv.push(enc.v);
          this.tx.push(enc.x);
        }
      }
    }
    this.commit(this.pool.id(this.cur!), buf.length);
    this.buf = [];
  }

  /** Add one trip from the scratch arrays, reusing an identical pattern. */
  private commit(tripKey: number, len: number): void {
    const nc = this.patIdx.length;
    let h = 0x811c9dc5 ^ len;
    for (let k = 0; k < this.sv.length; k++) {
      h = Math.imul(h ^ this.sv[k], 0x01000193);
      h = Math.imul(h ^ this.sd[k], 0x01000193);
    }
    let p = this.match(h, len);
    if (p < 0) {
      p = this.patStart.n;
      this.patStart.push(this.rows.n);
      const cols = this.rows.data;
      for (let i = 0, k = 0; i < len; i++) {
        for (let c = 0; c < nc; c++, k++) {
          cols[c].pushEncoded(this.sv[k], this.sd[k], this.sx[k]);
        }
        this.rows.n++;
      }
      const e = this.byHash.get(h);
      if (e === undefined) {
        this.byHash.set(h, p);
      } else if (typeof e === 'number') {
        this.byHash.set(h, [e, p]);
      } else {
        e.push(p);
      }
    }
    this.tripKeys.push(tripKey);
    this.tripPattern.push(p);
    this.tripTimeStart.push(this.timeN);
    if (this.arr && this.dep) {
      for (let i = 0; i < len; i++) {
        this.arr.pushEncoded(this.tv[2 * i], 0, this.tx[2 * i]);
        this.dep.pushEncoded(this.tv[2 * i + 1], 0, this.tx[2 * i + 1]);
      }
      this.timeN += len;
    }
  }

  private patternEnd(p: number): number {
    return p + 1 < this.patStart.n ? this.patStart.at(p + 1) : this.rows.n;
  }

  /** An existing pattern with this hash and identical cells, or -1. */
  private match(h: number, len: number): number {
    const e = this.byHash.get(h);
    if (e === undefined) {
      return -1;
    }
    const cands = typeof e === 'number' ? [e] : e;
    const nc = this.patIdx.length;
    const cols = this.rows.data;
    outer: for (const p of cands) {
      const start = this.patStart.at(p);
      if (this.patternEnd(p) - start !== len) {
        continue;
      }
      for (let i = 0, k = 0; i < len; i++) {
        for (let c = 0; c < nc; c++, k++) {
          const col = cols[c];
          if (col.data.at(start + i) !== this.sv[k]) {
            continue outer;
          }
          if (col.dec && col.dec.at(start + i) !== this.sd[k]) {
            continue outer;
          }
          if (col.exc.get(start + i) !== this.sx[k]) {
            continue outer;
          }
        }
      }
      return p;
    }
    return -1;
  }

  /**
   * Trips split over several runs: decode their fragments, sort by
   * stop_sequence and re-add each as one trip. Returns which trip entries to
   * drop; their now-unused pattern rows and times stay behind.
   */
  private mergeFragments(): Uint8Array | null {
    const n = this.tripKeys.n;
    const keys = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      keys[i] = this.tripKeys.at(i);
    }
    const perm = sortPermutation(keys);
    let dropped: Uint8Array | null = null;
    const nc = this.patIdx.length;
    const cols = this.rows.data;
    for (let i = 0; i < n;) {
      let j = i + 1;
      while (j < n && keys[perm[j]] === keys[perm[i]]) {
        j++;
      }
      if (j - i > 1) {
        dropped ??= new Uint8Array(n);
        this.fragmentedTrips++;
        type Frag = {
          seq: number;
          v: number[];
          d: number[];
          x: (string | undefined)[];
          t: number[];
          tx: (string | undefined)[];
        };
        const rows: Frag[] = [];
        for (let f = i; f < j; f++) {
          const trip = perm[f];
          dropped[trip] = 1;
          const p = this.tripPattern.at(trip);
          const base = this.patStart.at(p);
          const ts = this.tripTimeStart.at(trip);
          const len = this.patternEnd(p) - base;
          for (let k = 0; k < len; k++) {
            const row: Frag = { seq: 0, v: [], d: [], x: [], t: [], tx: [] };
            for (let c = 0; c < nc; c++) {
              row.v.push(cols[c].data.at(base + k));
              row.d.push(cols[c].dec ? cols[c].dec!.at(base + k) : 0);
              row.x.push(cols[c].exc.get(base + k));
            }
            if (this.arr && this.dep) {
              for (const tc of [this.arr, this.dep]) {
                row.t.push(tc.data.at(ts + k));
                row.tx.push(tc.exc.get(ts + k));
              }
            }
            row.seq = this.seqC < 0 ? 0 : seqKey(cols[this.seqC].get(base + k));
            rows.push(row);
          }
        }
        rows.sort((a, b) => a.seq - b.seq || 0);
        this.clearScratch();
        for (const r of rows) {
          this.sv.push(...r.v);
          this.sd.push(...r.d);
          this.sx.push(...r.x);
          this.tv.push(...r.t);
          this.tx.push(...r.tx);
        }
        this.commit(keys[perm[i]], rows.length);
      }
      i = j;
    }
    return dropped;
  }

  finish(): Patterns {
    this.flush();
    const dropped = this.mergeFragments();
    this.byHash.clear();
    this.rows.end();
    this.arr?.trim();
    this.dep?.trim();
    this.patStart.push(this.rows.n);
    const patStart = this.patStart.trim();
    let tk = this.tripKeys.trim();
    let tp = this.tripPattern.trim();
    let tt = this.tripTimeStart.trim();
    if (dropped) {
      const keep = (a: Uint32Array) =>
        a.filter((_, i) => i >= dropped.length || !dropped[i]);
      [tk, tp, tt] = [keep(tk), keep(tp), keep(tt)];
      console.log(
        `[Patterns] merged ${this.fragmentedTrips} trips split over several runs`
      );
    }
    const perm = sortPermutation(tk);
    const tripKeys = permute(tk, perm);
    const tripPattern = permute(tp, perm);
    const tripTimeStart = permute(tt, perm);
    const rowPattern = new Uint32Array(this.rows.n);
    for (let p = 0; p + 1 < patStart.length; p++) {
      rowPattern.fill(p, patStart[p], patStart[p + 1]);
    }
    const stopCol = this.rows.col('stop_id');
    const stopRows = stopCol
      ? CSR.build(stopCol.data.a, this.rows.n, this.pool.strs.length)
      : CSR.build([], 0, 0);
    const patternTrips = CSR.build(
      tripPattern,
      tripKeys.length,
      patStart.length
    );
    console.log(
      `[Patterns] ${tripKeys.length} trips in ${patStart.length - 1} patterns (${this.rows.n} pattern rows)`
    );
    return new Patterns(
      this.header,
      this.rows,
      patStart,
      tripKeys,
      tripPattern,
      tripTimeStart,
      this.arr,
      this.dep,
      stopRows,
      rowPattern,
      patternTrips,
      this.pool
    );
  }
}
