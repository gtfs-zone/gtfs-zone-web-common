# AGENTS.md

## Project Overview

`gtfs-zone-web-common` is the shared browser-side library for the three
gtfs.zone frontends: **gtfs-zone-editor** (edit.gtfs.zone),
**gtfs-zone-rt-viewer** (viz.rt.gtfs.zone) and **gtfs-zone-rt-manager**
(manage.rt.gtfs.zone). It ships raw TypeScript under `src/`
with no build step; each consumer's vite compiles it as source.

Consumed as a pinned git dependency:

```
pnpm add "gtfs-zone-web-common@github:gtfs-zone/gtfs-zone-web-common#vX.Y.Z"
```

`README.md` covers the layout and the public surface. `CURRENT_PLAN.md` holds
the roadmap.

## Commands

```bash
pnpm install

# typecheck + lint + check:exports; the pre-commit hook runs the same three
pnpm run check

pnpm run lint:fix
pnpm run format

# enable the hook once per clone
git config core.hooksPath .githooks
```

## Layout

Four peers, by domain rather than by the `modules/utils/types` split the apps
use:

```
src/ui/     chrome that knows nothing about GTFS
src/gtfs/   the transit domain, including its own rendering
src/map/    everything that imports maplibre-gl
src/util/   pure, domain-free
```

`scripts/` holds this repo's own dev tooling (`check-exports.ts`); nothing in
it is run by a consumer.

The feed catalog is not source here: feed-catalog publishes it to
`https://data.gtfs.zone` as `search.json` (and the full `feeds.json`), and
`gtfs/feed-catalog.ts` fetches it.

## Rules

- **No barrel `index.ts` files.** Every module is its own entry point, imported
  as `gtfs-zone-web-common/ui/navbar-actions`. A barrel would defeat `check:exports`,
  which is what stands in for knip here: with no barrels, an unimported export
  is genuinely unused rather than re-exported.
- **A module arrives by moving out of an app, not by being copied from it.**
  Once it lives here it is edited here, never in parallel in a consumer.
- **Nothing app-specific belongs here.** If it only makes sense for one of the
  three apps, it stays in that app.
- **Peer dependencies stay peers.** `maplibre-gl`, `@leeoniya/ufuzzy`, `jszip`
  and `papaparse` are peers because a second copy of maplibre is a broken map,
  not a duplicate. `gtfs-realtime-bindings` is an optional peer, imported as a
  type only, so nothing here pulls protobufjs into a bundle.

## UI conventions

These apply here and in all three consumers:

- No `cursor-help` (the question-mark pointer) on tooltip triggers or anywhere
  else.
- An on/off setting is a daisyUI `toggle`, never a `checkbox`. The hidden
  inputs behind `swap` icon buttons are the only checkboxes.
- Rows picked from a list are highlighted with `SELECTED_ROW_CLASS` from
  `gtfs-zone-web-common/ui/selectable-row`, not marked with a per-row checkbox.
- Disable, don't hide, conditional action buttons. A control that cannot act
  right now is still rendered, `disabled`, with a `title` saying why.

## Consumer wiring: tsconfig, vite, Tailwind and the shell stylesheet

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

## Releasing

`cz bump` on `main` (a pre-bump hook refuses any other branch). It writes the
version into `package.json` and `.cz.toml`, updates `CHANGELOG.md` and cuts the
annotated `vX.Y.Z` tag.

**Push the commit and the tag.** Consumers pin by tag from GitHub, so a tag
left unpushed breaks `pnpm install` for every app that repins:

```bash
git push origin main --follow-tags
```

Then repin each consumer, and restart any dev server the repinned app has
running. The alias resolves through a pnpm symlink into the store, a repin
swaps that symlink, and vite does not watch `node_modules`: cached transforms
keep importing the old store path, so the browser loads two copies of a shared
module, each with its own module-level state. `util/module-state.ts` logs
`loaded twice` when that happens; the restart is still the fix.

## Related Repos

| Repo | Description | URL |
|---|---|---|
| gtfs-zone-editor | edit.gtfs.zone, the GTFS editor | https://github.com/gtfs-zone/gtfs-zone-editor |
| gtfs-zone-rt-viewer | viz.rt.gtfs.zone, the realtime visualiser | https://github.com/gtfs-zone/gtfs-zone-rt-viewer |
| gtfs-zone-rt-manager | manage.rt.gtfs.zone, the feed manager | https://github.com/gtfs-zone/gtfs-zone-rt-manager |
| gtfs-zone-feed-list | list.gtfs.zone, the feed catalog | https://github.com/gtfs-zone/gtfs-zone-feed-list |
| gtfs-zone-rt-api | GTFS-RT API and manager backend | https://github.com/gtfs-zone/gtfs-zone-rt-api |
| gtfs-zone-infra | ArgoCD manifests for the whole stack | https://github.com/gtfs-zone/gtfs-zone-infra |
