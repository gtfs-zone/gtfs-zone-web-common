/**
 * The realtime apps' right panel: `PanelHost` plus what every realtime page
 * needs around it.
 *
 * Adds a re-render on each session event the app names, the `RtIndex` the
 * pages read (built on a page's first read and reused until the session data
 * it was built from changes), the live `[data-since]` relative times, and the route-strip hover that lights a
 * stop on the map. The app supplies the page dispatcher, which returns a
 * `TreePage`.
 */

import type { BreadcrumbItem } from '../ui/breadcrumb-trail';
import { PanelHost } from '../ui/panel-host';
import { formatRelative } from './entity-render';
import type { FeedSession } from './feed-session';
import { RtIndex } from './rt-index';
import type { VehiclePosition } from './rt-types';
import { TreePageMounter, type TreePage } from './tree-page';

export interface RtPanelHooks<S, V extends VehiclePosition> {
  /** Navigate to a page, as if the user had clicked it on the map. */
  navigate: (state: S) => void;
  /** The full hash for a page, so links are real links. */
  href: (state: S) => string;
  /**
   * The page for a state. `rt` returns the current index, building it on the
   * first call; a page that reads no realtime data should not call it.
   */
  renderPage: (state: S, rt: () => RtIndex<V>) => TreePage;
  /** Light a stop on the map while its route-strip row is hovered. */
  hoverStop: (stop_id: string | null) => void;
  /** Run a write named by a `data-action` button. */
  action?: (action: string, arg: string) => void;
}

const STRIP_ROW = '.strip-stop-row';

export class RtPanel<S, V extends VehiclePosition = VehiclePosition> {
  private host: HTMLElement;
  private session: FeedSession<V> & EventTarget;
  private events: readonly string[];
  private hooks: RtPanelHooks<S, V>;
  private panel: PanelHost<S>;
  private mounter = new TreePageMounter();

  private hoveredStopId: string | null = null;
  private index: RtIndex<V> | null = null;
  /** The session data `index` was built from, compared by identity. */
  private indexInputs: readonly unknown[] = [];
  /** Bumped on `scheduledata`, which fills the feed's maps in place. */
  private scheduleData = 0;
  private readonly rt = (): RtIndex<V> => this.rtIndex;

  /** `events` are the session events that change what a page can resolve. */
  constructor(
    host: HTMLElement,
    session: FeedSession<V> & EventTarget,
    events: readonly string[],
    hooks: RtPanelHooks<S, V>
  ) {
    this.host = host;
    this.session = session;
    this.events = events;
    this.hooks = hooks;
    this.panel = new PanelHost<S>(host, {
      navigate: hooks.navigate,
      href: hooks.href,
      beforeRender: (_el, reset) => this.mounter.capture(reset),
      renderPage: (state) =>
        this.mounter.render(hooks.renderPage(state, this.rt)),
      afterRender: (el) => this.mounter.mount(el),
      action: hooks.action,
      tick: (el) => {
        el.querySelectorAll<HTMLElement>('[data-since]').forEach((since) => {
          since.textContent = formatRelative(Number(since.dataset.since));
        });
        el.querySelectorAll<HTMLElement>('[data-until]').forEach((until) => {
          until.textContent = formatRelative(Number(until.dataset.until));
        });
      },
    });
  }

  initialize(): void {
    for (const event of this.events) {
      this.session.addEventListener(event, () => this.panel.queueRender());
    }
    // The feed fetched data a page was waiting for.
    this.session.addEventListener('scheduledata', () => {
      this.scheduleData++;
      this.panel.queueRender();
    });

    this.panel.initialize();
    // pointerover/out bubble, unlike pointerenter/leave, so they can be
    // delegated to the panel host and survive every re-render.
    this.host.addEventListener('pointerover', (e) => this.onPointerOver(e));
    this.host.addEventListener('pointerout', (e) => this.onPointerOut(e));
  }

  destroy(): void {
    this.mounter.destroy();
    this.panel.destroy();
  }

  /** Take over the panel and render `state`. */
  show(state: S, breadcrumbs: BreadcrumbItem<S>[]): void {
    this.clearHoveredStop();
    this.panel.show(state, breadcrumbs);
  }

  /** Replace the trail without changing the page, keeping the scroll offset. */
  setBreadcrumbs(breadcrumbs: BreadcrumbItem<S>[]): void {
    this.panel.setBreadcrumbs(breadcrumbs);
  }

  /** Stop rendering; the app has handed the panel to something else. */
  hide(): void {
    this.clearHoveredStop();
    this.mounter.destroy();
    this.panel.hide();
  }

  /**
   * The realtime read-model for the current payloads, built on demand.
   * Sessions replace `vehicles`, `tripUpdates` and `scheduledFeed` rather
   * than mutate them, so an unchanged identity means unchanged data.
   */
  get rtIndex(): RtIndex<V> {
    const inputs = [
      this.session.vehicles,
      this.session.tripUpdates,
      this.session.scheduledFeed,
      this.scheduleData,
    ];
    if (
      this.index === null ||
      inputs.some((input, i) => input !== this.indexInputs[i])
    ) {
      this.index = new RtIndex(this.session);
      this.indexInputs = inputs;
    }
    return this.index;
  }

  /**
   * Drop the hover light. A page change replaces the rows under the pointer,
   * so the `pointerout` that would normally clear it never arrives.
   */
  private clearHoveredStop(): void {
    if (this.hoveredStopId === null) {
      return;
    }
    this.hoveredStopId = null;
    this.hooks.hoverStop(null);
  }

  /** The stop_id of the strip row an event happened inside, if any. */
  private rowStopId(e: Event): string | null {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      STRIP_ROW
    );
    return row?.dataset.stopId ?? null;
  }

  private onPointerOver(e: Event): void {
    const stopId = this.rowStopId(e);
    if (!stopId || stopId === this.hoveredStopId) {
      return;
    }
    this.hoveredStopId = stopId;
    this.hooks.hoverStop(stopId);
  }

  private onPointerOut(e: Event): void {
    const stopId = this.rowStopId(e);
    if (!stopId || stopId !== this.hoveredStopId) {
      return;
    }
    // Moving between two children of the same row fires an out/over pair for
    // that row; only a pointer that actually left every row clears the light.
    const next = (e as PointerEvent).relatedTarget;
    if (next instanceof Element && next.closest(STRIP_ROW)) {
      return;
    }
    this.hoveredStopId = null;
    this.hooks.hoverStop(null);
  }
}
