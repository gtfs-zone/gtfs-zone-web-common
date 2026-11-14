import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';

import { streamGtfsZip } from '../src/gtfs/store/csv-stream';
import { FeedStore } from '../src/gtfs/store/feed-store';
import { scheduledVehicles } from '../src/gtfs/store/scheduled-vehicles';

const FEED: Record<string, string> = {
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon,parent_station',
    'A,A,0,0,',
    'B,B,0,0.01,',
    'P,P,0,0.02,',
    'C,C,,,P',
  ].join('\n'),
  'routes.txt': 'route_id,route_type\nR1,3\nR2,3\n',
  'trips.txt': [
    'route_id,service_id,trip_id,direction_id',
    'R1,WK,T1,0',
    'R1,WK,T2,1',
    'R1,WK,T3,0',
    'R2,SA,F1,',
  ].join('\n'),
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled',
    'T1,08:00:00,08:00:00,A,1,0',
    'T1,,,B,2,3',
    'T1,08:20:00,08:20:00,C,3,4',
    'T2,23:50:00,23:50:00,A,1,',
    'T2,24:30:00,24:30:00,C,2,',
    'T3,10:00:00,10:05:00,A,1,',
    'T3,10:10:00,10:10:00,B,2,',
    'F1,06:00:00,06:00:00,A,1,',
    'F1,06:10:00,06:10:00,C,2,',
  ].join('\n'),
  'calendar.txt': [
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'WK,1,1,1,1,1,0,0,20260101,20261231',
    'SA,0,0,0,0,0,1,0,20260101,20261231',
  ].join('\n'),
  'calendar_dates.txt':
    'service_id,date,exception_type\nWK,20261116,2\nSA,20261117,1\n',
  'frequencies.txt':
    'trip_id,start_time,end_time,headway_secs\nF1,06:00:00,07:00:00,1800\n',
};

async function load(): Promise<FeedStore> {
  const bytes = zipSync(
    Object.fromEntries(Object.entries(FEED).map(([k, v]) => [k, strToU8(v)]))
  );
  const store = new FeedStore();
  await streamGtfsZip(new Blob([bytes]).stream(), store.sinkFor);
  store.finish();
  return store;
}

const sec = (h: number, m: number) => h * 3600 + m * 60;
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

describe('scheduledVehicles', () => {
  it('interpolates an untimed stop by shape_dist_traveled', async () => {
    const store = await load();
    // B is 3/4 of the way by distance, so at 08:15; 08:10 is 2/3 of A -> B.
    const r = scheduledVehicles(store, [
      { date: '20261109', seconds: sec(8, 10) },
    ]);
    assert.equal(r.running, 1);
    const [v] = r.vehicles;
    assert.equal(v.tripId, 'T1');
    assert.equal(v.status, 2);
    assert.equal(v.stopId, 'B');
    near(v.lon, 0.01 * (2 / 3));
    near(v.bearing!, 90);
    assert.equal(v.key, 'sched:T1:20261109');

    const [at] = scheduledVehicles(store, [
      { date: '20261109', seconds: sec(8, 15) },
    ]).vehicles;
    assert.equal(at.status, 1);
    assert.equal(at.stopId, 'B');
  });

  it('dwells at a stop and uses the parent station position', async () => {
    const store = await load();
    const [dwell] = scheduledVehicles(store, [
      { date: '20261109', seconds: sec(10, 2) },
    ]).vehicles;
    assert.equal(dwell.tripId, 'T3');
    assert.equal(dwell.status, 1);
    assert.equal(dwell.stopId, 'A');

    const [end] = scheduledVehicles(store, [
      { date: '20261109', seconds: sec(8, 20) },
    ]).vehicles;
    assert.equal(end.stopId, 'C');
    near(end.lon, 0.02);
    assert.equal(end.bearing, undefined);
  });

  it('runs a trip past 24:00 on the previous service date', async () => {
    const store = await load();
    const r = scheduledVehicles(store, [
      { date: '20261110', seconds: sec(0, 10) },
      { date: '20261109', seconds: sec(24, 10) },
    ]);
    assert.deepEqual(
      r.vehicles.map((v) => [v.tripId, v.startDate]),
      [['T2', '20261109']]
    );
    near(r.vehicles[0].lon, 0.01);
  });

  it('applies calendar_dates and expands frequencies', async () => {
    const store = await load();
    assert.equal(
      scheduledVehicles(store, [{ date: '20261116', seconds: sec(8, 10) }])
        .running,
      0
    );
    const [v] = scheduledVehicles(store, [
      { date: '20261117', seconds: sec(6, 35) },
    ]).vehicles;
    assert.equal(v.tripId, 'F1');
    assert.equal(v.startTime, '06:30:00');
    assert.equal(v.key, 'sched:F1:20261117:06:30:00');
    near(v.lon, 0.01);

    const sat = scheduledVehicles(store, [
      { date: '20261114', seconds: sec(6, 5) },
    ]);
    assert.deepEqual(
      sat.vehicles.map((x) => x.startTime),
      ['06:00:00']
    );
  });

  it('caps the list and still counts every run', async () => {
    const store = await load();
    const r = scheduledVehicles(
      store,
      [
        { date: '20261114', seconds: sec(6, 5) },
        { date: '20261117', seconds: sec(6, 35) },
      ],
      1
    );
    assert.equal(r.running, 2);
    assert.equal(r.vehicles.length, 1);
  });

  it('rebuilds after an edit', async () => {
    const store = await load();
    const w = [{ date: '20261109', seconds: sec(9, 10) }];
    assert.equal(scheduledVehicles(store, w).running, 0);
    store.setTripStopTimes('T1', [
      {
        arrival_time: '09:00:00',
        departure_time: '09:00:00',
        stop_id: 'A',
        stop_sequence: '1',
      },
      {
        arrival_time: '09:20:00',
        departure_time: '09:20:00',
        stop_id: 'B',
        stop_sequence: '2',
      },
    ]);
    const [v] = scheduledVehicles(store, w).vehicles;
    assert.equal(v.tripId, 'T1');
    near(v.lon, 0.005);
  });
});
