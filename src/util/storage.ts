/**
 * Browser storage helpers shared by every app that keeps feeds in OPFS and
 * IndexedDB: persistence, quota errors and the usage estimate.
 */

/**
 * Ask the browser not to evict this origin's storage under pressure. Resolves
 * to whether storage is persistent; false when the API is missing.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) {
    console.warn('[Storage] navigator.storage.persist is not available');
    return false;
  }
  try {
    if (await navigator.storage.persisted()) {
      return true;
    }
    const granted = await navigator.storage.persist();
    console.log(
      `[Storage] persistent storage ${granted ? 'granted' : 'denied'}`
    );
    return granted;
  } catch (err) {
    console.warn('[Storage] persist request failed', err);
    return false;
  }
}

/**
 * True for the errors browsers throw when a write would exceed the quota:
 * `QuotaExceededError` from IndexedDB and OPFS, and its legacy code 22.
 * Checks the error's cause chain too, since wrappers keep it there.
 */
export function isQuotaError(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; depth++) {
    if (
      e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.code === 22)
    ) {
      return true;
    }
    if (e instanceof Error) {
      if (e.name === 'QuotaExceededError') {
        return true;
      }
      e = e.cause;
    } else {
      return false;
    }
  }
  return false;
}

/** Bytes used and the quota for this origin, or null when unknown. */
export async function storageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  if (!navigator.storage?.estimate) {
    return null;
  }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage === undefined || quota === undefined) {
      return null;
    }
    return { usage, quota };
  } catch (err) {
    console.warn('[Storage] estimate failed', err);
    return null;
  }
}
