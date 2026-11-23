/** A whole table stored column by column, in file order. */

import {
  Col,
  CSR,
  Grow,
  kindFor,
  type Encoded,
  type Interner,
} from './columns';

export type Row = Record<string, string>;

export class ColTable {
  cols: string[] = [];
  data: Col[] = [];
  n = 0;
  /** Each row's first line in the file, when the parser counted lines. */
  lines: Grow<Uint32Array> | null = null;
  private scratch: Encoded = { v: 0, d: 0, x: undefined };
  private indexes = new Map<string, CSR>();

  constructor(
    readonly name: string,
    private pool: Interner
  ) {}

  setHeader(cols: string[]): void {
    this.cols = cols;
    this.data = cols.map((c) => new Col(kindFor(c), this.pool));
  }

  pushRow(r: string[], line?: number): void {
    if (line !== undefined) {
      (this.lines ??= new Grow(Uint32Array)).push(line);
    }
    const d = this.data;
    for (let c = 0; c < d.length; c++) {
      d[c].push(r[c] ?? '', this.scratch);
    }
    this.n++;
  }

  end(): void {
    for (const c of this.data) {
      c.trim();
    }
    this.lines?.trim();
  }

  /** Row `r`'s first line in the file, or null when lines were not counted. */
  line(r: number): number | null {
    return this.lines && r < this.lines.n ? this.lines.at(r) : null;
  }

  col(name: string): Col | undefined {
    const i = this.cols.indexOf(name);
    return i < 0 ? undefined : this.data[i];
  }

  /** A fresh object for row `r`. */
  row(r: number): Row {
    const o: Row = {};
    for (let c = 0; c < this.cols.length; c++) {
      o[this.cols[c]] = this.data[c].get(r);
    }
    return o;
  }

  get(r: number, col: string): string {
    return this.col(col)?.get(r) ?? '';
  }

  /**
   * Base rows whose `col` equals `value`, through a CSR built on first use.
   * Only string columns are indexed; any other column is scanned.
   */
  find(col: string, value: string): ArrayLike<number> {
    const c = this.col(col);
    if (!c) {
      return value === '' ? range(this.n) : [];
    }
    if (c.kind !== 'str') {
      const out: number[] = [];
      for (let r = 0; r < this.n; r++) {
        if (c.get(r) === value) {
          out.push(r);
        }
      }
      return out;
    }
    let idx = this.indexes.get(col);
    if (!idx) {
      idx = CSR.build(c.data.a, this.n, this.pool.strs.length);
      this.indexes.set(col, idx);
      console.log(`[ColTable] ${this.name}.${col}: index built`);
    }
    const id = this.pool.lookup(value);
    return id < 0 ? [] : idx.get(id);
  }

  bytes(): number {
    let b = 0;
    for (const c of this.data) {
      b += c.bytes();
    }
    for (const i of this.indexes.values()) {
      b += i.bytes();
    }
    b += this.lines?.a.byteLength ?? 0;
    return b;
  }

  exceptions(): number {
    let e = 0;
    for (const c of this.data) {
      e += c.exc.size;
    }
    return e;
  }
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
