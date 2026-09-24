/**
 * The right panel's page host: one `#panel-content` element, a breadcrumb
 * header, and the page the app renders for the current state.
 *
 * Pages are plain HTML strings that re-render whenever their data changes. A
 * naive `innerHTML =` would bounce the reader to the top and close every
 * `<details>` they had opened, so the scroll offset is restored around each
 * re-render and open `<details data-detail="key">` are tracked by key in a set
 * that outlives the DOM.
 *
 * Links and buttons are delegated from the host, so they survive re-renders:
 * `data-nav` holds a JSON page state to navigate to, and `data-action` /
 * `data-arg` name a write for the app to run.
 */

import type { BreadcrumbItem } from './breadcrumb-trail';
import { renderBreadcrumbTrail } from './breadcrumb-trail';

export interface PanelHostHooks<S> {
  /** Navigate to a page, as if the user had clicked it on the map. */
  navigate: (state: S) => void;
  /** The full hash for a page, so links are real links. */
  href: (state: S) => string;
  /** The page body for a state, rendered under the breadcrumb trail. */
  renderPage: (state: S) => string;
  /** Run a write named by a `data-action` button. */
  action?: (action: string, arg: string) => void;
  /** Called every second while a page shows, to refresh live text in place. */
  tick?: (host: HTMLElement) => void;
}

const TICK_MS = 1000;

export class PanelHost<S> {
  private host: HTMLElement;
  private hooks: PanelHostHooks<S>;

  private current: S | null = null;
  private breadcrumbs: BreadcrumbItem<S>[] = [];
  private openDetails = new Set<string>();
  private tickerId: ReturnType<typeof setInterval> | null = null;
  private renderQueued = false;

  constructor(host: HTMLElement, hooks: PanelHostHooks<S>) {
    this.host = host;
    this.hooks = hooks;
  }

  initialize(): void {
    this.host.addEventListener('click', (e) => this.onClick(e));
    this.host.addEventListener('toggle', (e) => this.onToggle(e), true);
    if (this.hooks.tick) {
      this.tickerId = setInterval(() => {
        if (this.current !== null) {
          this.hooks.tick!(this.host);
        }
      }, TICK_MS);
    }
  }

  destroy(): void {
    if (this.tickerId !== null) {
      clearInterval(this.tickerId);
    }
    this.tickerId = null;
  }

  /** The state showing, or null while the panel is handed to something else. */
  get state(): S | null {
    return this.current;
  }

  /**
   * Take over the panel and render `state`. A different page starts at the top
   * rather than inheriting the previous page's scroll offset.
   */
  show(state: S, breadcrumbs: BreadcrumbItem<S>[]): void {
    this.current = state;
    this.breadcrumbs = breadcrumbs;
    this.render(true);
  }

  /**
   * Replace the trail without changing the page, keeping the scroll offset.
   * For a trail rebuilt after an object a crumb names arrived late.
   */
  setBreadcrumbs(breadcrumbs: BreadcrumbItem<S>[]): void {
    this.breadcrumbs = breadcrumbs;
    this.queueRender();
  }

  /** Stop rendering; the app has handed `#panel-content` to something else. */
  hide(): void {
    this.current = null;
  }

  /** Re-render the current page once, at the end of this task. */
  queueRender(): void {
    if (this.current === null || this.renderQueued) {
      return;
    }
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render(false);
    });
  }

  private onClick(e: Event): void {
    const source = e.target as HTMLElement | null;

    // Actions first: a write must not also navigate when its button sits in a
    // row that is itself a link.
    const action = source?.closest<HTMLElement>('[data-action]');
    if (action && this.hooks.action) {
      e.preventDefault();
      this.hooks.action(action.dataset.action!, action.dataset.arg ?? '');
      return;
    }

    const target = source?.closest<HTMLElement>('[data-nav]');
    if (!target) {
      return;
    }
    // Modified clicks do what the browser would do with a normal link.
    const mouse = e as MouseEvent;
    if (
      mouse.metaKey ||
      mouse.ctrlKey ||
      mouse.shiftKey ||
      mouse.button !== 0
    ) {
      return;
    }
    e.preventDefault();
    this.hooks.navigate(JSON.parse(target.dataset.nav!) as S);
  }

  private onToggle(e: Event): void {
    const el = e.target as HTMLDetailsElement;
    const key = el.dataset?.detail;
    if (!key) {
      return;
    }
    if (el.open) {
      this.openDetails.add(key);
    } else {
      this.openDetails.delete(key);
    }
  }

  private render(resetScroll: boolean): void {
    if (this.current === null) {
      return;
    }

    const scroll = this.host.scrollTop;
    this.host.innerHTML = `
      <div class="space-y-4">
        ${renderBreadcrumbTrail(this.breadcrumbs, this.hooks.href)}
        ${this.hooks.renderPage(this.current)}
      </div>`;

    // Re-open what the reader had opened, then restore the scroll, in that
    // order, since opening a `<details>` changes the scroll height.
    this.host
      .querySelectorAll<HTMLDetailsElement>('[data-detail]')
      .forEach((el) => {
        if (this.openDetails.has(el.dataset.detail!)) {
          el.open = true;
        }
      });
    this.host.scrollTop = resetScroll ? 0 : scroll;
  }
}
