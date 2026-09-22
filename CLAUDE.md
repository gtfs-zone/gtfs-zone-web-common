# CLAUDE.md

## Project Overview

`interlocking` is the shared browser-side library for the three gtfs.zone
frontends: **coloring-book** (edit.gtfs.zone), **test-track** (viz.rt.gtfs.zone)
and **yard-master** (manage.rt.gtfs.zone). It ships raw TypeScript under `src/`
with no build step; each consumer's vite compiles it as source.

Consumed as a pinned git dependency:

```
pnpm add "interlocking@git+https://git.kcfam.us/gtfs.zone/interlocking.git#vX.Y.Z"
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

The curated examples and the feed catalog are not source here: geometry-car
publishes them to `https://data.gtfs.zone` and the load modal fetches them.
Edit the curated set in geometry-car's `src/geometry_car/data/examples.yaml`.

## Rules

- **No barrel `index.ts` files.** Every module is its own entry point, imported
  as `interlocking/ui/navbar-actions`. A barrel would defeat `check:exports`,
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
- Never include `Co-Authored-By: Claude ...` trailers in commit messages.

## Consumer wiring: the tsconfig + vite + Tailwind triple

Adding this library to an app takes three separate edits, and missing any one
of them fails in a different place:

1. `tsconfig.json` path, so `tsc` resolves the import:
   `"interlocking/*": ["node_modules/interlocking/src/*"]`
2. `vite.config.js` alias, so the bundler resolves the same specifier, plus
   `optimizeDeps.exclude: ['interlocking']` because the package ships raw `.ts`
   and must be transformed as source:
   `interlocking: resolve(__dirname, 'node_modules/interlocking/src')`
3. The Tailwind `@source` line in the app's CSS, so classes used only inside
   this library are not purged:
   `@source "../../node_modules/interlocking/src/**/*.ts";`

## Releasing

`cz bump` on `main` (a pre-bump hook refuses any other branch). It writes the
version into `package.json` and `.cz.toml`, updates `CHANGELOG.md` and cuts the
annotated `vX.Y.Z` tag.

**Push the commit and the tag to both remotes.** `origin` is Forgejo
(`ssh://git@git.kcfam.us:2222/gtfs.zone/interlocking.git`) and `github` is
`git@github.com:gtfs-zone/interlocking.git`. Consumers pin by tag over HTTPS, so
a tag that exists on only one remote breaks `pnpm install` for every app that
repins:

```bash
git push origin main --follow-tags
git push github main --follow-tags
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
| coloring-book | edit.gtfs.zone, the GTFS editor | https://git.kcfam.us/gtfs.zone/coloring-book |
| test-track | viz.rt.gtfs.zone, the realtime visualiser | https://git.kcfam.us/gtfs.zone/test-track |
| yard-master | manage.rt.gtfs.zone, the feed manager | https://git.kcfam.us/gtfs.zone/yard-master |
| cafe-car | GTFS-RT API and manager backend | https://git.kcfam.us/gtfs.zone/cafe-car |
| deploy-gtfs-rt | ArgoCD manifests for the whole stack | https://git.kcfam.us/gtfs.zone/deploy-gtfs-rt |
