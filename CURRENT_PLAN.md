# Current plan

Banners left to remove: **21** (test-track 6, yard-master 15).
Vendoring is gone when that number is zero. Decrement this as work lands.

Read `## Order of work` at the bottom first. Wave B is under way: the two
extractions have landed with the three files they unblocked, and what is left
is the three-way divergence at the bottom of that section.

## The goal

A reusable browser-side library for any GTFS / GTFS-RT frontend, not a shared
folder for three specific apps. Two consequences: modules are organised by
domain rather than by the `modules/utils/types` split they inherited from the
apps, and a module belongs here only if it would make sense to a fourth app that
does not exist yet.

## Where things stand

The first cut is done and clean. All 35 files moved out of the apps rather than
being copied: no app holds a duplicate of anything here, by path, by basename or
by content hash. All three consumers pin the same tag with no drift, and the
layout is the v2.0.0 one: `ui/ gtfs/ map/ util/`.

Wave A has landed too, and so has the first half of wave B: 49 modules live
here now.

What is left is 21 files still hand-copied between the apps, each carrying an
`@vendored-from` banner and a row in test-track's or yard-master's
`VENDORED.md`. There is no copy script and never was; `scripts/vendor-check.ts`
only verifies, from a pre-commit hook, and it stays until the count reaches
zero.

## Working here

The three consumers are sibling checkouts of this repo's parent directory
(`coloring-book`, `test-track`, `yard-master`), as is `transitland-atlas`.
Several scripts depend on that layout.

A shared change is: commit here, `cz bump` on `main`, push, then repin each
consumer. Two things that are easy to get wrong:

- There are **two remotes**, `origin` (git.kcfam.us) and `github`. Every tag
  exists on both. Push commits and tags to both, or a consumer's
  `pnpm install` resolves against a ref the other remote does not have.
- Repinning is editing the `#vX.Y.Z` ref in each consumer's `package.json` and
  running `pnpm install` so the lockfile re-resolves. Verify with
  `diff -rq <app>/node_modules/interlocking/src <this repo>/src`, which should
  be empty.
- Restart the app's dev server after a repin. Vite does not watch
  `node_modules`, so cached transforms keep importing the old pnpm store path
  and the browser ends up with two copies of a shared module. See `README.md`.

## Phase 0: build the gate, then move the atlas script

Both halves of this land before wave A.

### 0a. Tooling - done

Landed: `tsconfig.json` + `typecheck`, eslint and prettier lifted from
coloring-book, `scripts/check-exports.ts` wired as `check:exports`, and a
`.githooks/pre-commit` running all three. `pnpm run check` runs them together.
The formatting fix-up was three files. The first `check:exports` run reports 52
exports no app imports and 7 imported only from inside this package; those are
a cleanup backlog, not a blocker, and the check warns rather than fails.

What that replaced, kept for the reasoning:

- **`tsconfig.json` and a `typecheck` script** (`tsc --noEmit`), with
  `typescript`, `maplibre-gl` and `@leeoniya/ufuzzy` as devDependencies. The
  peers are needed as devDeps too or the types do not resolve standalone.
  Biggest single win: a broken type surfaces here instead of in three consumer
  builds.
- **eslint and prettier lifted from coloring-book** (`eslint.config.js` is 54
  lines, `.prettierrc` is 7). That repo is the origin of most of this code, so
  the code already satisfies its rules and the fix-up should be near zero. Match
  its script shapes: `eslint src/ --max-warnings 0` and `prettier --write src/`.
- **A dead-export check, but not knip.** knip is the wrong tool for a library:
  with no barrel files every module is an entry point, so nothing ever looks
  unused and the run is vacuous. The right shape is a small script modeled on
  the sibling-resolution in test-track's and yard-master's
  `scripts/vendor-check.ts`: resolve the three sibling checkouts, collect every
  `interlocking/...` import across them, diff that against this package's
  exports, and report exports nobody imports. It must skip cleanly when a
  sibling is absent and exit 0 when all are, exactly as vendor-check does, so it
  never blocks CI. This is precisely the gap the README used to name.
- **A pre-commit hook** wiring the above, following the `.githooks/pre-commit`
  plus `git config core.hooksPath .githooks` pattern the two realtime apps use.

### 0b. Move `scripts/generate-atlas-data.ts` - done

Landed in v1.1.0. The script lives at `interlocking/scripts/generate-atlas-data.ts`,
both path constants are `process.cwd()`-relative, `scripts` is in `package.json`
`files`, and both apps run
`tsx node_modules/interlocking/scripts/generate-atlas-data.ts`. Output verified
byte-identical to the old copies in both apps. The gate earned its keep on the
first try: the file arrived with nine `curly` errors and a `fetch` no-undef,
because coloring-book's eslint config is not the one lifted here.

What that replaced, kept for the reasoning:

This is the easiest migration in the whole set, easier than anything in wave A,
and it doubles as the first real exercise of the phase 0 tooling.

- The coloring-book and test-track copies are **byte-identical apart from the
  vendoring banner** (299 vs 302 lines; the three extra lines are the banner).
- It imports only `fs/promises`, `path` and `url`. Zero third-party
  dependencies, so it adds nothing to this package's install.
- The two apps already differ only by a CLI flag that is parameterized:
  coloring-book runs it with `--schedule-only`, test-track without.

One blocker, and it is small. Both paths are `__dirname`-relative
(`generate-atlas-data.ts:28-29`):

```
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'atlas-feeds.json');
const LOCAL_ATLAS_PATH = path.join(__dirname, '..', '..', 'transitland-atlas');
```

From `node_modules/interlocking/scripts/` those resolve to
`node_modules/interlocking/public/` and `node_modules/transitland-atlas`, both
wrong. Swap them to `process.cwd()`-relative: `pnpm atlas` already runs from the
app root, so `process.cwd()/public/atlas-feeds.json` and
`process.cwd()/../transitland-atlas` reproduce today's behavior exactly. That is
about four lines. Consumers then run
`tsx node_modules/interlocking/scripts/generate-atlas-data.ts`.

Moving it drops the banner count to 33 (test-track 10, yard-master 23).

This also settles, by demonstration rather than debate, the open question of
whether this package ships anything outside `src/`. It does: a `scripts/`
directory for zero-dependency Node tooling, now listed in `package.json`
`files` alongside `src`.

## The layout (v2.0.0) - done

Landed in v2.0.0. Four peers replaced `modules/ utils/ types/`:

```
src/
  ui/        chrome that knows nothing about GTFS
    about-links, bottom-sheet, breadcrumb-trail, calendar-input,
    field-label, help-modal, issue-card, keyboard-shortcuts,
    load-modal, modal-router, modal-utils, nav-icons, navbar-actions,
    notification-system, panel-resizer, progress-indicator,
    search-controller, sidebar-modal, theme-controller
  gtfs/      the transit domain, including its own rendering
    alerts, entity-render, examples, feed-download, feed-selection,
    feed-session, feed-time, feed-url-resolve, route-colors, route-graph,
    route-sequence, route-sort, route-source, route-strip, rt-index,
    rt-types, scheduled, scheduled-route-source, spec-markup, types
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

All three consumers repinned from v1.0.1 straight to v2.0.0, skipping v1.1.0:
the atlas-script half of phase 0b had landed here but was never committed on
their side, so each consumer's bump carries both changes. `check:exports` is the
proof the rewrite was complete: 52 unused and 7 internal before the reorg, the
same 52 and 7 after, which only holds if every one of the 158 app-side imports
found its new path.

Two things the rewrite turned up, worth expecting again in wave A:

- coloring-book's pre-commit prettier reflowed one import that the shorter path
  now let fit on one line, which read as vendoring DRIFT in test-track's copy
  until the same collapse was applied there.
- Every vendored file that imports from this package went stale at once. Six
  coloring-book shas in test-track, and two coloring-book plus thirteen
  test-track shas in yard-master, all one commit behind and all bumped in the
  same commit as the repoint.

## Wave A: move what is already near-identical - done, bar three files

Landed in v2.1.0. Nine of the twelve moved:

| to | from |
| --- | --- |
| `gtfs/examples.ts` | `coloring-book:src/modules/examples.ts` |
| `gtfs/scheduled.ts` | `test-track:src/gtfs-scheduled.ts` |
| `gtfs/scheduled-route-source.ts` | `test-track:src/modules/gtfs-scheduled-route-source.ts` |
| `gtfs/feed-time.ts` | `test-track:src/modules/feed-time.ts` |
| `gtfs/spec-markup.ts` | `coloring-book:src/utils/spec-markup.ts` |
| `ui/field-label.ts` | `coloring-book:src/utils/field-label.ts` |
| `ui/issue-card.ts` | `coloring-book:src/utils/issue-card.ts` |
| `ui/calendar-input.ts` | `coloring-book:src/utils/calendar-input.ts` |
| `ui/load-modal.ts` | `coloring-book:src/modules/load-modal.ts` |

The `gtfs-` prefixes went in the move, the same de-stuttering the reorg did:
`gtfs/gtfs-scheduled.ts` says it twice.

Eight of the nine arrived with no drift at all. The recorded drift numbers were
stale: every pair but `spec-markup` had been re-synced since, so the only real
reconciliation was that one.

`spec-markup` had two genuine parameters and now takes both through a
`configureSpecMarkup({ referenceUrl, images })` boot hook: the base URL a
`#anchor` resolves against, which is the schedule reference in coloring-book and
the realtime one in yard-master, and the three diagrams coloring-book bundles
that yard-master has no counterpart for. Every call site is unchanged. Each
app's `index.ts` calls it once, at module scope.

`gtfs/scheduled.ts` adds `jszip` and `papaparse` as peer dependencies. All three
consumers already carried both.

Two things worth recording:

- The eslint gate earned its keep again. `gtfs/scheduled.ts`, `gtfs/feed-time.ts`
  and `gtfs/scheduled-route-source.ts` arrived with eighteen `curly` errors
  between them, because test-track's config is not the one lifted here.
- The staleness cascade the reorg warned about repeated exactly: six of
  yard-master's banners went one commit behind test-track at once, and were
  bumped in the same commit as the repoint.

### The three that did not move - done in wave B

`render-utils.ts`, `rt-index.ts` and `alerts.ts` were blocked, not deferred. All
three were byte-identical between test-track and yard-master, but all three
imported things this package did not have:

- `presentNumber` and the `TripUpdate` / `ServiceAlert` / `AlertRecord` types
  from `gtfs-rt.ts`
- `FeedSession`, as a type
- `VehiclePosition` from `map-controller.ts`, and `PageState`

Every one of those is a wave B file. Moving the three meant extracting first,
so they went at the front of wave B rather than at the back of wave A. See
`## Wave B` for what landed.

The `gtfs-rt.ts` half is the smaller of the two and is nearly free: yard-master's
copy is already the type-only half, four exports over about eighty lines, having
dropped test-track's decoder and poller so protobufjs tree-shakes out. That is
`gtfs/rt-types.ts` almost as it stands. `FeedSession` is the `route-source.ts`
pattern again: the narrow read-only interface those three want is
`scheduledFeed` / `vehicles` / `alerts` / `tripUpdates`, which is exactly the
surface yard-master already shapes its own session to satisfy.

### Not in wave A: styles/main.css

Ruled out on inspection, despite a 25-line drift between the realtime pair that
makes it look like a candidate. Three reasons, recorded so nobody re-proposes
it:

1. The `@source` lines are already identical in all three apps and already
   point at this package (`@source "../../node_modules/interlocking/src/**/*.ts"`),
   so the shared modules' Tailwind classes are already scanned. There is no gap
   to close.
2. The genuinely common part is tiny: `.app-container` and the mobile media
   query. The bulk of each file is the `@plugin "daisyui"` theme block, which
   is that app's brand colors and *should* differ.
3. A relative `@source` inside an imported stylesheet resolves relative to that
   stylesheet, so a shared `base.css` living in this package would scan the
   package instead of the consuming app. Those lines have to stay per-app
   whatever else moves.

Leave the CSS duplicated. Revisit only if a shared components layer grows large
enough to outweigh the above.

## Wave B: extract, do not move

### The two extractions and the three files they unblocked - done

Landed in v2.2.0. Five new modules:

| to | from |
| --- | --- |
| `gtfs/rt-types.ts` | `yard-master:src/gtfs-rt.ts`, the type half |
| `gtfs/feed-session.ts` | new: the interface the three files read |
| `gtfs/rt-index.ts` | `test-track:src/modules/rt-index.ts` |
| `gtfs/alerts.ts` | `test-track:src/modules/alerts.ts` |
| `gtfs/entity-render.ts` | `test-track:src/modules/render-utils.ts` |

`render-utils` was renamed in the move, the same de-stuttering the reorg did: a
package with a `util/` peer has no business shipping a second `utils`, and what
the file actually renders is entity links, badges, headers and raw dumps.

`VehiclePosition` came along with the types, out of each app's
`map-controller.ts`. The two copies differed by one field, so the package holds
the common shape: test-track imports it unchanged, yard-master's map-controller
declares `interface VehiclePosition extends RtVehiclePosition { trackerId }`.

Three seams worth recording, because the rest of wave B will need the same
moves:

- **`FeedSession` is a read-only four-member view**, exactly the
  `route-source.ts` pattern: `scheduledFeed`, `vehicles`, `alerts`,
  `tripUpdates`. `ReadonlyMap` rather than `Map` is what lets an app hand over
  a map of its own wider vehicle.
- **The app's own types come back through generics.** `RenderContext<S, F>` is
  parameterized over the app's page-state union and its own session class, and
  `RtIndex<V>` over its vehicle, because yard-master's pages read
  `ctx.session.trackers` and `v.trackerId` and neither is anything this package
  knows about. `PageState` itself did not have to move: the renderers treat a
  state as opaque apart from `type`, so a `PageRef` constraint plus the one
  `RoutePageRef` the route badge builds is the whole contract. Each app binds
  the pair once in `modules/render-context.ts` and every page keeps writing
  `RenderContext` and `RtIndex` unparameterized.
- **`escHtml` is gone**, aliased to `util/escape-html`'s `escapeHtml`. The
  apps' copy escaped four characters where this one escapes five; the extra is
  `'`, and the rendered output is identical either way.

`gtfs-realtime-bindings` is an optional peer dependency now. coloring-book does
not carry it and has no reason to: nothing it imports reaches `rt-types.ts`.

### What is left

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

## Order of work

Commit after each numbered step, before starting the next one. Each step is one
commit on `main` (or a few, if the step splits cleanly), so a step that goes
wrong is one revert and the consumer-facing diff of a release stays readable.
Releasing is separate: `cz bump` when the work is ready to repin, not once per
commit.

1. ~~Phase 0a, the tooling gate.~~ Done.
2. ~~Phase 0b, the atlas script.~~ Done.
3. ~~The v2.0.0 reorg into `ui/ gtfs/ map/ util/`.~~ Done.
4. ~~Wave A, the near-identical files.~~ Done, bar `render-utils.ts`,
   `rt-index.ts` and `alerts.ts`, which are blocked on wave B.
5. ~~Wave B's first half: `gtfs-rt.ts`'s type half, the `FeedSession`
   interface, and the three wave A leftovers they unblocked.~~ Done.
6. Wave B's second half, the three-way divergence. Expect an engine plus an
   interface out of each, not a file move.

The reorg goes before wave A, not after. Wave A files then land in their final
directory instead of being moved twice, and the consumers absorb one
import-path break across the imports of 35 files rather than 48. Do not
interleave the two: a reorg and a migration in one release makes the consumer
diff unreadable.
