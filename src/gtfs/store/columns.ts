/**
 * Columnar building blocks: chunked typed-array builders, a string interner,
 * encoded columns and CSR indexes.
 *
 * Every cell round-trips exactly. A value that does not fit its column's
 * encoding (a time like "8:5:00", an int like "007") is kept verbatim in the
 * column's exception map, so the encoding only ever affects memory, never
 * what is read back.
 */

export type TypedArray = Uint32Array | Int32Array | Uint8Array;
type Ctor<T extends TypedArray> = new (n: number) => T;

const CHUNK_BITS = 16;
const CHUNK = 1 << CHUNK_BITS;
const CHUNK_MASK = CHUNK - 1;

/**
 * Append-only typed array built in fixed-size chunks, so growing never copies
 * the whole array. `trim()` concatenates once into `a`.
 */
export class Grow<T extends TypedArray> {
  private chunks: T[] = [];
  a: T;
  n = 0;
  final = false;

  constructor(private C: Ctor<T>) {
    this.a = new C(0);
  }

  push(v: number): void {
    if (this.final) {
      throw new Error('[Columns] push after trim');
    }
    if ((this.n & CHUNK_MASK) === 0) {
      this.chunks.push(new this.C(CHUNK));
    }
    this.chunks[this.n >>> CHUNK_BITS][this.n & CHUNK_MASK] = v;
    this.n++;
  }

  at(i: number): number {
    return this.final
      ? this.a[i]
      : this.chunks[i >>> CHUNK_BITS][i & CHUNK_MASK];
  }

  trim(): T {
    if (this.final) {
      return this.a;
    }
    const a = new this.C(this.n);
    for (let c = 0; c < this.chunks.length; c++) {
      const len = Math.min(CHUNK, this.n - c * CHUNK);
      a.set(this.chunks[c].subarray(0, len) as never, c * CHUNK);
    }
    this.chunks = [];
    this.a = a;
    this.final = true;
    return a;
  }

  static from<T extends TypedArray>(C: Ctor<T>, a: T): Grow<T> {
    const g = new Grow(C);
    g.a = a;
    g.n = a.length;
    g.final = true;
    return g;
  }
}

/**
 * String pool. While loading, ids come from a `Map`; `freeze()` replaces it
 * with a sorted permutation that lookups binary-search, which is far smaller
 * than a `Map` of millions of trip ids.
 */
export class Interner {
  private map: Map<string, number> | null = new Map();
  strs: string[] = [];
  sorted: Uint32Array | null = null;

  constructor() {
    this.id('');
  }

  id(s: string): number {
    if (!this.map) {
      throw new Error('[Columns] interner is frozen');
    }
    let i = this.map.get(s);
    if (i === undefined) {
      // Parsed values are slices of a whole CSV chunk; a copy keeps the pool
      // from holding every chunk alive.
      const own = (' ' + s).slice(1);
      i = this.strs.length;
      this.strs.push(own);
      this.map.set(own, i);
    }
    return i;
  }

  /** Id of `s`, or -1 when the pool has never seen it. */
  lookup(s: string): number {
    if (this.map) {
      return this.map.get(s) ?? -1;
    }
    const p = this.sorted!;
    const strs = this.strs;
    let lo = 0;
    let hi = p.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = strs[p[mid]];
      if (v === s) {
        return p[mid];
      }
      if (v < s) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return -1;
  }

  freeze(): void {
    if (!this.map) {
      return;
    }
    const strs = this.strs;
    const p = new Uint32Array(strs.length);
    for (let i = 0; i < p.length; i++) {
      p[i] = i;
    }
    p.sort((a, b) => (strs[a] < strs[b] ? -1 : strs[a] > strs[b] ? 1 : 0));
    this.sorted = p;
    this.map = null;
  }

  static frozen(strs: string[], sorted: Uint32Array): Interner {
    const pool = new Interner();
    pool.strs = strs;
    pool.sorted = sorted;
    pool.map = null;
    return pool;
  }
}

export type Kind = 'str' | 'int' | 'time' | 'dec';

const INT_COLUMNS = new Set([
  'stop_sequence',
  'shape_pt_sequence',
  'pickup_type',
  'drop_off_type',
  'timepoint',
  'continuous_pickup',
  'continuous_drop_off',
  'direction_id',
  'exception_type',
  'wheelchair_accessible',
  'bikes_allowed',
  'transfer_type',
  'min_transfer_time',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'start_date',
  'end_date',
  'date',
]);
const DEC_COLUMNS = new Set([
  'shape_pt_lat',
  'shape_pt_lon',
  'shape_dist_traveled',
]);
const TIME_COLUMNS = new Set(['arrival_time', 'departure_time']);

/** Encoding for a column. Only a memory choice: any value round-trips. */
export function kindFor(col: string): Kind {
  if (TIME_COLUMNS.has(col)) {
    return 'time';
  }
  if (INT_COLUMNS.has(col)) {
    return 'int';
  }
  if (DEC_COLUMNS.has(col)) {
    return 'dec';
  }
  return 'str';
}

const EMPTY = -1;
const EXC = -2;
const DEC_EMPTY = 255;
const DEC_EXC = 254;
const TIME_RE = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;
const INT_RE = /^(0|[1-9]\d{0,8})$/;
const DEC_RE = /^-?\d+(\.\d+)?$/;
const POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9];

/** Seconds << 1, with bit 0 set when the hour had one digit ("8:05:00"). */
function decodeTime(v: number): string {
  const secs = v >> 1;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const hs = v & 1 ? String(h) : String(h).padStart(2, '0');
  return `${hs}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Output of `encode`, reused to avoid an allocation per cell. */
export interface Encoded {
  v: number;
  /** Decimal places (dec kind only). */
  d: number;
  /** The verbatim value when it does not fit the encoding. */
  x: string | undefined;
}

export function encode(kind: Kind, pool: Interner, s: string, out: Encoded) {
  out.x = undefined;
  out.d = 0;
  switch (kind) {
    case 'str':
      out.v = pool.id(s);
      return;
    case 'int':
      if (s === '') {
        out.v = EMPTY;
      } else if (INT_RE.test(s)) {
        out.v = +s;
      } else {
        out.v = EXC;
        out.x = s;
      }
      return;
    case 'time': {
      if (s === '') {
        out.v = EMPTY;
        return;
      }
      const m = TIME_RE.exec(s);
      if (m) {
        const v =
          ((+m[1] * 3600 + +m[2] * 60 + +m[3]) << 1) |
          (m[1].length === 1 ? 1 : 0);
        if (decodeTime(v) === s) {
          out.v = v;
          return;
        }
      }
      out.v = EXC;
      out.x = s;
      return;
    }
    case 'dec': {
      if (s === '') {
        out.v = 0;
        out.d = DEC_EMPTY;
        return;
      }
      if (DEC_RE.test(s)) {
        const dot = s.indexOf('.');
        const p = dot < 0 ? 0 : s.length - dot - 1;
        if (p <= 9) {
          const iv = Math.round(+s * POW10[p]);
          if (Math.abs(iv) <= 2147483647 && (iv / POW10[p]).toFixed(p) === s) {
            out.v = iv;
            out.d = p;
            return;
          }
        }
      }
      out.v = 0;
      out.d = DEC_EXC;
      out.x = s;
    }
  }
}

/** One encoded column: values, decimal places (dec kind), exceptions. */
export class Col {
  data: Grow<Int32Array> | Grow<Uint32Array>;
  dec: Grow<Uint8Array> | null = null;
  exc = new Map<number, string>();

  constructor(
    readonly kind: Kind,
    private pool: Interner
  ) {
    if (kind === 'str') {
      this.data = new Grow(Uint32Array);
    } else {
      this.data = new Grow(Int32Array);
      if (kind === 'dec') {
        this.dec = new Grow(Uint8Array);
      }
    }
  }

  get n(): number {
    return this.data.n;
  }

  push(s: string, scratch: Encoded): void {
    encode(this.kind, this.pool, s, scratch);
    this.pushEncoded(scratch.v, scratch.d, scratch.x);
  }

  pushEncoded(v: number, d: number, x: string | undefined): void {
    if (x !== undefined) {
      this.exc.set(this.data.n, x);
    }
    this.data.push(v);
    this.dec?.push(d);
  }

  get(r: number): string {
    const v = this.data.at(r);
    switch (this.kind) {
      case 'str':
        return this.pool.strs[v];
      case 'int':
        return v === EMPTY ? '' : v === EXC ? this.exc.get(r)! : String(v);
      case 'time':
        return v === EMPTY ? '' : v === EXC ? this.exc.get(r)! : decodeTime(v);
      case 'dec': {
        const p = this.dec!.at(r);
        return p === DEC_EMPTY
          ? ''
          : p === DEC_EXC
            ? this.exc.get(r)!
            : (v / POW10[p]).toFixed(p);
      }
    }
  }

  /**
   * Numeric value of a cell (seconds for a time). NaN when empty; a verbatim
   * value is parsed as a number ("1e3", "007"), times excepted.
   */
  num(r: number): number {
    const v = this.data.at(r);
    switch (this.kind) {
      case 'str':
        return parseNum(this.pool.strs[v]);
      case 'int':
        return v === EMPTY ? NaN : v === EXC ? parseNum(this.exc.get(r)!) : v;
      case 'time':
        return v < 0 ? NaN : v >> 1;
      case 'dec': {
        const p = this.dec!.at(r);
        return p === DEC_EMPTY
          ? NaN
          : p === DEC_EXC
            ? parseNum(this.exc.get(r)!)
            : v / POW10[p];
      }
    }
  }

  trim(): void {
    this.data.trim();
    this.dec?.trim();
  }

  bytes(): number {
    return this.data.a.byteLength + (this.dec?.a.byteLength ?? 0);
  }
}

function parseNum(s: string): number {
  return s.trim() === '' ? NaN : Number(s);
}

/** Index of `key` in an ascending array, or -1. */
export function bsearch(a: Uint32Array, key: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = a[mid];
    if (v === key) {
      return mid;
    }
    if (v < key) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return -1;
}

const NO_ROWS = new Uint32Array(0);

/** Rows grouped by key: sorted unique keys, offsets into `rows`. */
export class CSR {
  constructor(
    readonly keys: Uint32Array,
    readonly offs: Uint32Array,
    readonly rows: Uint32Array
  ) {}

  /** `keyOf[i]` is row i's key, every key below `keySpace`. */
  static build(keyOf: ArrayLike<number>, n: number, keySpace: number): CSR {
    const counts = new Uint32Array(keySpace);
    for (let i = 0; i < n; i++) {
      counts[keyOf[i]]++;
    }
    let k = 0;
    for (let i = 0; i < keySpace; i++) {
      if (counts[i]) {
        k++;
      }
    }
    const keys = new Uint32Array(k);
    const offs = new Uint32Array(k + 1);
    // counts becomes each key's write cursor.
    let j = 0;
    let acc = 0;
    for (let i = 0; i < keySpace; i++) {
      const c = counts[i];
      if (c) {
        keys[j] = i;
        offs[j] = acc;
        counts[i] = acc;
        acc += c;
        j++;
      }
    }
    offs[k] = acc;
    const rows = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      rows[counts[keyOf[i]]++] = i;
    }
    return new CSR(keys, offs, rows);
  }

  get(key: number): Uint32Array {
    const i = bsearch(this.keys, key);
    return i < 0 ? NO_ROWS : this.rows.subarray(this.offs[i], this.offs[i + 1]);
  }

  bytes(): number {
    return this.keys.byteLength + this.offs.byteLength + this.rows.byteLength;
  }
}

/** A permutation sorting `keys` ascending (stable). */
export function sortPermutation(keys: ArrayLike<number>): Uint32Array {
  const perm = new Uint32Array(keys.length);
  for (let i = 0; i < perm.length; i++) {
    perm[i] = i;
  }
  perm.sort((a, b) => keys[a] - keys[b] || a - b);
  return perm;
}

export function permute(a: Uint32Array, perm: Uint32Array): Uint32Array {
  const out = new Uint32Array(perm.length);
  for (let i = 0; i < perm.length; i++) {
    out[i] = a[perm[i]];
  }
  return out;
}
