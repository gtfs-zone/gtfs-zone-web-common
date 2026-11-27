import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { PageStateManager } from '../src/ui/page-state-manager';

type State = { type: string; id?: string; modal?: undefined };

function manager(): PageStateManager<State> {
  return new PageStateManager<State>({
    codec: {
      toParams: () => new URLSearchParams(),
      fromParams: () => ({ type: 'home' }),
      isPageState: (v): v is State => typeof v === 'object' && v !== null,
    },
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PageStateManager preparer', () => {
  it('applies at once when the preparer has nothing to load', () => {
    const pages = manager();
    pages.setStatePreparer(() => undefined);
    pages.setPageState({ type: 'trip', id: 'a' });
    assert.equal(pages.getPageState().id, 'a');
  });

  it('waits for the preparer before applying', async () => {
    const pages = manager();
    const load = deferred();
    pages.setStatePreparer(() => load.promise);
    pages.setPageState({ type: 'trip', id: 'a' });
    assert.equal(pages.getPageState().type, 'home');
    load.resolve();
    await load.promise;
    await Promise.resolve();
    assert.equal(pages.getPageState().id, 'a');
  });

  it('drops a prepared navigation a later one superseded', async () => {
    const pages = manager();
    const slow = deferred();
    pages.setStatePreparer((s) => (s.id === 'slow' ? slow.promise : undefined));
    pages.setPageState({ type: 'trip', id: 'slow' });
    pages.setPageState({ type: 'trip', id: 'fast' });
    slow.resolve();
    await slow.promise;
    await Promise.resolve();
    assert.equal(pages.getPageState().id, 'fast');
  });

  it('applies after a failed preparer', async () => {
    const pages = manager();
    const failing = Promise.reject(new Error('offline'));
    pages.setStatePreparer(() => failing);
    const error = console.error;
    console.error = () => {};
    pages.setPageState({ type: 'trip', id: 'a' });
    await failing.catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    console.error = error;
    assert.equal(pages.getPageState().id, 'a');
  });
});
