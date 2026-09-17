# interlocking

Shared browser-side modules for the gtfs.zone apps: **coloring-book**
(edit.gtfs.zone), **test-track** (viz.rt.gtfs.zone) and **yard-master**
(manage.rt.gtfs.zone).

Ships raw `.ts` source under `src/`. There is no build step: each app's vite
compiles it as source. Consumed as a pinned git dependency:

```
pnpm add "interlocking@git+https://git.kcfam.us/gtfs.zone/interlocking.git#vX.Y.Z"
```

`maplibre-gl` and `@leeoniya/ufuzzy` are peer dependencies. Every consumer
already carries both, and a second copy of maplibre is a broken map rather than
a duplicate.

## What it is

A browser-side library for GTFS and GTFS-RT frontends: the UI chrome (navbar,
modals, notifications, theme, search), the GTFS domain modules (route ordering,
route diagrams, colors, feed loading) and the MapLibre layer specs. Nothing in
here is specific to one of the three apps; anything that is belongs in the app.

Modules arrive by moving out of an app, not by being copied from it: once a
module lives here it is edited here.

`CURRENT_PLAN.md` holds the roadmap, including what is still hand-copied
between the apps and the layout this package is moving to.

There is no lint or typecheck gate here yet, so a dead export goes unnoticed
until a consumer's build trips on it.

## Layout

Mirrors the apps, so a moved file keeps its relative imports:

```
src/modules/   src/utils/   src/types/
```

## Releasing

`cz bump` on `main`, which writes the version into `package.json`, updates
`CHANGELOG.md` and cuts the annotated `vX.Y.Z` tag. Push the commit and the tag,
then repin each consumer. A shared change is one commit here, one tag, and three
consumer bumps.
