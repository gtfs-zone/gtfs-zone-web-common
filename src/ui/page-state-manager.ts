/**
 * Page state manager: the single owner of what the app is looking at and the
 * URL hash. Browser history is the only navigation history.
 *
 * Generic over the app's page-state union. Every union is discriminated by
 * `type`, has a `home` variant naming no object, and may carry a `modal` that
 * sits over the page without being part of it. What differs per app is the hash
 * codec and the validator, both injected.
 *
 * The hash has two halves: the page (and modal) params the codec writes, and
 * the feed params the app sets with `setFeedParams`. Writes go through
 * `history.pushState`/`replaceState`, which fire no `hashchange`, so every
 * `hashchange` the class sees is Back/Forward or a hand-edited address bar.
 */

import { closeTransientModals } from './modal-router';

/** A modal over a page: anything discriminated by `type`. */
export type AnyModalState = { type: string };

/** The shape every app's page-state union satisfies. */
export type AnyPageState = { type: string; modal?: AnyModalState };

/** Navigation event emitted on every state change. */
export interface NavigationEvent<S> {
  from: S;
  to: S;
  timestamp: number;
}

/**
 * Checks whether a state names an object that exists in the loaded data.
 * Synchronous for an in-memory model, async for one backed by a database.
 */
export type StateValidator<S> = (state: S) => boolean | Promise<boolean>;

/** Resolves a state to its breadcrumb trail. */
export type BreadcrumbBuilder<S, C> = (state: S) => C[];

/** The app's page-state union to and from hash params. */
export interface PageStateCodec<S> {
  /** Page and modal params only; the feed params are merged in separately. */
  toParams(state: S): URLSearchParams;
  /**
   * Read a state out of the hash. Params the codec does not know, the feed
   * half included, are ignored. Always returns a valid state.
   */
  fromParams(params: URLSearchParams): S;
  /** Runtime guard, checked on every `setPageState`. */
  isPageState(value: unknown): value is S;
}

export interface PageStateManagerConfig<S> {
  codec: PageStateCodec<S>;
  enableUrlSync?: boolean;
}

type NavigationEventHandler<S> = (event: NavigationEvent<S>) => void;

/**
 * `history.state` of an entry `writeHash` pushed: the instance that pushed it
 * and the hash of the entry it was pushed over.
 */
interface PushedEntry {
  pushedBy: string;
  below: string;
}

/** How long `clearModal` waits for the `hashchange` of its `history.back()`. */
const BACK_TIMEOUT_MS = 1000;

function currentHash(): string {
  return window.location.hash.slice(1);
}

function hashUrl(hash: string): string {
  return hash === ''
    ? window.location.pathname + window.location.search
    : `#${hash}`;
}

function withoutModal(state: AnyPageState): Omit<AnyPageState, 'modal'> {
  const location = { ...state };
  delete location.modal;
  return location;
}

/** Two states name the same page when the modal above them is ignored. */
export function sameLocation<S extends AnyPageState>(a: S, b: S): boolean {
  return JSON.stringify(withoutModal(a)) === JSON.stringify(withoutModal(b));
}

/**
 * Two states are equal when they name the same page and the same modal. The
 * two halves are compared separately, so a modal added to a state does not
 * depend on key order.
 */
export function pageStatesEqual<S extends AnyPageState>(a: S, b: S): boolean {
  return (
    sameLocation(a, b) &&
    JSON.stringify(a.modal ?? null) === JSON.stringify(b.modal ?? null)
  );
}

/** The home state, keeping the modal of `state` if it had one. */
export function homeWithModal<S extends AnyPageState>(state: S): S {
  return { type: 'home', ...(state.modal && { modal: state.modal }) } as S;
}

export class PageStateManager<S extends AnyPageState, C = unknown> {
  private currentState: S = { type: 'home' } as S;
  private eventHandlers: NavigationEventHandler<S>[] = [];
  private codec: PageStateCodec<S>;
  private enableUrlSync: boolean;
  private breadcrumbBuilder: BreadcrumbBuilder<S, C> | null = null;
  private stateValidator: StateValidator<S> | null = null;
  private feedParams: Record<string, string> = {};
  /** Marks the entries this instance pushed, so a reload never claims them. */
  private readonly instanceId = Math.random().toString(36).slice(2);
  /** Set while `clearModal` waits for its `history.back()` to land. */
  private pendingBack: { hash: string; state: S; done: () => void } | null =
    null;

  constructor(config: PageStateManagerConfig<S>) {
    this.codec = config.codec;
    this.enableUrlSync = config.enableUrlSync ?? false;

    if (this.enableUrlSync && typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => this.handleHashChange());
    }
  }

  setBreadcrumbBuilder(builder: BreadcrumbBuilder<S, C>): void {
    this.breadcrumbBuilder = builder;
  }

  /**
   * Set the validator a hash change is checked against. A state it rejects
   * falls back to home, keeping its modal.
   */
  setStateValidator(fn: StateValidator<S>): void {
    this.stateValidator = fn;
  }

  /**
   * Replace the feed half of the hash. Written immediately unless `writeNow`
   * is false, since the selection can change while the focus does not.
   */
  setFeedParams(params: Record<string, string>, writeNow = true): void {
    this.feedParams = params;
    if (writeNow) {
      this.writeHash(this.currentState);
    }
  }

  getFeedParams(): Record<string, string> {
    return { ...this.feedParams };
  }

  getPageState(): S {
    return { ...this.currentState };
  }

  /** Update the current state, pushing its hash. */
  setPageState(newState: S): void {
    if (!this.codec.isPageState(newState)) {
      throw new Error('Invalid page state provided');
    }
    this.writeHash(newState);
    this.apply(newState);
  }

  /** The trail for the current state, or none when no builder is set. */
  getBreadcrumbs(): C[] {
    if (!this.breadcrumbBuilder) {
      return [];
    }
    try {
      return this.breadcrumbBuilder(this.currentState);
    } catch (error) {
      console.error('Error building breadcrumbs:', error);
      return [];
    }
  }

  addNavigationHandler(handler: NavigationEventHandler<S>): void {
    this.eventHandlers.push(handler);
  }

  removeNavigationHandler(handler: NavigationEventHandler<S>): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index >= 0) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /** The state the hash names, unvalidated: boot reads it before data loads. */
  pendingStateFromURL(): S {
    if (typeof window === 'undefined') {
      return { type: 'home' } as S;
    }
    return this.urlToPageState(window.location.hash.slice(1));
  }

  /**
   * Take a state without touching the hash or notifying handlers. Used at
   * boot, once the caller has validated it against the loaded data.
   */
  adoptState(state: S): void {
    this.currentState = { ...state };
  }

  /** Write the current state to the hash without dispatching anything. */
  syncHash(): void {
    this.writeHash(this.currentState);
  }

  /**
   * Re-point the current state in place, for an object that changed identity
   * under the reader (a renamed id). Not a navigation: no handlers, and the
   * hash is replaced rather than pushed. `fn` returns null for a state it
   * leaves alone.
   *
   * Returns true when the current state moved.
   */
  rewrite(fn: (state: S) => S | null): boolean {
    const next = fn(this.currentState);
    if (!next) {
      return false;
    }
    this.currentState = { ...next };
    this.replaceHash(next);
    return true;
  }

  /** Page and modal params only; the feed half is merged in by `buildHash`. */
  pageStateToURL(state: S): string {
    return this.codec.toParams(state).toString();
  }

  /** Read a state out of a hash string (no leading `#`). */
  urlToPageState(hash: string): S {
    return this.codec.fromParams(new URLSearchParams(hash));
  }

  /**
   * Drop the modal from the current state, leaving the page beneath it. A
   * no-op when no modal is open, so a modal that navigated away before closing
   * does not bounce the page.
   *
   * Never pushes, so Back after a close does not reopen the modal. When the
   * entry under this one is the same page without the modal, steps back onto
   * it; otherwise replaces this entry with the modal-less hash.
   */
  async clearModal(): Promise<void> {
    const current = this.getPageState();
    if (!current.modal) {
      return;
    }
    const rest = { ...current };
    delete rest.modal;

    if (!this.enableUrlSync || typeof window === 'undefined') {
      this.apply(rest);
      return;
    }

    const hash = this.buildHash(rest);
    const entry = window.history.state as Partial<PushedEntry> | null;
    if (entry?.pushedBy === this.instanceId && entry.below === hash) {
      console.log('[PageStateManager] close via back');
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
          if (this.pendingBack?.done === done) {
            console.warn(
              '[PageStateManager] history.back() did not land, closing via replace'
            );
            this.pendingBack = null;
            this.replaceHash(rest);
            this.apply(rest);
          }
          resolve();
        }, BACK_TIMEOUT_MS);
        const done = () => {
          window.clearTimeout(timer);
          resolve();
        };
        this.pendingBack = { hash, state: rest, done };
        window.history.back();
      });
      return;
    }

    console.log('[PageStateManager] close via replace');
    this.replaceHash(rest);
    this.apply(rest);
  }

  /** The full hash for a state, feed params first so links read consistently. */
  buildHash(state: S): string {
    const params = new URLSearchParams(this.feedParams);
    for (const [k, v] of this.codec.toParams(state)) {
      params.set(k, v);
    }
    return params.toString();
  }

  /** Push the hash for a state, marking the entry as this instance's. */
  private writeHash(state: S): void {
    if (!this.enableUrlSync || typeof window === 'undefined') {
      return;
    }

    const hash = this.buildHash(state);
    const below = currentHash();
    if (hash === below) {
      return;
    }
    if (this.pendingBack) {
      console.warn(
        '[PageStateManager] pushing while a close via back is pending'
      );
    }
    const entry: PushedEntry = { pushedBy: this.instanceId, below };
    window.history.pushState(entry, '', hashUrl(hash));
  }

  /** Replace the current entry's hash, keeping its `history.state` mark. */
  private replaceHash(state: S): void {
    if (!this.enableUrlSync || typeof window === 'undefined') {
      return;
    }
    const hash = this.buildHash(state);
    if (hash !== currentHash()) {
      window.history.replaceState(window.history.state, '', hashUrl(hash));
    }
  }

  /** Back/forward, or a hand-edited address bar. */
  private handleHashChange(): void {
    const hash = currentHash();

    const pending = this.pendingBack;
    if (pending) {
      this.pendingBack = null;
      if (hash === pending.hash) {
        this.apply(pending.state);
        pending.done();
        return;
      }
      console.warn(
        '[PageStateManager] close via back landed on an unexpected hash'
      );
      pending.done();
    }

    // A write from outside this class (e.g. a boot command stripping itself
    // from the hash) that leaves the hash naming the current state.
    if (hash === this.buildHash(this.currentState)) {
      return;
    }

    const candidate = this.urlToPageState(hash);
    if (candidate.type === 'home' || !this.stateValidator) {
      this.applyFromHistory(candidate);
      return;
    }

    const valid = this.stateValidator(candidate);
    if (typeof valid === 'boolean') {
      this.applyValidated(candidate, valid);
      return;
    }
    void valid.then((ok) => {
      // A later Back/Forward moved on while this one was validating.
      if (currentHash() !== hash) {
        console.log('[PageStateManager] dropping stale hashchange validation');
        return;
      }
      this.applyValidated(candidate, ok);
    });
  }

  private applyValidated(candidate: S, valid: boolean): void {
    if (valid) {
      this.applyFromHistory(candidate);
      return;
    }
    console.warn(
      '[PageStateManager] hashchange: object not found, falling back to home'
    );
    const home = homeWithModal(candidate);
    this.replaceHash(home);
    this.applyFromHistory(home);
  }

  /**
   * Apply a state the browser moved to. Transient modals belong to the page
   * they were opened on, so they close first.
   */
  private applyFromHistory(state: S): void {
    closeTransientModals();
    this.apply(state);
  }

  private apply(state: S): void {
    const event: NavigationEvent<S> = {
      from: this.currentState,
      to: state,
      timestamp: Date.now(),
    };
    this.currentState = { ...state };
    this.notify(event);
  }

  private notify(event: NavigationEvent<S>): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in navigation event handler:', error);
      }
    }
  }
}
