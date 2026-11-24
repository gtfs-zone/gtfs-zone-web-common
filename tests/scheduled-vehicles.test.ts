import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';

import { streamGtfsZip } from '../src/gtfs/store/csv-stream';
import { FeedStore } from '../src/gtfs/store/feed-store';
import { scheduledVehicles } from '../src/gtfs/store/scheduled-vehicles';
import { routeDayTrips } from '../src/gtfs/store/feed-queries';

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

// An L-shaped shape (east, then north), a loop out and back, the L with
// shape_dist_traveled, and a shape far from its stops.
const SHAPED: Record<string, string> = {
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon',
    'A,A,0,0',
    'D,D,0.01,0.01',
    'X,X,0,0.02',
    'M,M,0.003,0.005',
    'F,F,0.1,0.1',
  ].join('\n'),
  'routes.txt': 'route_id,route_type\nR,3\n',
  'trips.txt': [
    'route_id,service_id,trip_id,shape_id',
    'R,WK,L1,L',
    'R,WK,O1,O',
    'R,WK,S1,SD',
    'R,WK,N1,L',
    'R,WK,F1,L',
  ].join('\n'),
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled',
    'L1,08:00:00,08:00:00,A,1,',
    'L1,08:10:00,08:10:00,D,2,',
    'O1,09:00:00,09:00:00,A,1,',
    'O1,09:10:00,09:10:00,X,2,',
    'O1,09:20:00,09:20:00,A,3,',
    'S1,10:00:00,10:00:00,A,1,0',
    'S1,10:10:00,10:10:00,M,2,15',
    'S1,10:20:00,10:20:00,D,3,20',
    'N1,11:00:00,11:00:00,A,1,',
    'N1,11:10:00,11:10:00,D,2,',
    'F1,12:00:00,12:00:00,A,1,',
    'F1,12:10:00,12:10:00,F,2,',
  ].join('\n'),
  'shapes.txt': [
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled',
    'L,0,0,1,',
    'L,0,0.01,2,',
    'L,0.01,0.01,3,',
    'O,0,0,1,',
    'O,0,0.02,2,',
    'O,0,0,3,',
    'SD,0,0,1,0',
    'SD,0,0.01,2,10',
    'SD,0.01,0.01,3,20',
  ].join('\n'),
  'calendar.txt': [
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'WK,1,1,1,1,1,0,0,20260101,20261231',
  ].join('\n'),
};

async function load(feed = FEED): Promise<FeedStore> {
  const bytes = zipSync(
    Object.fromEntries(Object.entries(feed).map(([k, v]) => [k, strToU8(v)]))
  );
  const store = new FeedStore();
  await streamGtfsZip(new Blob([bytes]).stream(), store.sinkFor);
  store.finish();
  return store;
}

const sec = (h: number, m: number) => h * 3600 + m * 60;
const near = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

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

describe('scheduledVehicles along the shape', () => {
  const at = async (h: number, m: number, sec = 0) => {
    const store = await load(SHAPED);
    const r = scheduledVehicles(store, [
      { date: '20261109', seconds: h * 3600 + m * 60 + sec },
    ]);
    assert.equal(r.vehicles.length, 1);
    return r.vehicles[0];
  };

  it('follows a projected shape around a corner', async () => {
    const east = await at(8, 2, 30);
    near(east.lon, 0.005, 1e-6);
    near(east.lat, 0, 1e-6);
    near(east.bearing!, 90, 1e-6);
    const north = await at(8, 7, 30);
    near(north.lon, 0.01, 1e-6);
    near(north.lat, 0.005, 1e-6);
    near(north.bearing!, 0, 1e-6);
    const end = await at(8, 10);
    assert.equal(end.status, 1);
    assert.equal(end.bearing, undefined);
  });

  it('keeps a loop in stop order', async () => {
    const back = await at(9, 15);
    assert.equal(back.stopId, 'A');
    assert.equal(back.stopSequence, '3');
    near(back.lon, 0.01, 1e-6);
    near(back.bearing!, 270, 1e-6);
  });

  it('places stops by shape_dist_traveled', async () => {
    // M is at 15 of 20, halfway up the north leg, though it sits nearer the
    // east leg.
    const m = await at(10, 10);
    assert.equal(m.stopId, 'M');
    assert.equal(m.status, 1);
    near(m.lon, 0.01, 1e-6);
    near(m.lat, 0.005, 1e-6);
  });

  it('falls back to the stop-to-stop line far from the shape', async () => {
    const v = await at(12, 5);
    near(v.lon, 0.05);
    near(v.lat, 0.05);
  });
});

describe('routeDayTrips', () => {
  it('lists the trips running on a date by first departure', async () => {
    const store = await load();
    assert.deepEqual(routeDayTrips(store, 'R1', '20261118'), [
      { trip_id: 'T1', departure: '08:00:00' },
      { trip_id: 'T3', departure: '10:05:00' },
      { trip_id: 'T2', departure: '23:50:00' },
    ]);
  });

  it('applies calendar_dates removals and additions', async () => {
    const store = await load();
    assert.deepEqual(routeDayTrips(store, 'R1', '20261116'), []);
    assert.deepEqual(routeDayTrips(store, 'R2', '20261117'), [
      { trip_id: 'F1', departure: '06:00:00' },
    ]);
  });
});
