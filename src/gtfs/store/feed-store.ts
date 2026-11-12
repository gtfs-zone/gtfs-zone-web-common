/**
 * A whole GTFS feed held columnar, with an edit overlay on top.
 *
 * The base (what was parsed) is immutable after load. Edits live in a small
 * overlay: ordinary tables track updated, deleted and inserted rows by row
 * id; stop_times are overridden per trip and shapes per shape. Every read
 * merges base and overlay and returns fresh objects (copy-on-read).
 *
 * Lookups merge an indexed base lookup with a scan of the overlay, which
 * stays small (it holds only what the user edited).
 */

import { ColTable, type Row } from './col-table';
import { Interner } from './columns';
import { PatternBuilder, type Patterns } from './patterns';
import { ShapeTable } from './shapes';
import type { TableSink } from './csv-stream';

export type { Row } from './col-table';

/**
 * How much of stop_times.txt to keep. `patterns` keeps each trip's stop list
 * (enough for route geometry and trips-at-stop) and drops the times.
 */
export type StopTimesMode = 'full' | 'patterns' | 'skip';

export interface StoreOptions {
  stopTimes?: StopTimesMode;
  /** Tables not to load at all, by name without `.txt`. */
  skipTables?: string[];
}

/** The immutable base of a finished store, as `base-file.ts` writes it. */
export interface BaseParts {
  pool: Interner;
  tables: ColTable[];
  patterns: Patterns | null;
  shapes: ShapeTable | null;
  stopTimesMode: StopTimesMode;
  stopTimesCols: string[];
  shapeCols: string[];
}

export interface TripStop {
  stop_id: string;
  stop_sequence: string;
}

/** A row with its stable id inside its table. */
export interface IdRow {
  id: number;
  row: Row;
}

const STOP_TIMES = 'stop_times';
const SHAPES = 'shapes';

/** An ordinary table: columnar base plus row-level edits. */
class Table {
  cols: string[];
  updated = new Map<number, Row>();
  deleted = new Set<number>();
  /** Rows added by edits; ids continue after the base. Null once deleted. */
  inserted: (Row | null)[] = [];

  constructor(readonly base: ColTable) {
    this.cols = [...base.cols];
  }

  get size(): number {
    let n = this.base.n - this.deleted.size;
    for (const r of this.inserted) {
      if (r) {
        n++;
      }
    }
    return n;
  }

  exists(id: number): boolean {
    if (id < this.base.n) {
      return id >= 0 && !this.deleted.has(id);
    }
    return !!this.inserted[id - this.base.n];
  }

  /** A fresh copy of the row, or null when it does not exist. */
  row(id: number): Row | null {
    if (!this.exists(id)) {
      return null;
    }
    const edited = this.updated.get(id) ?? this.inserted[id - this.base.n];
    return edited
      ? this.complete({ ...edited })
      : this.complete(this.base.row(id));
  }

  /** Fill columns added by edits, so every row has the full header. */
  private complete(row: Row): Row {
    for (const c of this.cols) {
      row[c] ??= '';
    }
    return row;
  }

  ids(offset: number, limit: number): number[] {
    const out: number[] = [];
    let skip = offset;
    const n = this.base.n;
    for (let id = 0; id < n && out.length < limit; id++) {
      if (this.deleted.has(id)) {
        continue;
      }
      if (skip > 0) {
        skip--;
      } else {
        out.push(id);
      }
    }
    for (let k = 0; k < this.inserted.length && out.length < limit; k++) {
      if (!this.inserted[k]) {
        continue;
      }
      if (skip > 0) {
        skip--;
      } else {
        out.push(n + k);
      }
    }
    return out;
  }

  find(col: string, value: string): number[] {
    const out: number[] = [];
    for (const id of Array.from(this.base.find(col, value))) {
      if (!this.deleted.has(id) && !this.updated.has(id)) {
        out.push(id);
      }
    }
    for (const [id, row] of this.updated) {
      if (!this.deleted.has(id) && (row[col] ?? '') === value) {
        out.push(id);
      }
    }
    const n = this.base.n;
    this.inserted.forEach((row, k) => {
      if (row && (row[col] ?? '') === value) {
        out.push(n + k);
      }
    });
    return out.sort((a, b) => a - b);
  }

  private addCols(row: Row): void {
    for (const c of Object.keys(row)) {
      if (!this.cols.includes(c)) {
        this.cols.push(c);
      }
    }
  }

  insert(row: Row): number {
    this.addCols(row);
    this.inserted.push({ ...row });
    return this.base.n + this.inserted.length - 1;
  }

  update(id: number, row: Row): void {
    this.requireRow(id);
    this.addCols(row);
    if (id < this.base.n) {
      this.updated.set(id, { ...row });
    } else {
      this.inserted[id - this.base.n] = { ...row };
    }
  }

  delete(id: number): void {
    this.requireRow(id);
    if (id < this.base.n) {
      this.deleted.add(id);
      this.updated.delete(id);
    } else {
      this.inserted[id - this.base.n] = null;
    }
  }

  private requireRow(id: number): void {
    if (!this.exists(id)) {
      throw new Error(`[FeedStore] ${this.base.name}: no row ${id}`);
    }
  }
}

export class FeedStore {
  readonly pool: Interner;
  private tables = new Map<string, Table>();
  /** Base tables while loading, wrapped into `tables` by `finish()`. */
  private loading = new Map<string, ColTable>();
  patterns: Patterns | null = null;
  shapes: ShapeTable | null = null;
  readonly stopTimesMode: StopTimesMode;
  private skip: Set<string>;
  private stopTimesCols: string[] = [];
  private shapeCols: string[] = [];
  /** trip_id -> its whole stop_times, sorted; [] removes the trip's rows. */
  private tripOverrides = new Map<string, Row[]>();
  /** shape_id -> its whole point list; [] removes the shape. */
  private shapeOverrides = new Map<string, Row[]>();
  private finished = false;

  constructor(options: StoreOptions = {}, pool = new Interner()) {
    this.pool = pool;
    this.stopTimesMode = options.stopTimes ?? 'full';
    this.skip = new Set(options.skipTables ?? []);
    if (this.stopTimesMode === 'skip') {
      this.skip.add(STOP_TIMES);
    }
  }

  /** The parse sink for one table, or null to skip it. */
  sinkFor = (table: string): TableSink | null => {
    if (this.skip.has(table)) {
      return null;
    }
    if (this.loading.has(table) || this.tables.has(table)) {
      throw new Error(`The archive contains ${table}.txt more than once`);
    }
    if (table === STOP_TIMES) {
      const b = new PatternBuilder(this.pool, this.stopTimesMode === 'full');
      let empty = false;
      return {
        header: (cols) => {
          empty = cols.length === 0;
          if (!empty) {
            b.setHeader(cols);
          }
          this.stopTimesCols = cols;
        },
        rows: (batch) => {
          for (const r of batch) {
            b.push(r);
          }
        },
        end: () => {
          if (!empty) {
            this.patterns = b.finish();
          }
        },
      };
    }
    if (table === SHAPES) {
      const s = new ShapeTable(this.pool);
      let empty = false;
      return {
        header: (cols) => {
          empty = cols.length === 0;
          if (!empty) {
            s.setHeader(cols);
          }
          this.shapeCols = cols;
        },
        rows: (batch) => {
          for (const r of batch) {
            s.pushRow(r);
          }
        },
        end: () => {
          if (!empty) {
            s.end();
            this.shapes = s;
          }
        },
      };
    }
    const t = new ColTable(table, this.pool);
    this.loading.set(table, t);
    return {
      header: (cols) => t.setHeader(cols),
      rows: (batch) => {
        for (const r of batch) {
          t.pushRow(r);
        }
      },
      end: () => t.end(),
    };
  };

  /** Close loading: freeze the string pool and wrap the base tables. */
  finish(): void {
    for (const [name, t] of this.loading) {
      this.tables.set(name, new Table(t));
    }
    this.loading.clear();
    this.pool.freeze();
    this.finished = true;
    console.log(
      `[FeedStore] ready: ${this.tables.size} tables, ${this.pool.strs.length} strings, stop_times ${this.stopTimesMode}`
    );
  }

  /** A finished store over a restored base, with no edits. */
  static fromBase(parts: BaseParts): FeedStore {
    const s = new FeedStore({ stopTimes: parts.stopTimesMode }, parts.pool);
    for (const t of parts.tables) {
      s.tables.set(t.name, new Table(t));
    }
    s.patterns = parts.patterns;
    s.shapes = parts.shapes;
    s.stopTimesCols = [...parts.stopTimesCols];
    s.shapeCols = [...parts.shapeCols];
    s.finished = true;
    console.log(
      `[FeedStore] restored: ${s.tables.size} tables, ${s.pool.strs.length} strings, stop_times ${s.stopTimesMode}`
    );
    return s;
  }

  /** True once anything differs from the parsed base. */
  hasEdits(): boolean {
    for (const t of this.tables.values()) {
      if (
        t.updated.size ||
        t.deleted.size ||
        t.inserted.length ||
        t.cols.length !== t.base.cols.length
      ) {
        return true;
      }
    }
    return this.tripOverrides.size > 0 || this.shapeOverrides.size > 0;
  }

  /** The base, for writing. Throws when the store has edits. */
  baseParts(): BaseParts {
    this.ready();
    if (this.hasEdits()) {
      throw new Error(
        '[FeedStore] only an unedited store can be written as a base'
      );
    }
    return {
      pool: this.pool,
      tables: [...this.tables.values()].map((t) => t.base),
      patterns: this.patterns,
      shapes: this.shapes,
      stopTimesMode: this.stopTimesMode,
      stopTimesCols: [...this.stopTimesCols],
      shapeCols: [...this.shapeCols],
    };
  }

  private ready(): void {
    if (!this.finished) {
      throw new Error('[FeedStore] read before finish()');
    }
  }

  // ---------- table-level ----------

  tableNames(): string[] {
    const names = [...this.tables.keys()];
    if (this.patterns || this.tripOverrides.size) {
      names.push(STOP_TIMES);
    }
    if (this.shapes || this.shapeOverrides.size) {
      names.push(SHAPES);
    }
    return names;
  }

  columns(table: string): string[] {
    if (table === STOP_TIMES) {
      return [...this.stopTimesCols];
    }
    if (table === SHAPES) {
      return [...this.shapeCols];
    }
    return [...(this.tables.get(table)?.cols ?? [])];
  }

  /** Row count per table, edits included. */
  counts(): Record<string, number> {
    this.ready();
    const out: Record<string, number> = {};
    for (const [name, t] of this.tables) {
      out[name] = t.size;
    }
    if (this.patterns || this.tripOverrides.size) {
      out[STOP_TIMES] = this.stopTimeCount();
    }
    if (this.shapes || this.shapeOverrides.size) {
      out[SHAPES] = this.shapePointCount();
    }
    return out;
  }

  private ordinary(table: string): Table {
    this.ready();
    if (table === STOP_TIMES || table === SHAPES) {
      throw new Error(
        `[FeedStore] ${table} is read and edited per trip / per shape`
      );
    }
    const t = this.tables.get(table);
    if (!t) {
      throw new Error(`[FeedStore] no table ${table}`);
    }
    return t;
  }

  hasTable(table: string): boolean {
    return this.tableNames().includes(table);
  }

  /** Ensure an editable table exists, creating an empty one if the feed had none. */
  ensureTable(table: string, cols: string[]): void {
    this.ready();
    if (table === STOP_TIMES || table === SHAPES || this.tables.has(table)) {
      return;
    }
    const base = new ColTable(table, this.pool);
    base.setHeader([]);
    base.end();
    const t = new Table(base);
    t.cols = [...cols];
    this.tables.set(table, t);
  }

  // ---------- ordinary tables ----------

  rows(table: string, offset = 0, limit = Infinity): IdRow[] {
    const t = this.ordinary(table);
    return t.ids(offset, limit).map((id) => ({ id, row: t.row(id)! }));
  }

  row(table: string, id: number): Row | null {
    return this.ordinary(table).row(id);
  }

  find(table: string, col: string, value: string): IdRow[] {
    const t = this.ordinary(table);
    return t.find(col, value).map((id) => ({ id, row: t.row(id)! }));
  }

  /**
   * Visit every live row's `cols` values, in id order, without building row
   * objects for base rows. `values` is reused between calls.
   */
  scan(
    table: string,
    cols: string[],
    fn: (values: string[], id: number) => void
  ): void {
    if (!this.tables.has(table)) {
      return;
    }
    const t = this.ordinary(table);
    const base = cols.map((c) => t.base.col(c));
    const values = cols.map(() => '');
    for (let id = 0; id < t.base.n; id++) {
      if (t.deleted.has(id)) {
        continue;
      }
      const edited = t.updated.get(id);
      for (let c = 0; c < cols.length; c++) {
        values[c] = edited ? (edited[cols[c]] ?? '') : (base[c]?.get(id) ?? '');
      }
      fn(values, id);
    }
    t.inserted.forEach((row, k) => {
      if (row) {
        for (let c = 0; c < cols.length; c++) {
          values[c] = row[cols[c]] ?? '';
        }
        fn(values, t.base.n + k);
      }
    });
  }

  insertRow(table: string, row: Row): number {
    const id = this.ordinary(table).insert(row);
    console.log(`[FeedStore] ${table}: inserted row ${id}`);
    return id;
  }

  updateRow(table: string, id: number, row: Row): void {
    this.ordinary(table).update(id, row);
    console.log(`[FeedStore] ${table}: updated row ${id}`);
  }

  deleteRow(table: string, id: number): void {
    this.ordinary(table).delete(id);
    console.log(`[FeedStore] ${table}: deleted row ${id}`);
  }

  // ---------- stop_times ----------

  private requireTimes(): void {
    if (this.stopTimesMode !== 'full') {
      throw new Error(
        `[FeedStore] stop_times loaded as '${this.stopTimesMode}', without times`
      );
    }
  }

  /** A trip's stop_times, sorted by stop_sequence. */
  stopTimesForTrip(tripId: string): Row[] {
    this.ready();
    this.requireTimes();
    const o = this.tripOverrides.get(tripId);
    if (o) {
      return o.map((r) => this.completeStopTime({ ...r }));
    }
    const t = this.patterns?.tripIndex(tripId) ?? -1;
    return t < 0
      ? []
      : this.patterns!.tripRows(t).map((r) => this.completeStopTime(r));
  }

  private completeStopTime(row: Row): Row {
    for (const c of this.stopTimesCols) {
      row[c] ??= '';
    }
    return row;
  }

  /** stop_id and stop_sequence of a trip's stops, in order (works without times). */
  tripStops(tripId: string): TripStop[] {
    this.ready();
    const o = this.tripOverrides.get(tripId);
    if (o) {
      return o.map((r) => ({
        stop_id: r.stop_id ?? '',
        stop_sequence: r.stop_sequence ?? '',
      }));
    }
    const p = this.patterns;
    const t = p?.tripIndex(tripId) ?? -1;
    return t < 0 ? [] : p!.patternStopRefs(p!.tripPattern[t]);
  }

  /**
   * A key shared by trips with the same stop list: the pattern for unedited
   * trips, the trip itself once edited. Null when the trip has no stop_times.
   */
  stopListKey(tripId: string): string | null {
    this.ready();
    const o = this.tripOverrides.get(tripId);
    if (o) {
      return o.length ? `t:${tripId}` : null;
    }
    const p = this.patterns;
    const t = p?.tripIndex(tripId) ?? -1;
    return t < 0 ? null : `p:${p!.tripPattern[t]}`;
  }

  /**
   * Visit each distinct stop list once, with the trips that use it: one call
   * per pattern (minus edited trips), one per edited trip.
   */
  forEachStopList(fn: (stops: TripStop[], tripIds: string[]) => void): void {
    this.ready();
    const p = this.patterns;
    if (p) {
      for (let pat = 0; pat < p.patternCount; pat++) {
        const trips: string[] = [];
        for (const t of p.patternTrips.get(pat)) {
          const id = p.tripId(t);
          if (!this.tripOverrides.has(id)) {
            trips.push(id);
          }
        }
        if (trips.length) {
          fn(p.patternStopRefs(pat), trips);
        }
      }
    }
    for (const [id, rows] of this.tripOverrides) {
      if (rows.length) {
        fn(this.tripStops(id), [id]);
      }
    }
  }

  /** Ids of every trip that has stop_times. */
  tripsWithStopTimes(): string[] {
    this.ready();
    const out: string[] = [];
    const p = this.patterns;
    if (p) {
      for (let t = 0; t < p.tripCount; t++) {
        const id = p.tripId(t);
        if (!this.tripOverrides.has(id)) {
          out.push(id);
        }
      }
    }
    for (const [id, rows] of this.tripOverrides) {
      if (rows.length) {
        out.push(id);
      }
    }
    return out;
  }

  /** Distinct trip ids with a stop_time at `stopId`. */
  tripsAtStop(stopId: string): string[] {
    this.ready();
    const out = new Set<string>();
    const p = this.patterns;
    if (p) {
      for (const pat of p.patternsAtStop(stopId)) {
        for (const t of p.patternTrips.get(pat)) {
          const id = p.tripId(t);
          if (!this.tripOverrides.has(id)) {
            out.add(id);
          }
        }
      }
    }
    for (const [id, rows] of this.tripOverrides) {
      if (rows.some((r) => r.stop_id === stopId)) {
        out.add(id);
      }
    }
    return [...out];
  }

  /**
   * Replace a trip's stop_times. `[]` removes them. Rows are stored sorted by
   * stop_sequence, with trip_id forced to `tripId`.
   */
  setTripStopTimes(tripId: string, rows: Row[]): void {
    this.ready();
    for (const r of rows) {
      for (const c of Object.keys(r)) {
        if (!this.stopTimesCols.includes(c)) {
          this.stopTimesCols.push(c);
        }
      }
    }
    const sorted = rows
      .map((r) => ({ ...r, trip_id: tripId }))
      .sort((a, b) => seqOf(a) - seqOf(b) || 0);
    this.tripOverrides.set(tripId, sorted);
    console.log(
      `[FeedStore] stop_times: trip ${tripId} set to ${sorted.length} rows`
    );
  }

  private stopTimeCount(): number {
    const p = this.patterns;
    let n = 0;
    if (p) {
      for (let t = 0; t < p.tripCount; t++) {
        n += p.tripLength(t);
      }
    }
    for (const [id, rows] of this.tripOverrides) {
      const t = p?.tripIndex(id) ?? -1;
      if (t >= 0) {
        n -= p!.tripLength(t);
      }
      n += rows.length;
    }
    return n;
  }

  // ---------- shapes ----------

  shapeIds(): string[] {
    this.ready();
    const out = (this.shapes?.shapeIds() ?? []).filter(
      (id) => !this.shapeOverrides.has(id)
    );
    for (const [id, rows] of this.shapeOverrides) {
      if (rows.length) {
        out.push(id);
      }
    }
    return out;
  }

  /** A shape's points, sorted by shape_pt_sequence. */
  shapeRows(shapeId: string): Row[] {
    this.ready();
    const o = this.shapeOverrides.get(shapeId);
    if (o) {
      return o.map((r) => {
        const row = { ...r };
        for (const c of this.shapeCols) {
          row[c] ??= '';
        }
        return row;
      });
    }
    return this.shapes?.shapeRows(shapeId) ?? [];
  }

  /** [lon, lat, ...] of a shape, sorted by shape_pt_sequence. */
  shapeCoords(shapeId: string): Float64Array {
    this.ready();
    const o = this.shapeOverrides.get(shapeId);
    if (o) {
      const out = new Float64Array(o.length * 2);
      o.forEach((r, i) => {
        out[2 * i] = parseFloat(r.shape_pt_lon ?? '');
        out[2 * i + 1] = parseFloat(r.shape_pt_lat ?? '');
      });
      return out;
    }
    return this.shapes?.coords(shapeId) ?? new Float64Array(0);
  }

  setShape(shapeId: string, rows: Row[]): void {
    this.ready();
    for (const r of rows) {
      for (const c of Object.keys(r)) {
        if (!this.shapeCols.includes(c)) {
          this.shapeCols.push(c);
        }
      }
    }
    const sorted = rows
      .map((r): Row => ({ ...r, shape_id: shapeId }))
      .sort(
        (a, b) =>
          (Number(a.shape_pt_sequence) || 0) -
            (Number(b.shape_pt_sequence) || 0) || 0
      );
    this.shapeOverrides.set(shapeId, sorted);
    console.log(
      `[FeedStore] shapes: ${shapeId} set to ${sorted.length} points`
    );
  }

  private shapePointCount(): number {
    let n = this.shapes?.n ?? 0;
    for (const [id, rows] of this.shapeOverrides) {
      if (this.shapes) {
        const [a, b] = this.shapes.range(id);
        n -= b - a;
      }
      n += rows.length;
    }
    return n;
  }

  // ---------- diagnostics ----------

  /** Approximate typed-array bytes and exception counts, for logging. */
  stats(): Record<string, unknown> {
    const out: Record<string, unknown> = { strings: this.pool.strs.length };
    for (const [name, t] of this.tables) {
      out[name] = {
        rows: t.size,
        bytes: t.base.bytes(),
        exceptions: t.base.exceptions(),
      };
    }
    if (this.patterns) {
      out[STOP_TIMES] = {
        trips: this.patterns.tripCount,
        patterns: this.patterns.patternCount,
        bytes: this.patterns.bytes(),
        exceptions: this.patterns.exceptions(),
      };
    }
    if (this.shapes) {
      out[SHAPES] = {
        points: this.shapes.n,
        bytes: this.shapes.bytes(),
        exceptions: this.shapes.exceptions(),
      };
    }
    return out;
  }
}

function seqOf(r: Row): number {
  const n = Number(r.stop_sequence);
  return r.stop_sequence === undefined ||
    r.stop_sequence === '' ||
    Number.isNaN(n)
    ? Infinity
    : n;
}
