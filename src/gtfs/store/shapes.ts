/**
 * shapes.txt stored as runs of one shape_id each.
 *
 * shape_id is kept once per run, and shape_pt_sequence is implicit (run's
 * first sequence + offset) until a shape breaks the +1 step, at which point
 * an explicit column is materialized. Coordinates are i32 fixed-point with a
 * decimal count (see `Col`'s dec kind). A shape_id that reappears after
 * another one is regrouped when the file ends, so every shape is one run.
 */

import type { Row } from './col-table';
import {
  Col,
  Grow,
  bsearch,
  kindFor,
  permute,
  sortPermutation,
  type Encoded,
  type Interner,
} from './columns';

const INT_RE = /^(0|[1-9]\d{0,8})$/;

export class ShapeTable {
  cols: string[] = [];
  n = 0;
  data = new Map<string, Col>();
  runKey = new Grow(Uint32Array);
  runStart = new Grow(Uint32Array);
  runSeq0 = new Grow(Int32Array);
  seq: Col | null = null;
  /** Run indexes sorted by shape_id intern id. */
  sortedKeys: Uint32Array = new Uint32Array(0);
  sortedRuns: Uint32Array = new Uint32Array(0);
  private idI = -1;
  private seqI = -1;
  private other: [number, Col][] = [];
  private curKey = -1;
  private lastSeq = 0;
  private enc: Encoded = { v: 0, d: 0, x: undefined };

  constructor(private pool: Interner) {}

  setHeader(cols: string[]): void {
    this.cols = cols;
    this.idI = cols.indexOf('shape_id');
    if (this.idI < 0) {
      throw new Error('shapes.txt has no shape_id column');
    }
    this.seqI = cols.indexOf('shape_pt_sequence');
    for (let i = 0; i < cols.length; i++) {
      if (i === this.idI || i === this.seqI) {
        continue;
      }
      const c = new Col(kindFor(cols[i]), this.pool);
      this.data.set(cols[i], c);
      this.other.push([i, c]);
    }
    if (this.seqI < 0) {
      // No sequence column at all: rows keep file order and read back empty.
      this.seq = new Col('int', this.pool);
    }
  }

  pushRow(r: string[]): void {
    const key = this.pool.id(r[this.idI] ?? '');
    const s = this.seqI < 0 ? '' : (r[this.seqI] ?? '');
    const sv = INT_RE.test(s) ? +s : NaN;
    if (key !== this.curKey) {
      this.curKey = key;
      this.runKey.push(key);
      this.runStart.push(this.n);
      this.runSeq0.push(Number.isNaN(sv) ? 0 : sv);
    } else if (!this.seq && sv !== this.lastSeq + 1) {
      this.materializeSeq();
    }
    if (Number.isNaN(sv) && !this.seq) {
      this.materializeSeq();
    }
    this.seq?.push(s, this.enc);
    this.lastSeq = sv;
    for (const [i, c] of this.other) {
      c.push(r[i] ?? '', this.enc);
    }
    this.n++;
  }

  private materializeSeq(): void {
    const seq = new Col('int', this.pool);
    for (let r = 0; r < this.n; r++) {
      seq.push(String(this.implicitSeq(r)), this.enc);
    }
    this.seq = seq;
    console.log(`[Shapes] explicit shape_pt_sequence from row ${this.n}`);
  }

  private runOf(r: number): number {
    const rs = this.runStart;
    let lo = 0;
    let hi = rs.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (rs.at(mid) <= r) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  private implicitSeq(r: number): number {
    const run = this.runOf(r);
    return this.runSeq0.at(run) + r - this.runStart.at(run);
  }

  end(): void {
    for (const c of this.data.values()) {
      c.trim();
    }
    this.seq?.trim();
    const keys = this.runKey.trim();
    this.runStart.trim();
    this.runSeq0.trim();
    const perm = sortPermutation(keys);
    const sortedKeys = permute(keys, perm);
    for (let i = 1; i < sortedKeys.length; i++) {
      if (sortedKeys[i] === sortedKeys[i - 1]) {
        this.regroup();
        return;
      }
    }
    this.sortedKeys = sortedKeys;
    this.sortedRuns = perm;
    console.log(`[Shapes] ${this.n} points in ${keys.length} shapes`);
  }

  /**
   * Reorder rows so each shape_id is one contiguous run, keeping file order
   * within a shape. Sequences become explicit, since run offsets no longer
   * hold.
   */
  private regroup(): void {
    if (!this.seq) {
      this.materializeSeq();
      this.seq!.trim();
    }
    const runs = this.runKey.n;
    const rowKey = new Uint32Array(this.n);
    for (let run = 0; run < runs; run++) {
      const end = run + 1 < runs ? this.runStart.at(run + 1) : this.n;
      rowKey.fill(this.runKey.at(run), this.runStart.at(run), end);
    }
    const perm = sortPermutation(rowKey);
    const permuteCol = (c: Col): Col => {
      const out = new Col(c.kind, this.pool);
      for (let i = 0; i < perm.length; i++) {
        const r = perm[i];
        out.pushEncoded(c.data.at(r), c.dec ? c.dec.at(r) : 0, c.exc.get(r));
      }
      out.trim();
      return out;
    };
    for (const [name, c] of this.data) {
      this.data.set(name, permuteCol(c));
    }
    this.seq = permuteCol(this.seq!);
    const runKey = new Grow(Uint32Array);
    const runStart = new Grow(Uint32Array);
    const runSeq0 = new Grow(Int32Array);
    let prev = -1;
    for (let i = 0; i < perm.length; i++) {
      const k = rowKey[perm[i]];
      if (k !== prev) {
        runKey.push(k);
        runStart.push(i);
        runSeq0.push(0);
        prev = k;
      }
    }
    this.runKey = runKey;
    this.runStart = runStart;
    this.runSeq0 = runSeq0;
    this.sortedKeys = runKey.trim();
    runStart.trim();
    runSeq0.trim();
    this.sortedRuns = new Uint32Array(this.sortedKeys.length).map((_, i) => i);
    console.log(
      `[Shapes] regrouped ${runs} runs into ${this.sortedKeys.length} shapes (${this.n} points)`
    );
  }

  /** Row range of a shape, in file order. */
  range(shapeId: string): [number, number] {
    const id = this.pool.lookup(shapeId);
    const i = id < 0 ? -1 : bsearch(this.sortedKeys, id);
    if (i < 0) {
      return [0, 0];
    }
    const run = this.sortedRuns[i];
    const end = run + 1 < this.runStart.n ? this.runStart.at(run + 1) : this.n;
    return [this.runStart.at(run), end];
  }

  /** Every shape_id, in no particular order. */
  shapeIds(): string[] {
    return Array.from(this.sortedKeys, (k) => this.pool.strs[k]);
  }

  get(r: number, col: string): string {
    if (col === 'shape_id') {
      return this.pool.strs[this.runKey.at(this.runOf(r))];
    }
    if (col === 'shape_pt_sequence') {
      return this.seq ? this.seq.get(r) : String(this.implicitSeq(r));
    }
    return this.data.get(col)?.get(r) ?? '';
  }

  row(r: number): Row {
    const o: Row = {};
    for (const c of this.cols) {
      o[c] = this.get(r, c);
    }
    return o;
  }

  /** Fresh rows of one shape, sorted by shape_pt_sequence. */
  shapeRows(shapeId: string): Row[] {
    const [a, b] = this.range(shapeId);
    const order = this.orderedRows(a, b);
    return order.map((r) => this.row(r));
  }

  /** [lon, lat, lon, lat, ...] of one shape, sorted by shape_pt_sequence. */
  coords(shapeId: string): Float64Array {
    const [a, b] = this.range(shapeId);
    const lat = this.data.get('shape_pt_lat');
    const lon = this.data.get('shape_pt_lon');
    const order = this.orderedRows(a, b);
    const out = new Float64Array(order.length * 2);
    if (!lat || !lon) {
      return out.fill(NaN);
    }
    for (let i = 0; i < order.length; i++) {
      out[2 * i] = lon.num(order[i]);
      out[2 * i + 1] = lat.num(order[i]);
    }
    return out;
  }

  private orderedRows(a: number, b: number): number[] {
    const rows: number[] = [];
    for (let r = a; r < b; r++) {
      rows.push(r);
    }
    if (this.seq) {
      const seq = this.seq;
      rows.sort((x, y) => (seq.num(x) || 0) - (seq.num(y) || 0) || x - y);
    }
    return rows;
  }

  bytes(): number {
    let b =
      this.runKey.a.byteLength +
      this.runStart.a.byteLength +
      this.runSeq0.a.byteLength +
      this.sortedKeys.byteLength +
      this.sortedRuns.byteLength;
    for (const c of this.data.values()) {
      b += c.bytes();
    }
    return b + (this.seq?.bytes() ?? 0);
  }

  exceptions(): number {
    let e = this.seq?.exc.size ?? 0;
    for (const c of this.data.values()) {
      e += c.exc.size;
    }
    return e;
  }
}
