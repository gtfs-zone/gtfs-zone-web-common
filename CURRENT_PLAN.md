# Current plan

Banners left to remove: **34** (test-track 11, yard-master 23).
Vendoring is gone when that number is zero.

## The goal

A reusable browser-side library for any GTFS / GTFS-RT frontend, not a shared
folder for three specific apps. Two consequences: modules are organised by
domain rather than by the `modules/utils/types` split they inherited from the
apps, and a module belongs here only if it would make sense to a fourth app that
does not exist yet.

## Where things stand

The first cut is done and clean. All 35 files moved out of the apps rather than
being copied: no app holds a duplicate of anything here, by path, by basename or
by content hash. All three consumers pin the same tag with no drift.

What is left is the second tier: 34 files still hand-copied between the apps,
each carrying an `@vendored-from` banner and a row in test-track's or
yard-master's `VENDORED.md`. 12 are `verbatim`, 19 `modified`, 3 `adopted`.
There is no copy script and never was; `scripts/vendor-check.ts` only verifies,
from a pre-commit hook, and it stays until the count reaches zero.

## Target layout (v2.0.0)

Four peers replace `modules/ utils/ types/`:

```
src/
  ui/        chrome that knows nothing about GTFS
    about-links, bottom-sheet, breadcrumb-trail, help-modal,
    keyboard-shortcuts, modal-router, modal-utils, nav-icons,
    navbar-actions, notification-system, panel-resizer,
    progress-indicator, search-controller, sidebar-modal,
    theme-controller
  gtfs/      the transit domain, including its own rendering
    feed-download, feed-selection, feed-url-resolve, route-colors,
    route-graph, route-sequence, route-sort, route-source,
    route-strip, types
  map/       everything that imports maplibre-gl
    auto-zoom, basemap-control, basemap-styles, icons,
    layer-specs, stop-layer-style
  util/      pure, domain-free
    escape-html, scs, theme-color, tooltip-position
```

Renames folded into the move, so the directory stops stuttering:

| from | to |
| --- | --- |
| `modules/map-icons.ts` | `map/icons.ts` |
| `modules/feed-progress-indicator.ts` | `ui/progress-indicator.ts` |
| `types/gtfs-flex.ts` | `gtfs/types.ts` |
| `utils/route-colors.ts` | `gtfs/route-colors.ts` |
| `modules/scs.ts` | `util/scs.ts` |

Placement calls worth recording. `route-strip` and `route-graph` are rendering,
but they render *routes*, so they are domain, not generic UI.
`feed-progress-indicator` is the opposite: a generic top progress bar named
after its first caller, hence the rename into `ui/`. `scs` is a general sequence
algorithm with no GTFS in it, so it goes to `util/` even though `route-sequence`
is its only caller today. `map/` is defined mechanically as "imports
`maplibre-gl`", which is exactly those files plus `basemap-styles`.

No barrel `index.ts` files. Consumers resolve `interlocking/*` to
`node_modules/interlocking/src/*` through a tsconfig path and a vite alias, so
`interlocking/ui/navbar-actions` works with no config change on their side. The
reorg is a breaking change for import paths only, which is what makes it v2.0.0.

## Wave A: move what is already near-identical

About 15 files, duplicated across two apps at under 5% drift. Two are
byte-identical once the banner is stripped: `modules/examples.ts`
(coloring-book / test-track) and `src/gtfs-scheduled.ts` (test-track /
yard-master).

The rest, by drift:

- test-track / yard-master, headed for `gtfs/`:
  `gtfs-scheduled-route-source.ts` (4 diff lines), `render-utils.ts` (10),
  `rt-index.ts` (10), `alerts.ts` (12), `feed-time.ts` (20)
- coloring-book / test-track: `utils/field-label.ts` (17),
  `utils/issue-card.ts` (18)
- coloring-book / yard-master: `utils/calendar-input.ts` (29),
  `utils/spec-markup.ts` (42)
- coloring-book / test-track: `modules/load-modal.ts` (31 lines over 960), the
  biggest low-drift file in the set, headed for `ui/`

Two need a decision before they can move:

- `styles/main.css` (25 diff lines between the realtime pair). The package
  ships no CSS today, so this is a question about what the package is, not a
  file move.
- `scripts/generate-atlas-data.ts` (18). Build tooling, not `src/`. Same
  question: does this package ship scripts at all?

Each file moves the way the first cut did: reconcile the drift in the upstream
copy, move it into the right directory here, delete the downstream copies and
their `VENDORED.md` rows, repoint imports, bump, repin.

## Wave B: extract, do not move

Three-way divergence in the hundreds of lines: `page-state-manager.ts`,
`app-state.ts`, `feed-session.ts`, `map-controller.ts`, `gtfs-rt.ts`,
`calendar-modal.ts`, `help-pages.ts`, `alerts-modal.ts`, `breadcrumbs.ts`,
`search-entries.ts`, `panel-renderer.ts`, `modules/pages/*`,
`types/page-state.ts`.

Moving these is not possible; the shape has to come out instead. The pattern
that already works here is `route-source.ts`: define the narrow interface the
shared engine needs and let each app satisfy it from its own storage. Expect an
engine plus an interface out of each, not a file move.

## Never migrating

`navbar-action-list.ts`, `shortcut-list.ts`, `config.ts`, `index.ts`,
`env.d.ts` are per-app data and wiring by design. `yard-master/src/gtfs-rt-spec/`
and `coloring-book/src/gtfs-spec/` share a shape but not content, deliberately.

## When the count hits zero

In both test-track and yard-master, delete `VENDORED.md`,
`scripts/vendor-check.ts`, the `vendor:check` script in `package.json`, the
`vendor:check` call in `.githooks/pre-commit`, and the vendoring sections of
`CLAUDE.md` and `README.md`.

## Gaps here

There is no lint, typecheck or test gate in this repo, so a dead export or a
broken type is only found when a consumer's build trips on it. Worth adding
before wave A roughly doubles the file count.
