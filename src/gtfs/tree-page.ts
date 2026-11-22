/**
 * Tree page scaffold: a page header and ordered sections, rendered in a
 * `PanelHost`, with list boxes mounted after each render.
 *
 * The app maps a page state to a `TreePage`; this module turns it into markup,
 * mounts each section's list box once the markup is in the document, and
 * destroys the boxes of the previous render. A box keeps its search text, rows
 * drawn and scroll offset across a re-render of the same page, matched by its
 * section's `key` or title. `extraSections` lets an app add sections to a page
 * it shares with another app.
 */

import type { BreadcrumbItem } from '../ui/breadcrumb-trail';
import { pageHeaderEyebrow } from '../ui/breadcrumb-trail';
import {
  mountListBox,
  type ListBox,
  type ListBoxOptions,
  type ListBoxSnapshot,
} from '../ui/list-box';
import { PanelHost } from '../ui/panel-host';
import { escapeHtml } from '../util/escape-html';

export interface TreeSection {
  /** Names the section's list box across re-renders; defaults to the title. */
  key?: string;
  title?: string;
  /** Markup after the title, e.g. a status badge. */
  titleExtra?: string;
  /** Markup of the section body, above its list. */
  body?: string;
  /** A list box under the body. */
  list?: ListBoxOptions<unknown>;
}

export interface TreePage {
  /** Dim uppercase line over the title, e.g. "Route". */
  eyebrow?: string;
  title: string;
  /** The id under the title, in monospace. */
  id?: string;
  /** Markup beside the title, e.g. a route badge. */
  titleExtra?: string;
  sections: TreeSection[];
}

/** A section holding a list box; keeps the list's item type at the call. */
export function listSection<T>(
  title: string,
  list: ListBoxOptions<T>,
  extra: Omit<TreeSection, 'title' | 'list'> = {}
): TreeSection {
  return { ...extra, title, list: list as ListBoxOptions<unknown> };
}

export interface TreePageHostHooks<S> {
  navigate: (state: S) => void;
  href: (state: S) => string;
  page: (state: S) => TreePage;
  /** Sections the app appends to a page. */
  extraSections?: (state: S) => TreeSection[];
  action?: (action: string, arg: string) => void;
}

function renderHeader(page: TreePage): string {
  const heading = `<h2 class="text-lg font-semibold leading-tight break-words">${escapeHtml(
    page.title
  )}</h2>`;
  return `
    <header class="space-y-1">
      ${page.eyebrow ? pageHeaderEyebrow(page.eyebrow) : ''}
      ${page.titleExtra ? `<div class="flex items-center gap-2">${page.titleExtra}${heading}</div>` : heading}
      ${page.id ? `<p class="text-xs opacity-60 font-mono break-words">${escapeHtml(page.id)}</p>` : ''}
    </header>`;
}

function renderSection(section: TreeSection, listIndex: number | null): string {
  const title = section.title
    ? `<h3 class="font-semibold text-sm">${escapeHtml(section.title)}${section.titleExtra ?? ''}</h3>`
    : '';
  const list =
    listIndex === null ? '' : `<div data-list-box="${listIndex}"></div>`;
  return `
    <section class="space-y-2">
      ${title}
      ${section.body ?? ''}
      ${list}
    </section>`;
}

/**
 * Renders `TreePage`s to markup and mounts their list boxes, for a host that
 * owns a `PanelHost`: call `capture` from `beforeRender`, `render` from
 * `renderPage` and `mount` from `afterRender`.
 */
export class TreePageMounter {
  /** List options of the markup last rendered, by placeholder index. */
  private lists: { key: string; options: ListBoxOptions<unknown> }[] = [];
  private boxes: { key: string; box: ListBox }[] = [];
  private snapshots = new Map<string, ListBoxSnapshot>();

  /** Snapshot the mounted boxes, or forget them when a new page shows. */
  capture(reset: boolean): void {
    this.snapshots.clear();
    if (!reset) {
      for (const { key, box } of this.boxes) {
        this.snapshots.set(key, box.snapshot());
      }
    }
  }

  render(page: TreePage, extra: TreeSection[] = []): string {
    this.lists = [];
    const body = [...page.sections, ...extra]
      .map((section, i) => {
        if (!section.list) {
          return renderSection(section, null);
        }
        const key = section.key ?? section.title ?? `#${i}`;
        this.lists.push({ key, options: section.list });
        return renderSection(section, this.lists.length - 1);
      })
      .join('');
    return `<div class="space-y-4">${renderHeader(page)}${body}</div>`;
  }

  mount(host: HTMLElement): void {
    this.destroy();
    host.querySelectorAll<HTMLElement>('[data-list-box]').forEach((el) => {
      const list = this.lists[Number(el.dataset.listBox)];
      if (list) {
        const box = mountListBox(
          el,
          list.options,
          this.snapshots.get(list.key)
        );
        this.boxes.push({ key: list.key, box });
      }
    });
    this.snapshots.clear();
  }

  destroy(): void {
    for (const { box } of this.boxes) {
      box.destroy();
    }
    this.boxes = [];
  }
}

export class TreePageHost<S> {
  private panel: PanelHost<S>;
  private mounter = new TreePageMounter();

  constructor(host: HTMLElement, hooks: TreePageHostHooks<S>) {
    this.panel = new PanelHost<S>(host, {
      navigate: hooks.navigate,
      href: hooks.href,
      action: hooks.action,
      beforeRender: (_el, reset) => this.mounter.capture(reset),
      renderPage: (state) =>
        this.mounter.render(
          hooks.page(state),
          hooks.extraSections?.(state) ?? []
        ),
      afterRender: (el) => this.mounter.mount(el),
    });
  }

  initialize(): void {
    this.panel.initialize();
  }

  destroy(): void {
    this.mounter.destroy();
    this.panel.destroy();
  }

  get state(): S | null {
    return this.panel.state;
  }

  show(state: S, breadcrumbs: BreadcrumbItem<S>[]): void {
    this.panel.show(state, breadcrumbs);
  }

  setBreadcrumbs(breadcrumbs: BreadcrumbItem<S>[]): void {
    this.panel.setBreadcrumbs(breadcrumbs);
  }

  /** Re-render the current page once its data changed. */
  queueRender(): void {
    this.panel.queueRender();
  }

  hide(): void {
    this.mounter.destroy();
    this.panel.hide();
  }
}
