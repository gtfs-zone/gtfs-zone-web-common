# gtfs-zone-web-common

Shared browser-side modules for the gtfs.zone apps: **gtfs-zone-editor**
(edit.gtfs.zone), **gtfs-zone-rt-viewer** (viz.rt.gtfs.zone) and
**gtfs-zone-rt-manager** (manage.rt.gtfs.zone).

Ships raw `.ts` source under `src/`. There is no build step: each app's vite
compiles it as source. Consumed as a pinned git dependency:

```
pnpm add "gtfs-zone-web-common@github:gtfs-zone/gtfs-zone-web-common#vX.Y.Z"
```

`maplibre-gl`, `@leeoniya/ufuzzy`, `jszip` and `papaparse` are peer
dependencies. Every consumer already carries all four, and a second copy of
maplibre is a broken map rather than a duplicate. `gtfs-realtime-bindings` is
an optional peer: `gtfs/rt-types.ts` imports its namespace as a type and
nothing here pulls protobufjs into a bundle, so only the apps that read GTFS-RT
need it installed.

## Consumer wiring

Adding this library to an app takes four separate edits, and missing any one
of them fails in a different place:

1. `tsconfig.json` path, so `tsc` resolves the import:
   `"gtfs-zone-web-common/*": ["node_modules/gtfs-zone-web-common/src/*"]`
2. `vite.config.js` alias, so the bundler resolves the same specifier, plus
   `optimizeDeps.exclude: ['gtfs-zone-web-common']` because the package ships raw `.ts`
   and must be transformed as source:
   `'gtfs-zone-web-common': resolve(__dirname, 'node_modules/gtfs-zone-web-common/src')`
3. The Tailwind `@source` line in the app's CSS, so classes used only inside
   this library are not purged:
   `@source "../../node_modules/gtfs-zone-web-common/src/**/*.ts";`
4. The shell stylesheet `@import`, directly after `@import 'tailwindcss'`
   (postcss rejects an `@import` placed after any other statement), so the
   grid, the mobile drawer and the map controls are styled:
   `@import '../../node_modules/gtfs-zone-web-common/src/ui/app-shell.css';`

## Configuration

Read from the consumer's Vite env at its build time:

| variable | default | what it does |
| --- | --- | --- |
| `VITE_CORS_PROXY` | `https://cors.kcfam.us/` | prefix put in front of a feed URL fetched through the CORS proxy (`gtfs/feed-selection.ts`) |

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
Instead it resolves the sibling checkouts, collects every `gtfs-zone-web-common/...`
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
`gtfs-zone-web-common/ui/navbar-actions` and resolved through each consumer's tsconfig
path and vite alias.

## App shell

The layout every app shares, in four parts that go together:

- `ui/app-shell.ts` mounts the markup: navbar, map with its search card and
  auto-zoom toggle, the resizable right panel with `#panel-content`, and an
  optional mobile dock. Its element ids are what `search-controller`,
  `bottom-sheet`, `panel-resizer` and `navbar-actions` bind to.
- `ui/app-shell.css` styles it: the map/panel grid, the <=767px bottom-sheet
  drawer and the map controls. Imported from the app's stylesheet.
- `ui/page-state-manager.ts` owns the current page state, its history and the
  URL hash, generic over the app's page-state union. The app supplies the hash
  codec and the validator.
- `ui/focus-controller.ts` (`setFocus`, `onFocusChange` / `onStateChange`) and
  `ui/panel-host.ts` (the `data-nav` dispatch, the breadcrumb header, and the
  scroll and `<details>` restore) sit on top of it. The app supplies the pages.

## Published data

The load modal's feed catalog is fetched at runtime from `https://data.gtfs.zone`
(`gtfs/data-origin.ts`), published daily by feed-catalog: `search.json`, a
compact cut of `feeds.json` listed in `manifest.json` with its hash, one entry
per transit system from Transitland, the Mobility Database and rt.gtfs.zone,
with the last reachability check of each of its roles. `gtfs/feed-catalog.ts`
loads it (falling back to `feeds.json` when the manifest does not list it),
`gtfs/feed-search.ts` searches it and `gtfs/feed-badges.ts` renders a feed's
state and role chips. The modal lists the feeds the host app can use by default
(a schedule that answered; in the visualiser, plus a realtime role that did),
newest schedule first, with a "show all" toggle. Nothing is baked into a
consumer's `public/`.

## Releasing

`cz bump` on `main`, which writes the version into `package.json`, updates
`CHANGELOG.md` and cuts the annotated `vX.Y.Z` tag. Push the commit and the tag,
then repin each consumer. A shared change is one commit here, one tag, and three
consumer bumps.

Restart any dev server the repinned app has running. The `gtfs-zone-web-common` alias
resolves through a pnpm symlink to a path in the store, and a repin swaps that
symlink for a new one. Vite does not watch `node_modules`, so every app file
whose transform is still cached keeps importing the old store path: the browser
then loads two copies of a shared module, one per path, and each copy gets its
own module-level state. `util/module-state.ts` keeps that from corrupting
anything and logs `loaded twice` when it happens; the restart is still the fix.
