/**
 * Page state manager: the single owner of what the app is looking at, its
 * navigation history, and the URL hash.
 *
 * Generic over the app's page-state union. Every union is discriminated by
 * `type`, has a `home` variant naming no object, and may carry a `modal` that
 * sits over the page without being part of it. What differs per app is the hash
 * codec and the validator, both injected.
 *
 * The hash has two halves: the page (and modal) params the codec writes, and
 * the feed params the app sets with `setFeedParams`. Only this class writes the
 * hash, which is what keeps its `suppressHashUpdate` guard honest.
 */

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
  enableHistory?: boolean;
  maxHistoryLength?: number;
  enableUrlSync?: boolean;
}

type NavigationEventHandler<S> = (event: NavigationEvent<S>) => void;

const DEFAULT_MAX_HISTORY = 50;

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
  private navigationHistory: NavigationEvent<S>[] = [];
  private eventHandlers: NavigationEventHandler<S>[] = [];
  private codec: PageStateCodec<S>;
  private enableHistory: boolean;
  private maxHistoryLength: number;
  private enableUrlSync: boolean;
  private breadcrumbBuilder: BreadcrumbBuilder<S, C> | null = null;
  private stateValidator: StateValidator<S> | null = null;
  private feedParams: Record<string, string> = {};
  private suppressHashUpdate = false;

  constructor(config: PageStateManagerConfig<S>) {
    this.codec = config.codec;
    this.enableHistory = config.enableHistory ?? true;
    this.maxHistoryLength = config.maxHistoryLength ?? DEFAULT_MAX_HISTORY;
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

  /** Update the current state, recording history and syncing the hash. */
  setPageState(newState: S): void {
    if (!this.codec.isPageState(newState)) {
      throw new Error('Invalid page state provided');
    }

    const event: NavigationEvent<S> = {
      from: this.currentState,
      to: newState,
      timestamp: Date.now(),
    };
    this.currentState = { ...newState };

    this.recordHistory(event);
    this.writeHash(newState);
    this.notify(event);
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

  canNavigateBack(): boolean {
    return this.navigationHistory.length > 0;
  }

  /** Step back to the most recent state that differs from the current one. */
  navigateBack(): boolean {
    const current = JSON.stringify(this.currentState);
    for (let i = this.navigationHistory.length - 1; i >= 0; i--) {
      const from = this.navigationHistory[i].from;
      if (JSON.stringify(from) !== current) {
        this.setPageState(from);
        return true;
      }
    }
    return false;
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

  getNavigationHistory(): NavigationEvent<S>[] {
    return [...this.navigationHistory];
  }

  clearNavigationHistory(): void {
    this.navigationHistory = [];
  }

  /** The state the hash names, unvalidated: boot reads it before data loads. */
  pendingStateFromURL(): S {
    if (typeof window === 'undefined') {
      return { type: 'home' } as S;
    }
    return this.urlToPageState(window.location.hash.slice(1));
  }

  /**
   * Take a state without recording history or notifying handlers. Used at
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
   * Re-point the current state and the history in place, for an object that
   * changed identity under the reader (a renamed id). Not a navigation: no
   * history entry, no handlers, and the hash is replaced rather than pushed.
   * `fn` returns null for a state it leaves alone.
   *
   * Returns true when the current state moved.
   */
  rewrite(fn: (state: S) => S | null): boolean {
    this.navigationHistory = this.navigationHistory.map((event) => ({
      ...event,
      from: fn(event.from) ?? event.from,
      to: fn(event.to) ?? event.to,
    }));

    const next = fn(this.currentState);
    if (!next) {
      return false;
    }
    this.currentState = { ...next };

    if (this.enableUrlSync && typeof window !== 'undefined') {
      const hash = this.buildHash(next);
      if (hash !== window.location.hash.slice(1)) {
        // replaceState fires no hashchange, so the suppress flag stays clear.
        window.history.replaceState(
          null,
          '',
          hash === ''
            ? window.location.pathname + window.location.search
            : `#${hash}`
        );
      }
    }
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
   * does not bounce the page. Async so the class satisfies `modal-router.ts`'s
   * `ModalHost`.
   */
  async clearModal(): Promise<void> {
    const current = this.getPageState();
    if (!current.modal) {
      return;
    }
    const rest = { ...current };
    delete rest.modal;
    this.setPageState(rest);
  }

  /** The full hash for a state, feed params first so links read consistently. */
  buildHash(state: S): string {
    const params = new URLSearchParams(this.feedParams);
    for (const [k, v] of this.codec.toParams(state)) {
      params.set(k, v);
    }
    return params.toString();
  }

  private writeHash(state: S): void {
    if (!this.enableUrlSync || typeof window === 'undefined') {
      return;
    }

    const hash = this.buildHash(state);
    if (hash === window.location.hash.slice(1)) {
      return;
    }

    // Guarded by the equality check above, so the flag can never be left set
    // by a write that produces no hashchange event.
    this.suppressHashUpdate = true;
    window.location.hash = hash;
  }

  /** Back/forward, or a hand-edited address bar. */
  private handleHashChange(): void {
    if (this.suppressHashUpdate) {
      this.suppressHashUpdate = false;
      return;
    }

    const candidate = this.urlToPageState(window.location.hash.slice(1));
    if (candidate.type === 'home' || !this.stateValidator) {
      this.applyHashState(candidate);
      return;
    }

    const valid = this.stateValidator(candidate);
    if (typeof valid === 'boolean') {
      this.applyHashState(valid ? candidate : this.fallback(candidate));
    } else {
      void valid.then((ok) =>
        this.applyHashState(ok ? candidate : this.fallback(candidate))
      );
    }
  }

  private fallback(state: S): S {
    console.warn(
      '[PageStateManager] hashchange: object not found, falling back to home'
    );
    return homeWithModal(state);
  }

  private applyHashState(state: S): void {
    const event: NavigationEvent<S> = {
      from: this.currentState,
      to: state,
      timestamp: Date.now(),
    };
    this.currentState = { ...state };

    this.recordHistory(event);
    this.notify(event);
  }

  private recordHistory(event: NavigationEvent<S>): void {
    if (!this.enableHistory) {
      return;
    }
    this.navigationHistory.push(event);
    if (this.navigationHistory.length > this.maxHistoryLength) {
      this.navigationHistory = this.navigationHistory.slice(
        -this.maxHistoryLength
      );
    }
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
