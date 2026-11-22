import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPageStateCodec } from '../src/ui/page-state-schema';
import {
  TREE_PAGE_SPECS,
  tripLocationKey,
  tripLocationValid,
  type TreeLocation,
} from '../src/gtfs/tree-location';

type Modal = { type: 'help'; page?: string };

const codec = createPageStateCodec<TreeLocation, Modal>({
  pages: TREE_PAGE_SPECS,
  modals: { help: { page: { param: 'modal_page', optional: true } } },
  typeParam: 'type',
  untypedPages: ['stop', 'vehicle', 'alert', 'route'],
  migrate(params) {
    if (params.get('modal') === 'alerts') {
      params.delete('modal');
      params.set('type', 'service_alerts');
    }
    return params;
  },
});

const read = (hash: string) => codec.fromParams(new URLSearchParams(hash));

describe('createPageStateCodec', () => {
  it('reads typed pages, keyless ones included', () => {
    assert.deepEqual(read('type=trip_updates'), { type: 'trip_updates' });
    assert.deepEqual(read('type=agency&agency=a1'), {
      type: 'agency',
      agency_id: 'a1',
    });
  });

  it('sniffs untyped hashes in untypedPages order', () => {
    assert.deepEqual(read('route=r1&stop=s1'), { type: 'stop', stop_id: 's1' });
    assert.deepEqual(read('vehicle=v1'), {
      type: 'vehicle',
      vehicle_key: 'v1',
    });
    assert.deepEqual(read('rt_vp=x'), { type: 'home' });
  });

  it('prefers the type param over sniffing', () => {
    assert.deepEqual(read('type=trip&trip=t1&route=r1'), {
      type: 'trip',
      trip_id: 't1',
      route_id: 'r1',
    });
  });

  it('migrates before decoding and leaves the input alone', () => {
    const params = new URLSearchParams('route=r1&modal=alerts');
    assert.deepEqual(codec.fromParams(params), { type: 'service_alerts' });
    assert.equal(params.get('modal'), 'alerts');
  });

  it('always writes the type param', () => {
    const params = codec.toParams({ type: 'stop', stop_id: 's1' });
    assert.equal(params.toString(), 'type=stop&stop=s1');
  });
});

describe('trip locations', () => {
  it('needs a trip_id, or a route and a start time', () => {
    assert.equal(tripLocationValid({ type: 'trip', trip_id: 't' }), true);
    assert.equal(tripLocationValid({ type: 'trip', route_id: 'r' }), false);
    assert.equal(
      tripLocationValid({
        type: 'trip',
        route_id: 'r',
        start_time: '08:00:00',
      }),
      true
    );
  });

  it('keys a trip_id without its route hint', () => {
    assert.equal(
      tripLocationKey({ type: 'trip', trip_id: 't', route_id: 'r' }),
      tripLocationKey({ type: 'trip', trip_id: 't' })
    );
    assert.notEqual(
      tripLocationKey({ type: 'trip', trip_id: 't', start_date: '20261122' }),
      tripLocationKey({ type: 'trip', trip_id: 't' })
    );
  });
});
