# Current plan

Banners left to remove: **34** (test-track 11, yard-master 23).
Vendoring is gone when that number is zero. Decrement this as work lands.

Read `## Order of work` at the bottom first. Phase 0 comes before everything.

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

### 0b. Move `scripts/generate-atlas-data.ts`

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
directory for zero-dependency Node tooling. Note `package.json` has
`files: ["src"]`, which would need `scripts` added — though as a git dependency
the whole repo is present regardless, so that is tidiness, not a blocker.

## Target layout (v2.0.0)

Lands after phase 0 and before wave A. Four peers replace
`modules/ utils/ types/`:

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

Do phase 0 and the v2.0.0 reorg first. The gate has to exist or every file
landing here loses the eslint/knip/prettier coverage it had in its home repo,
and the reorg has to be done or these files move twice.

About 13 files, duplicated across two apps at under 5% drift. Two are
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

Each file moves the way the first cut did: reconcile the drift in the upstream
copy, move it into the right directory here, delete the downstream copies and
their `VENDORED.md` rows, repoint imports, bump, repin.

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
2. Phase 0b, the atlas script.
3. The v2.0.0 reorg into `ui/ gtfs/ map/ util/`.
4. Wave A, the near-identical files.
5. Wave B, the extractions.

The reorg goes before wave A, not after. Wave A files then land in their final
directory instead of being moved twice, and the consumers absorb one
import-path break across the imports of 35 files rather than 48. Do not
interleave the two: a reorg and a migration in one release makes the consumer
diff unreadable.
