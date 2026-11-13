import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import Papa from 'papaparse';

import { streamGtfsZip } from '../src/gtfs/store/csv-stream';
import { FeedStore, type StoreOptions } from '../src/gtfs/store/feed-store';
import { LoadCancelledError } from '../src/gtfs/feed-download';
import {
  readBase,
  writeBase,
  type ByteSource,
} from '../src/gtfs/store/base-file';
import {
  feedSummary,
  routeGeometries,
  routeTrips,
  tripsInfo,
} from '../src/gtfs/store/feed-queries';

type Files = Record<string, string>;

/** A byte stream of `bytes`, delivered in small chunks. */
function streamOf(bytes: Uint8Array, chunk = 37): ReadableStream<Uint8Array> {
  let off = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (off >= bytes.length) {
        ctrl.close();
        return;
      }
      ctrl.enqueue(bytes.slice(off, off + chunk));
      off += chunk;
    },
  });
}

function zip(files: Files): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))
  );
}

async function load(files: Files | Uint8Array, opts: StoreOptions = {}) {
  const store = new FeedStore(opts);
  const bytes = files instanceof Uint8Array ? files : zip(files);
  const result = await streamGtfsZip(streamOf(bytes), store.sinkFor);
  store.finish();
  return { store, result };
}

function parse(csv: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
  }).data;
}

const BASE: Files = {
  'agency.txt':
    '\uFEFFagency_id,agency_name,agency_url,agency_timezone\r\nA,"Agency, Inc.",https://a.example,Europe/Berlin\r\n',
  'stops.txt':
    'stop_id,stop_name,stop_lat,stop_lon,parent_station\nS1,One,52.5,13.4,\nS2,"Two\nlines",52.51,13.41,\nS3,Three,52.52,13.42,P\nP,Parent,52.52,13.42,\n',
  'routes.txt':
    'route_id,agency_id,route_short_name,route_type\nR1,A,1,3\nR2,A,2,3\n',
  'trips.txt':
    'route_id,service_id,trip_id,shape_id,direction_id\nR1,WK,T1,SH1,0\nR1,WK,T2,SH1,0\nR1,WK,T3,,1\nR2,WK,T4,SH2,0\n',
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,shape_dist_traveled',
    'T1,08:00:00,08:00:00,S1,1,0,0',
    'T1,08:05:00,08:06:00,S2,2,,1.50',
    'T1,08:10:00,08:10:00,S3,3,0,3.0',
    'T2,8:30:00,8:30:00,S1,1,0,0',
    'T2,08:35:00,08:36:00,S2,2,,1.50',
    'T2,25:10:00,25:10:00,S3,3,0,3.0',
    'T3,09:00:00,,S3,10,1,',
    'T3,9:5:00,,S1,2,007,',
    'T4,10:00:00,10:00:00,S2,1,0,0',
    'T4,,,S1,2,0,0.5',
  ].join('\n'),
  'shapes.txt': [
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
    'SH1,52.5,13.4,1',
    'SH1,52.51,13.41,2',
    'SH1,52.520000,13.42,3',
    'SH2,52.51,13.41,5',
    'SH2,-0.0,1e3,6',
  ].join('\n'),
  'calendar_dates.txt':
    'service_id,date,exception_type\nWK,20260101,2\nWK,20260102,1\n',
};

/** Every base table read back from the store equals the source CSV. */
function assertMatches(store: FeedStore, files: Files) {
  for (const [file, csv] of Object.entries(files)) {
    const table = file.replace('.txt', '');
    const expected = parse(csv);
    if (table === 'stop_times') {
      const byTrip = new Map<string, Record<string, string>[]>();
      for (const r of expected) {
        byTrip.set(r.trip_id, [...(byTrip.get(r.trip_id) ?? []), r]);
      }
      for (const [trip, rows] of byTrip) {
        rows.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
        assert.deepEqual(store.stopTimesForTrip(trip), rows, `trip ${trip}`);
      }
    } else if (table === 'shapes') {
      const byShape = new Map<string, Record<string, string>[]>();
      for (const r of expected) {
        byShape.set(r.shape_id, [...(byShape.get(r.shape_id) ?? []), r]);
      }
      for (const [shape, rows] of byShape) {
        rows.sort(
          (a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
        );
        assert.deepEqual(store.shapeRows(shape), rows, `shape ${shape}`);
      }
    } else {
      assert.deepEqual(
        store.rows(table).map((r) => r.row),
        expected,
        table
      );
    }
  }
}

describe('streamGtfsZip + FeedStore', () => {
  it('reads every table back exactly', async () => {
    const { store, result } = await load(BASE);
    assertMatches(store, BASE);
    assert.equal(result.rows.stop_times, 10);
    assert.equal(store.counts().stop_times, 10);
    assert.equal(store.counts().shapes, 5);
  });

  it('shares patterns between trips with identical stops', async () => {
    const { store } = await load(BASE);
    // T1 and T2 share every non-time cell; T3 and T4 differ.
    assert.equal(store.patterns!.patternCount, 3);
  });

  it('merges a trip whose rows are split over several runs', async () => {
    const files = {
      ...BASE,
      'stop_times.txt': [
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
        'T1,08:10:00,08:10:00,S3,3',
        'T2,08:30:00,08:30:00,S1,1',
        'T1,08:00:00,08:00:00,S1,1',
        'T2,08:35:00,08:35:00,S2,2',
        'T1,08:05:00,08:05:00,S2,2',
      ].join('\n'),
    };
    const { store } = await load(files);
    assertMatches(store, files);
    assert.equal(store.counts().stop_times, 5);
    assert.deepEqual(store.tripsWithStopTimes().sort(), ['T1', 'T2']);
  });

  it('regroups shapes whose ids are not contiguous', async () => {
    const files = {
      ...BASE,
      'shapes.txt': [
        'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
        'A,1.0,2.0,1',
        'B,3.0,4.0,1',
        'A,1.5,2.5,2',
        'B,3.5,4.5,3',
        'A,1.7,2.7,5',
      ].join('\n'),
    };
    const { store } = await load(files);
    assertMatches(store, files);
    assert.deepEqual(
      Array.from(store.shapeCoords('A')),
      [2, 1, 2.5, 1.5, 2.7, 1.7]
    );
  });

  it('reads tables inside a nested archive', async () => {
    const inner = zip(BASE);
    const outer = zipSync({
      'readme.txt': strToU8('hello'),
      'gtfs/feed.zip': inner,
    });
    const store = new FeedStore();
    await streamGtfsZip(streamOf(outer, 1000), store.sinkFor, {
      innerPaths: ['gtfs/feed.zip'],
    });
    store.finish();
    assertMatches(store, BASE);
    assert.equal(store.hasTable('readme'), false);
  });

  it('names the nested archives when the inner path is wrong', async () => {
    const outer = zipSync({ 'a.zip': zip(BASE), 'b.zip': zip(BASE) });
    await assert.rejects(
      streamGtfsZip(streamOf(outer, 1000), new FeedStore().sinkFor, {
        innerPaths: ['c.zip'],
      }),
      /no entry "c.zip"; it contains a.zip, b.zip/
    );
  });

  it('trims padded values and counts them', async () => {
    const files = {
      'stops.txt': 'stop_id , stop_name\n  5,Main St \n6,Elm\n',
    };
    const { store, result } = await load(files);
    assert.deepEqual(
      store.rows('stops').map((r) => r.row),
      [
        { stop_id: '5', stop_name: 'Main St' },
        { stop_id: '6', stop_name: 'Elm' },
      ]
    );
    assert.deepEqual(result.padded, {
      'stops.stop_id': 1,
      'stops.stop_name': 1,
    });
  });

  it('keeps stop lists without times in patterns mode', async () => {
    const { store } = await load(BASE, { stopTimes: 'patterns' });
    assert.deepEqual(
      store.tripStops('T3').map((s) => s.stop_id),
      ['S1', 'S3']
    );
    assert.deepEqual(store.tripsAtStop('S3').sort(), ['T1', 'T2', 'T3']);
    assert.throws(() => store.stopTimesForTrip('T1'), /without times/);
  });

  it('skips stop_times and chosen tables', async () => {
    const { store, result } = await load(BASE, {
      stopTimes: 'skip',
      skipTables: ['shapes'],
    });
    assert.equal(store.hasTable('stop_times'), false);
    assert.equal(store.hasTable('shapes'), false);
    assert.equal(result.rows.stop_times, undefined);
  });

  it('rejects when a sink throws', async () => {
    const store = new FeedStore();
    await assert.rejects(
      streamGtfsZip(streamOf(zip(BASE)), (table) => {
        const sink = store.sinkFor(table);
        if (table !== 'trips' || !sink) {
          return sink;
        }
        return {
          ...sink,
          rows: () => {
            throw new Error('boom');
          },
        };
      }),
      /boom/
    );
  });

  it('stops on abort', async () => {
    const ctrl = new AbortController();
    let n = 0;
    const big = zip({
      ...BASE,
      'stop_times.txt':
        'trip_id,stop_id,stop_sequence\n' +
        Array.from({ length: 20000 }, (_, i) => `T${i},S1,1`).join('\n'),
    });
    await assert.rejects(
      streamGtfsZip(streamOf(big, 64), new FeedStore().sinkFor, {
        signal: ctrl.signal,
        onBytes: () => {
          if (++n === 20) {
            ctrl.abort();
          }
        },
      }),
      LoadCancelledError
    );
  });
});

describe('FeedStore edits', () => {
  it('updates, deletes and inserts rows with stable ids', async () => {
    const { store } = await load(BASE);
    const [r1] = store.find('routes', 'route_id', 'R1');
    store.updateRow('routes', r1.id, { ...r1.row, route_short_name: '1X' });
    const [r2] = store.find('routes', 'route_id', 'R2');
    store.deleteRow('routes', r2.id);
    const id = store.insertRow('routes', {
      route_id: 'R3',
      agency_id: 'A',
      route_short_name: '3',
      route_type: '3',
      route_color: 'FF0000',
    });
    assert.deepEqual(
      store
        .rows('routes')
        .map((r) => [
          r.id,
          r.row.route_id,
          r.row.route_short_name,
          r.row.route_color,
        ]),
      [
        [0, 'R1', '1X', ''],
        [id, 'R3', '3', 'FF0000'],
      ]
    );
    assert.equal(store.counts().routes, 2);
    assert.equal(store.find('routes', 'route_id', 'R2').length, 0);
    assert.equal(store.find('routes', 'route_short_name', '1').length, 0);
    assert.equal(store.find('routes', 'route_short_name', '1X')[0].id, 0);
    assert.equal(store.find('routes', 'route_color', 'FF0000')[0].id, id);
    assert.equal(store.find('routes', 'route_color', '').length, 1);
    store.deleteRow('routes', id);
    assert.equal(store.row('routes', id), null);
    assert.throws(() => store.updateRow('routes', id, {}), /no row/);
  });

  it('returns copies', async () => {
    const { store } = await load(BASE);
    store.rows('routes')[0].row.route_id = 'mutated';
    store.stopTimesForTrip('T1')[0].stop_id = 'mutated';
    assert.equal(store.row('routes', 0)!.route_id, 'R1');
    assert.equal(store.stopTimesForTrip('T1')[0].stop_id, 'S1');
    const rows = [{ stop_id: 'S9', stop_sequence: '1' }];
    store.setTripStopTimes('T9', rows);
    rows[0].stop_id = 'mutated';
    assert.equal(store.stopTimesForTrip('T9')[0].stop_id, 'S9');
  });

  it('overrides a trip and keeps stop lookups right', async () => {
    const { store } = await load(BASE);
    const rows = store.stopTimesForTrip('T1').filter((r) => r.stop_id !== 'S3');
    rows.push({ ...rows[0], stop_id: 'S9', stop_sequence: '0' });
    store.setTripStopTimes('T1', rows);
    assert.deepEqual(
      store.stopTimesForTrip('T1').map((r) => r.stop_id),
      ['S9', 'S1', 'S2']
    );
    assert.deepEqual(store.tripsAtStop('S3').sort(), ['T2', 'T3']);
    assert.deepEqual(store.tripsAtStop('S9'), ['T1']);
    // T2 shared T1's pattern and must be untouched.
    assert.deepEqual(
      store.stopTimesForTrip('T2').map((r) => r.stop_id),
      ['S1', 'S2', 'S3']
    );
    assert.equal(store.counts().stop_times, 10);
    store.setTripStopTimes('T4', []);
    assert.equal(store.counts().stop_times, 8);
    assert.deepEqual(store.stopTimesForTrip('T4'), []);
    assert.deepEqual(store.tripsWithStopTimes().sort(), ['T1', 'T2', 'T3']);
  });

  it('overrides and removes shapes', async () => {
    const { store } = await load(BASE);
    store.setShape('SH1', [
      { shape_pt_lat: '1', shape_pt_lon: '2', shape_pt_sequence: '2' },
      { shape_pt_lat: '3', shape_pt_lon: '4', shape_pt_sequence: '1' },
    ]);
    assert.deepEqual(Array.from(store.shapeCoords('SH1')), [4, 3, 2, 1]);
    assert.equal(store.shapeRows('SH1')[0].shape_id, 'SH1');
    store.setShape('SH2', []);
    assert.deepEqual(store.shapeIds(), ['SH1']);
    assert.equal(store.counts().shapes, 2);
  });

  it('creates a table the feed did not have', async () => {
    const { store } = await load(BASE);
    store.ensureTable('levels', ['level_id', 'level_index']);
    const id = store.insertRow('levels', { level_id: 'L0', level_index: '0' });
    assert.deepEqual(store.rows('levels'), [
      { id, row: { level_id: 'L0', level_index: '0' } },
    ]);
  });
});

describe('feed queries', () => {
  it('summarizes trips and routes per stop', async () => {
    const { store } = await load(BASE);
    const s = feedSummary(store);
    assert.deepEqual(s.tripsPerRoute, { R1: 3, R2: 1 });
    assert.deepEqual(s.tripsPerStop, { S1: 4, S2: 3, S3: 3 });
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(s.routesPerStop).map(([k, v]) => [k, v.sort()])
      ),
      { S1: ['R1', 'R2'], S2: ['R1', 'R2'], S3: ['R1'] }
    );
  });

  it('draws shapes once and falls back to stops', async () => {
    const { store } = await load(BASE);
    const geo = Object.fromEntries(
      routeGeometries(store).map((g) => [g.routeId, g])
    );
    // R1: SH1 once (T1, T2), plus T3's stop line S1 -> S3.
    assert.deepEqual(Array.from(geo.R1.lineStarts), [0, 3]);
    assert.deepEqual(
      Array.from(geo.R1.coords).slice(6),
      [13.4, 52.5, 13.42, 52.52]
    );
    // R2: SH2 has two points, so it is drawn as is.
    assert.deepEqual(Array.from(geo.R2.coords), [13.41, 52.51, 1000, -0]);
  });

  it("lists a route's trips with shared stop lists", async () => {
    const { store } = await load(BASE);
    const r = routeTrips(store, 'R1');
    assert.deepEqual(
      r.trips.map((t) => t.trip_id),
      ['T1', 'T2', 'T3']
    );
    assert.deepEqual(r.tripList, [0, 0, 1]);
    assert.deepEqual(r.stopLists[1], [
      { stop_id: 'S1', stop_sequence: '2' },
      { stop_id: 'S3', stop_sequence: '10' },
    ]);
  });

  it('returns trips and stop_times by id', async () => {
    const { store } = await load(BASE);
    const info = tripsInfo(store, ['T4', 'nope']);
    assert.equal(info.trips.T4.route_id, 'R2');
    assert.equal(info.trips.nope, undefined);
    assert.equal(info.stopTimes.T4.length, 2);
    assert.deepEqual(info.stopTimes.nope, []);
  });
});

/** Write the store's base into memory and return it as a source. */
function saveToMemory(
  store: FeedStore,
  result: Awaited<ReturnType<typeof load>>['result']
): { bytes: Uint8Array; src: ByteSource } {
  let bytes = new Uint8Array(0);
  const size = writeBase(store, result, {
    write(chunk, at) {
      if (at + chunk.length > bytes.length) {
        const grown = new Uint8Array(at + chunk.length);
        grown.set(bytes);
        bytes = grown;
      }
      bytes.set(chunk, at);
    },
  });
  assert.equal(size, bytes.length);
  return { bytes, src: memorySource(bytes) };
}

function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read(into, at) {
      into.set(bytes.subarray(at, at + into.length));
    },
  };
}

describe('base file', () => {
  it('restores every table, count, summary and lookup exactly', async () => {
    const { store, result } = await load(BASE);
    const { src } = saveToMemory(store, result);
    const back = readBase(src);
    assertMatches(back.store, BASE);
    assert.deepEqual(back.stream, result);
    assert.deepEqual(back.store.counts(), store.counts());
    assert.deepEqual(back.store.stats(), store.stats());
    assert.deepEqual(feedSummary(back.store), feedSummary(store));
    assert.deepEqual(routeGeometries(back.store), routeGeometries(store));
    assert.deepEqual(
      back.store.tripsAtStop('S2').sort(),
      store.tripsAtStop('S2').sort()
    );
    assert.deepEqual(
      back.store.find('trips', 'route_id', 'R1'),
      store.find('trips', 'route_id', 'R1')
    );
    assert.equal(back.store.hasEdits(), false);
  });

  it('keeps split trips, regrouped shapes and unusual strings', async () => {
    const files = {
      ...BASE,
      'stops.txt':
        'stop_id,stop_name,stop_lat,stop_lon\nS1,Zürich HB \u{1F686},47.37,8.54\nS2,"a\u0000b",1,2\nS3,,3,4\n',
      'stop_times.txt': [
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
        'T1,08:00:00,08:00:00,S1,1',
        'T2,09:00:00,09:00:00,S1,1',
        'T1,08:05:00,08:05:00,S2,2',
      ].join('\n'),
      'shapes.txt': [
        'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
        'SH1,52.5,13.4,1',
        'SH2,52.51,13.41,1',
        'SH1,52.52,13.42,2',
      ].join('\n'),
    };
    const { store, result } = await load(files);
    const back = readBase(saveToMemory(store, result).src).store;
    assertMatches(back, files);
  });

  it('restores patterns mode without times', async () => {
    const { store, result } = await load(BASE, { stopTimes: 'patterns' });
    const back = readBase(saveToMemory(store, result).src).store;
    assert.equal(back.stopTimesMode, 'patterns');
    assert.deepEqual(back.tripStops('T1'), store.tripStops('T1'));
    assert.throws(() => back.stopTimesForTrip('T1'));
  });

  it('accepts edits after a restore', async () => {
    const { store, result } = await load(BASE);
    const back = readBase(saveToMemory(store, result).src).store;
    const id = back.insertRow('routes', { route_id: 'R3', route_type: '0' });
    assert.equal(back.row('routes', id)!.route_id, 'R3');
    back.setTripStopTimes('T1', []);
    assert.deepEqual(back.stopTimesForTrip('T1'), []);
    assert.equal(back.hasEdits(), true);
  });

  it('refuses to write a store with edits', async () => {
    const { store, result } = await load(BASE);
    store.updateRow('routes', 0, {
      ...store.row('routes', 0)!,
      route_type: '0',
    });
    assert.throws(() => saveToMemory(store, result), /unedited/);
  });

  it('rejects a truncated or foreign file', async () => {
    const { store, result } = await load(BASE);
    const { bytes } = saveToMemory(store, result);
    assert.throws(
      () => readBase(memorySource(bytes.subarray(0, bytes.length - 8))),
      /incomplete/
    );
    const foreign = bytes.slice();
    foreign[0] = 0;
    assert.throws(() => readBase(memorySource(foreign)), /not a feed base/);
  });
});

/** Every table of `a` reads the same as `b`, ignoring row ids. */
function assertSameView(a: FeedStore, b: FeedStore) {
  assert.deepEqual(a.counts(), b.counts());
  for (const table of b.tableNames()) {
    if (table === 'stop_times') {
      for (const trip of b.tripsWithStopTimes()) {
        assert.deepEqual(a.stopTimesForTrip(trip), b.stopTimesForTrip(trip));
      }
    } else if (table === 'shapes') {
      assert.deepEqual(a.shapeIds().sort(), b.shapeIds().sort());
      for (const shape of b.shapeIds()) {
        assert.deepEqual(a.shapeRows(shape), b.shapeRows(shape));
      }
    } else {
      assert.deepEqual(
        a.rows(table).map((r) => r.row),
        b.rows(table).map((r) => r.row),
        table
      );
    }
  }
}

describe('key lookup and fold', () => {
  it('finds rows by a composite key', async () => {
    const { store } = await load(BASE);
    const hits = store.findKey(
      'calendar_dates',
      ['service_id', 'date'],
      ['WK', '20260102']
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].row.exception_type, '1');
    assert.deepEqual(
      store.findKey('calendar_dates', ['service_id', 'date'], ['WK', '1']),
      []
    );
    assert.throws(() => store.findKey('calendar_dates', ['service_id'], []));
  });

  it('reports every ordinary row change', async () => {
    const { store } = await load(BASE);
    const seen: string[] = [];
    store.onRowChange = (table, id) => seen.push(`${table}:${id}`);
    const id = store.insertRow('routes', { route_id: 'R3' });
    store.updateRow('routes', 0, {
      ...store.row('routes', 0)!,
      route_type: '0',
    });
    store.deleteRow('routes', id);
    assert.deepEqual(seen, [`routes:${id}`, 'routes:0', `routes:${id}`]);
  });

  it('folds edits into an unedited store with the same view', async () => {
    const { store, result } = await load(BASE);
    store.updateRow('routes', 0, {
      ...store.row('routes', 0)!,
      route_short_name: '1X',
      route_color: 'FF0000',
    });
    store.deleteRow('routes', 1);
    store.insertRow('routes', { route_id: 'R9', agency_id: 'A' });
    store.setTripStopTimes('T3', []);
    store.setTripStopTimes('T5', [
      { stop_id: 'S1', stop_sequence: '1', arrival_time: '7:00:00' },
      { stop_id: 'S9', stop_sequence: '2', arrival_time: '07:10:00' },
    ]);
    store.setShape('SH2', []);
    store.setShape('SH3', [
      { shape_pt_lat: '1.5', shape_pt_lon: '2', shape_pt_sequence: '1' },
    ]);
    store.ensureTable('levels', ['level_id', 'level_index']);
    store.insertRow('levels', { level_id: 'L0', level_index: '0' });

    const folded = store.fold(2);
    assert.equal(folded.hasEdits(), false);
    assertSameView(folded, store);
    const back = readBase(saveToMemory(folded, result).src).store;
    assertSameView(back, store);
  });

  it('refuses to fold without stop_times times', async () => {
    const { store } = await load(BASE, { stopTimes: 'patterns' });
    assert.throws(() => store.fold(), /without times/);
  });
});
