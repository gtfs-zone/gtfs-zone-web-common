# gtfs-zone-web-common

[![CI](https://img.shields.io/github/actions/workflow/status/gtfs-zone/gtfs-zone-web-common/check.yml?branch=main&label=CI)](https://github.com/gtfs-zone/gtfs-zone-web-common/actions/workflows/check.yml?query=branch%3Amain) [![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE.txt) [![Latest tag](https://img.shields.io/github/v/tag/gtfs-zone/gtfs-zone-web-common?sort=semver)](https://github.com/gtfs-zone/gtfs-zone-web-common/tags)

Shared browser-side modules for the gtfs.zone apps: **gtfs-zone-editor**
(edit.gtfs.zone), **gtfs-zone-rt-viewer** (viz.rt.gtfs.zone) and
**gtfs-zone-rt-manager** (manage.rt.gtfs.zone).

Ships raw `.ts` source under `src/`. There is no build step: each app's vite
compiles it as source. Consumed as a pinned git dependency:

```
pnpm add "gtfs-zone-web-common@github:gtfs-zone/gtfs-zone-web-common#vX.Y.Z"
```

`maplibre-gl`, `@leeoniya/ufuzzy`, `fflate` and `papaparse` are peer
dependencies. Every consumer carries all four, and a second copy of
maplibre is a broken map rather than a duplicate. `gtfs-realtime-bindings` is
an optional peer: `gtfs/rt-poller.ts` is its one value import and the rest
import its namespace as a type, so only the apps that poll GTFS-RT pull
protobufjs into a bundle or need it installed.

`gtfs-zone-vocab` (route type labels and families) is a peer too: pnpm blocks
git-hosted subdependencies, so each consumer pins it by tag itself:

```
pnpm add "gtfs-zone-vocab@github:gtfs-zone/gtfs-zone-vocab#vX.Y.Z"
```

## Consumer wiring

Adding this library to an app takes five separate edits, and missing any one
of them fails in a different place:

1. `tsconfig.json` paths, so `tsc` resolves the imports. The vocab entry is
   needed because `"moduleResolution": "Node"` ignores its `exports` map:
   `"gtfs-zone-web-common/*": ["node_modules/gtfs-zone-web-common/src/*"]`,
   `"gtfs-zone-vocab/*": ["node_modules/gtfs-zone-vocab/ts/*"]`
2. `vite.config.js` alias, so the bundler resolves the same specifier, plus
   `optimizeDeps.exclude: ['gtfs-zone-web-common']` because the package ships raw `.ts`
   and must be transformed as source. The alias takes the real path: through
   the `node_modules` symlink Vite adds a `?v=` query to the app's imports but
   not to this library's relative ones, and the page loads two copies of each
   module. `server.fs.allow` and `resolve.dedupe` let a local link (below)
   serve and share the app's peers:
   ```js
   const webCommonDir = realpathSync(resolve(__dirname, 'node_modules/gtfs-zone-web-common'))
   const webCommonPeers = Object.keys(
     JSON.parse(readFileSync(resolve(webCommonDir, 'package.json'), 'utf-8')).peerDependencies
   )
   // server
   fs: { allow: [searchForWorkspaceRoot(__dirname), webCommonDir] }
   // resolve
   alias: { 'gtfs-zone-web-common': resolve(webCommonDir, 'src') },
   dedupe: webCommonPeers
   ```
3. The Tailwind `@source` line in the app's CSS, so classes used only inside
   this library are not purged:
   `@source "../../node_modules/gtfs-zone-web-common/src/**/*.ts";`
4. The shell stylesheet `@import`, directly after `@import 'tailwindcss'`
   (postcss rejects an `@import` placed after any other statement), so the
   grid, the mobile drawer and the map controls are styled:
   `@import '../../node_modules/gtfs-zone-web-common/src/ui/app-shell.css';`
5. A direct `gtfs-zone-vocab` dependency pinned by tag (see above). Vite
   resolves it through its `exports` map with no alias.

### Local link

`bin/common-link.sh` swaps the consumer's `node_modules/gtfs-zone-web-common`
for a symlink to a sibling checkout, so edits here show up in the app before
a tag. `pnpm install` does not undo the swap, so the script saves the
pnpm-installed link and restores it. Each consumer wires it as:

```json
"prebuild": "sh node_modules/gtfs-zone-web-common/bin/common-link.sh check && ...",
"common:local": "sh node_modules/gtfs-zone-web-common/bin/common-link.sh local",
"common:tag": "sh node_modules/gtfs-zone-web-common/bin/common-link.sh tag"
```

plus a `pre-push` hook running `common-link.sh check`, so neither a build nor
a push goes out while the link is local. `common:local` takes another
checkout as an argument (`pnpm common:local ../gtfs-zone-web-common-spec`).
Restart the dev server after each switch.

## Configuration

Read from the consumer's Vite env at its build time:

| variable | default | what it does |
| --- | --- | --- |
| `VITE_CORS_PROXY` | `https://cors.gtfs.zone/` | prefix put in front of a feed URL fetched through the CORS proxy (`gtfs/feed-selection.ts`) |

## Localization

`i18n/index.ts` holds a typed `t()` with no dependency. `defineCatalog(en, { fr, de })`
takes an English catalog declared `as const` and returns a translator that only
accepts its keys; a `Translation<typeof en>` for another locale may leave keys
out, and those fall back to English. Strings use `{var}` placeholders, and a
plural is a `name_one` / `name_other` pair called as `t('name', { count })`.

`getLocale()` reads the `locale` cookie (on `Domain=.gtfs.zone`, so it carries
across the apps), then localStorage (localhost), then the browser's languages,
then `en`, and sets `<html lang>`. `setLocale()` stores the choice. The
`locale` navbar action renders a menu of the other locales; picking one stores
it and reloads. `githubAction(repo)` from `ui/navbar-actions` is the navbar link to
the app's repo under the gtfs-zone org. `i18n/fmt.ts` formats dates and numbers in the active locale.

Each app keeps its own catalogs; this package's own strings are in
`i18n/catalog.en.ts`, `i18n/catalog.fr.ts` and `i18n/catalog.de.ts`. GTFS field names, file names and
enum values are never translated.

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

`pnpm run check` runs all six, and a pre-commit hook runs them on every
commit (setup in [CONTRIBUTING.md](CONTRIBUTING.md)).

| script | what it does |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src/` and `scripts/` |
| `lint` | `eslint src/ scripts/ tests/ vitest.config.js --max-warnings 0` |
| `knip` | reports unused files and dependencies |
| `check:exports` | reports exports no consumer imports |
| `test` | unit tests under `tests/`, on Vitest (`src/testing/vitest-preset.js`) |
| `check-spec` | diffs `src/gtfs/spec/` against the reference snapshots |

`format` runs prettier over the same directories.

knip only checks files and dependencies here. Its unused-export check is
vacuous for a library with no barrel files: every module is its own entry
point, so nothing ever looks unused. `check:exports` covers exports instead: it
resolves the sibling checkouts, collects every `gtfs-zone-web-common/...`
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
src/testing/  Playwright and Vitest presets and helpers (plain JS, see Test kit)
fixtures/   feeds and basemap the test kit serves, pinned in SHA256SUMS
```

No barrel `index.ts` files: every module is its own entry point, imported as
`gtfs-zone-web-common/ui/navbar-actions` and resolved through each consumer's tsconfig
path and vite alias.

## Test kit

`src/testing/` is what the apps' specs build on. It is plain ESM JavaScript
with JSDoc types, checked here by `tsc` (`checkJs`): Playwright and Node do not
transpile TypeScript under `node_modules`, where a consumer's copy lives. It is
imported through the `exports` entry, which also matches the consumer's
tsconfig path, with the `.js` extension:
`gtfs-zone-web-common/testing/helpers.js`. A consumer's e2e tsconfig needs
`allowJs: true` to pick up the JSDoc types. `@playwright/test`,
`@argos-ci/playwright`, `pmtiles` and `vitest` are optional peers: an app that
runs the kit installs them itself.

| module | what it gives |
| --- | --- |
| `playwright-preset.js` | `playwrightPreset({ port, testDir, webServerCommand, overrides })`: light, dark and `@mobile` projects, 1600x1000 at scale 1 (mobile 390x844 at 2), `en-US`, `America/New_York`, reduced motion, `pnpm run build` then `vite preview` as the web server, the Argos reporter (uploads only when `CI` is set) |
| `helpers.js` | `fixturePath` (checks the file against `SHA256SUMS`), `FEEDS`, `mbtaDemoManifest`, `preparePage` (theme of the project, seen help pages, `freezeClock` at `FIXTURE_NOW`, `useFixtureBasemap`), `loadFeedFile` (the shared load modal), `waitForMapIdle(page, 'path.to.map')`, `screenshot` (`argosScreenshot` with animations off, the mouse parked, `VOLATILE_UI` hidden) |
| `vitest-preset.js` | `vitestPreset(overrides)`: node environment, `tests/**/*.test.ts` and `src/**/*.test.ts`, this package inlined so Vite transforms its TypeScript; merge it over the app's Vite config for the aliases |

Fixtures, all pinned by sha256 in `fixtures/SHA256SUMS` (`tests/fixtures.test.ts`
checks every file and that the list is complete):

- `feeds/mbta-demo.zip`: typical patterns of the MBTA feed, a few trips per
  pattern on one weekday, Saturday and Sunday of a reference week, plus the
  Charles/MGH station with every pathway; `feeds/mbta-demo.manifest.json`
  holds the IDs and dates specs deep-link to. `pnpm fixtures:feeds` rebuilds
  it from the cached MBTA download (`--refresh` on the builder downloads a new
  one, which changes the output).
- `feeds/synthetic-demo.zip`: generated, so the same on every run: one
  frequent bus line and an on-demand route over two zones.
- `basemap/`: a Protomaps vector extract to z10 around the MBTA feed, light and
  dark styles from `@protomaps/basemaps`, and the glyphs and sprites they use.
  `useFixtureBasemap` serves it on `https://basemap.fixture.test` through
  `page.route` and sets the global `getBasemapStyle` honours, so every basemap
  in an app that builds its map from `initialMapStyle` or `BasemapControl`
  becomes the fixture. MapLibre overzooms past z10. `pnpm fixtures:basemap`
  rebuilds it; it needs the `pmtiles` CLI (go-pmtiles) on `PATH`.

Rebuilding a fixture rewrites `SHA256SUMS`; commit both.

## App shell

The layout every app shares, in four parts that go together:

- `ui/app-shell.ts` mounts the markup: navbar, map with its search card and
  auto-zoom toggle, the resizable right panel with `#panel-content`, and an
  optional mobile dock. Its element ids are what `search-controller`,
  `bottom-sheet`, `panel-resizer` and `navbar-actions` bind to.
- The navbar brand (logo and host) is the tool switcher, a daisyUI
  `dropdown-hover` (hover on desktop, tap or focus on touch and keyboard). It
  lists every tool in `src/tools.json`, read through `ui/tools.ts`, with the
  current one marked, then a version section: the `version` passed to
  `mountAppShell` and the kept versions in the deploy's `/versions.json`
  (`{ "versions": [{ "version", "url" }] }`). The section stays hidden when
  that file is missing, as on the dev server.
- `ui/app-shell.css` styles it: the map/panel grid, the <=767px bottom-sheet
  drawer and the map controls. Imported from the app's stylesheet.
- `ui/page-state-manager.ts` owns the current page state, its history and the
  URL hash, generic over the app's page-state union. The app supplies the hash
  codec and the validator.
- `ui/focus-controller.ts` (`setFocus`, `onFocusChange` / `onStateChange`) and
  `ui/panel-host.ts` (the `data-nav` dispatch, the breadcrumb header, and the
  scroll and `<details>` restore) sit on top of it. The app supplies the pages.

### Rows-only scrolling

The modal body (`showModal`) and `#panel-content` are `.scroll-host`s. A page
that marks one element `.scroll-rows` (a list, a table wrapper) scrolls only
that element: the host stops scrolling and every element between the host and
the region becomes a flex column, so what sits above and below the rows stays
in place. Mark one region per page; a page with none scrolls as a whole. A
page with several lists caps each one with `renderScrollbox` (`ui/scrollbox`)
instead.
`renderScrollableTable` and the month grid of `ui/calendar-modal` are regions
already, and `ui/lazy-list` observes a region as its scroll root.

## Feed store

`gtfs/store/` loads a GTFS zip in a worker and keeps it there, columnar:

- `csv-stream.ts` streams the zip (fflate) into chunked CSV parsing
  (PapaParse). It never holds a whole file as text, and it pipes a nested
  archive (`a.zip#inner.zip`) straight into a second unzip.
- `feed-store.ts` holds every table as typed-array columns over an interned
  string pool. stop_times is folded into trip patterns and shapes into runs,
  and every value reads back exactly as it was in the file. An edit overlay
  sits on top: row-level edits for ordinary tables, per-trip stop_times and
  per-shape points. Reads return copies.
- `store-worker-core.ts` / `store-client.ts`: one worker per loaded feed.
  `FeedStoreClient.load` spawns it, `release()` terminates it (the only thing
  that frees the memory), and `call()` runs a store method or a view query
  (`feed-queries.ts`) in it, one call at a time. Tables named in `mirror` are
  also kept on the main thread for synchronous reads; every reply carries the
  mirror changes its call made (`mirrorchange`, or `mirrorreset` after the
  store was replaced). `store.worker.ts` is the plain worker; an app worker
  calls `serveStore` with its own methods and passes its factory to `load`.
- `FeedStore.patternReader()` (`pattern-reader.ts`) reads stop_times at the
  pattern level without building rows: trip to pattern, pattern to trips, a
  content key and hash per pattern that match across stores, and each trip's
  encoded times (`encodedTimes`) as `Int32Array` views. For comparing two stores.
- `FeedStore.fold()` builds a new, unedited store from the merged view (base
  plus edits), so it can be saved as a new base.
- `base-file.ts` / `opfs-base.ts`: an unedited store's base as one binary
  file (header, meta JSON, aligned typed arrays) in the OPFS `feed-bases`
  directory. `call('saveBase', name)` writes a new file and
  `FeedStoreClient.load({ base: name })` restores it without parsing. Files
  are never overwritten; list, delete, sweep and clear work on any thread.

`util/zip-index.ts` (`readZipIndex`) reads a zip's central directory (name,
CRC32 and sizes per entry, zip64 included) from a `Uint8Array` or a `Blob`
without inflating anything; a `Blob` is read by tail slices only.

`gtfs/scheduled.ts` (`GTFSScheduled`) is the realtime apps' view of a store:
it mirrors stops, routes, agency, calendar and feed_info, plus per-feed
aggregates (trips per route and per stop, routes per stop, route geometry).
Trips and stop_times are fetched on demand (`loadTrips`, `loadRoute`), unless
the `mirror` level keeps every trip (`trips`) or everything (`all`, small feeds
only) on the main thread.

## GTFS spec

`gtfs/spec/` is the GTFS Schedule reference as data, plus the Google overlay:

- `gtfs-spec.ts`: `baseGtfsSpec` (the reference, verbatim) and `gtfsSpec`
  (with `extensions/google.ts` applied). `files/*.ts` hold one file each.
- `types.ts`: each file's `primaryKey` (fields, `*` or `none`, as the
  reference states it) and per-field type, presence, enums and foreign keys.
- `primary-keys.ts`: `GTFS_PRIMARY_KEYS`, the row key per table derived from
  `primaryKey`, with `getGTFSPrimaryKey` / `getNaturalKeyField`.
- `adapter.ts` derives lookups and Zod schemas from a spec; `field-types.ts`
  holds the field type validators, with their messages in their own small
  catalog (`messages.ts`) so a worker building schemas bundles nothing else.

`pnpm check-spec` diffs the spec against `reference/gtfs-reference.md` and
`reference/google-reference.md` and fails on drift, primary keys included;
[reference/README.md](reference/README.md) covers refreshing the snapshots.
`zod` is a peer dependency for the schemas.

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

`gh workflow run release.yml` runs `cz bump` on `main`, which writes the version
into `package.json`, updates `CHANGELOG.md` and cuts the annotated `vX.Y.Z` tag,
then pushes the commit and the tag. Then repin each consumer. A shared change is
one commit here, one tag, and three consumer bumps.

Restart any dev server the repinned app has running. The `gtfs-zone-web-common` alias
resolves through a pnpm symlink to a path in the store, and a repin swaps that
symlink for a new one. Vite does not watch `node_modules`, so every app file
whose transform is still cached keeps importing the old store path: the browser
then loads two copies of a shared module, one per path, and each copy gets its
own module-level state. `util/module-state.ts` keeps that from corrupting
anything and logs `loaded twice` when it happens; the restart is still the fix.
