/**
 * The single entry point for focus changes.
 *
 * Map click, panel link, search pick, hash change and boot restore all
 * converge here, and everything downstream (the panel, the map, the bottom
 * sheet, the address bar) reacts to the two hooks rather than to each other.
 * Apps extend this with their own selection and boot logic.
 */

import type { AnyPageState, PageStateManager } from './page-state-manager';
import { pageStatesEqual, sameLocation } from './page-state-manager';

export interface FocusHooks<S> {
  /**
   * Called when the page underneath the modal changes, including the boot
   * restore. Opening or closing a modal leaves the page alone, so this does
   * not fire for one.
   */
  onFocusChange: (state: S) => void;
  /**
   * Called on every navigation, modal-only ones included. The modal router
   * reads the whole state from here, which keeps the hash and the open modal
   * reconciled however the modal was closed.
   */
  onStateChange: (state: S) => void;
}

export class FocusController<S extends AnyPageState, C = unknown> {
  readonly pages: PageStateManager<S, C>;
  protected hooks: FocusHooks<S>;

  constructor(pages: PageStateManager<S, C>, hooks: FocusHooks<S>) {
    this.pages = pages;
    this.hooks = hooks;
    pages.addNavigationHandler((event) => this.emit(event.to, event.from));
  }

  get focus(): S {
    return this.pages.getPageState();
  }

  get breadcrumbs(): C[] {
    return this.pages.getBreadcrumbs();
  }

  /**
   * Fan a state out to the hooks. The focus hook is skipped when only the
   * modal moved, so opening the guide over a page neither re-renders it nor
   * moves the camera. `from` is omitted at boot, where there is no previous
   * state and both hooks have to run.
   */
  protected emit(to: S, from?: S): void {
    if (!from || !sameLocation(from, to)) {
      this.hooks.onFocusChange(to);
    }
    this.hooks.onStateChange(to);
  }

  /**
   * Navigate. The state replaces the current one whole, so a focus change with
   * no `modal` closes whatever modal was open. A navigation to the state
   * already showing is dropped.
   */
  setFocus(state: S): void {
    if (pageStatesEqual(state, this.focus)) {
      return;
    }
    this.pages.setPageState(state);
  }

  clearFocus(): void {
    this.setFocus({ type: 'home' } as S);
  }

  /** Open a modal over the current page, leaving that page where it is. */
  openModal(modal: NonNullable<S['modal']>): void {
    this.setFocus({ ...this.focus, modal });
  }

  /**
   * Take an already-validated state without recording history, and paint it.
   * The boot restore.
   */
  adopt(state: S): void {
    this.pages.adoptState(state);
    this.emit(this.focus);
  }

  /** Paint the current state as-is: boot when nothing was restored. */
  repaint(): void {
    this.emit(this.focus);
  }

  /**
   * The hash a link to `state` carries. Pages render real `<a>` elements so
   * middle-click and copy-link-address work, though a plain click is handled
   * in place.
   */
  hrefFor(state: S): string {
    const hash = this.pages.buildHash(state);
    return hash ? `#${hash}` : '#';
  }

  /** The full shareable URL for the current state. */
  shareableUrl(): string {
    const hash = this.pages.buildHash(this.focus);
    return `${window.location.origin}${window.location.pathname}${hash ? `#${hash}` : ''}`;
  }
}
