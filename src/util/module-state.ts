/**
 * Module-level state held on globalThis rather than in the module scope.
 *
 * A Vite dev server with cached transforms from an earlier pin serves the same
 * file under two pnpm store paths, so the module body runs twice and each copy
 * gets its own state: two modal stacks, an empty help registry in one copy, a
 * router whose instance was set in the other. Keying on globalThis keeps the
 * copies agreeing, and reports the duplication instead of leaving it to surface
 * as one of those.
 */

const REGISTRY = Symbol.for('interlocking.moduleState');

/** This module's state, shared with any duplicate copy of the same module. */
export function moduleState<T extends object>(key: string, create: () => T): T {
  const globals = globalThis as Record<symbol, unknown>;
  const store = (globals[REGISTRY] ??= new Map<string, object>()) as Map<
    string,
    object
  >;
  const existing = store.get(key);
  if (existing) {
    console.error(
      `[interlocking] ${key} loaded twice; state is shared across both copies. ` +
        'Restart the dev server: its module cache is holding an older interlocking pin.'
    );
    return existing as T;
  }
  const state = create();
  store.set(key, state);
  return state;
}
