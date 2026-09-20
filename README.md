# interlocking

Shared browser-side modules for the gtfs.zone apps: **coloring-book**
(edit.gtfs.zone), **test-track** (viz.rt.gtfs.zone) and **yard-master**
(manage.rt.gtfs.zone).

Ships raw `.ts` source under `src/`. There is no build step: each app's vite
compiles it as source. Consumed as a pinned git dependency:

```
pnpm add "interlocking@git+https://git.kcfam.us/gtfs.zone/interlocking.git#vX.Y.Z"
```

`maplibre-gl`, `@leeoniya/ufuzzy`, `jszip` and `papaparse` are peer
dependencies. Every consumer already carries all four, and a second copy of
maplibre is a broken map rather than a duplicate. `gtfs-realtime-bindings` is
an optional peer: `gtfs/rt-types.ts` imports its namespace as a type and
nothing here pulls protobufjs into a bundle, so only the apps that read GTFS-RT
need it installed.

## What it is

A browser-side library for GTFS and GTFS-RT frontends: the UI chrome (navbar,
modals, notifications, theme, search), the GTFS domain modules (route ordering,
route diagrams, colors, feed loading) and the MapLibre layer specs. Nothing in
here is specific to one of the three apps; anything that is belongs in the app.

Modules arrive by moving out of an app, not by being copied from it: once a
module lives here it is edited here.

`CURRENT_PLAN.md` holds the roadmap, including what is still hand-copied
between the apps and the layout this package is moving to.

## Checks

`pnpm run check` runs all three, and a pre-commit hook runs them on every
commit (enable it with `git config core.hooksPath .githooks`).

| script | what it does |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src/` and `scripts/` |
| `lint` | `eslint src/ scripts/ --max-warnings 0` |
| `check:exports` | reports exports no consumer imports |

`format` runs prettier over the same directories.

`check:exports` replaces knip, which is vacuous for a library with no barrel
files: every module is its own entry point, so nothing ever looks unused.
Instead it resolves the sibling checkouts, collects every `interlocking/...`
import across them and diffs that against what `src/` exports. An export only
another module here imports is reported as `internal` rather than unused. A
sibling that is not checked out is skipped, and the run exits 0 when all three
are absent. Unused exports warn; `--strict` makes them fatal.

## Layout

Four peers, organised by domain rather than by the `modules/utils/types` split
the apps use:

```
src/ui/     chrome that knows nothing about GTFS
src/gtfs/   the transit domain, including its own rendering
src/map/    everything that imports maplibre-gl
src/util/   pure, domain-free
```

No barrel `index.ts` files: every module is its own entry point, imported as
`interlocking/ui/navbar-actions` and resolved through each consumer's tsconfig
path and vite alias.

## Node tooling for consumers

`scripts/` ships alongside `src/`: zero-dependency Node scripts an app runs
straight out of `node_modules`. Paths in them resolve from `process.cwd()`, so
they run from the app root.

| script | what it does |
| --- | --- |
| `generate-atlas-data.ts` | writes `public/atlas-feeds.json` from the transitland-atlas DMFR corpus, reading a sibling `../transitland-atlas` checkout when there is one and the GitHub API otherwise. `--schedule-only` drops the realtime rows |

```
"atlas": "tsx node_modules/interlocking/scripts/generate-atlas-data.ts"
```

## Releasing

`cz bump` on `main`, which writes the version into `package.json`, updates
`CHANGELOG.md` and cuts the annotated `vX.Y.Z` tag. Push the commit and the tag,
then repin each consumer. A shared change is one commit here, one tag, and three
consumer bumps.

Restart any dev server the repinned app has running. The `interlocking` alias
resolves through a pnpm symlink to a path in the store, and a repin swaps that
symlink for a new one. Vite does not watch `node_modules`, so every app file
whose transform is still cached keeps importing the old store path: the browser
then loads two copies of a shared module, one per path, and each copy gets its
own module-level state. `util/module-state.ts` keeps that from corrupting
anything and logs `loaded twice` when it happens; the restart is still the fix.
