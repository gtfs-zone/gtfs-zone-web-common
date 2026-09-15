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

## Status

**Empty, and being refilled.** An earlier attempt copied 18 modules here and
went stale; it was deleted in full on 2026-09-15 rather than repaired, because
every banner pinned a pre-rebase SHA that is no longer an ancestor of any
consumer's `main`.

The migration plan is `../coloring-book/CURRENT_PLAN.md`. Modules arrive by
moving out of coloring-book, not by being copied from it: once a module lives
here it is edited here, and the old one-way
coloring-book -> test-track -> yard-master vendoring flow no longer applies to
it.

## Layout

Mirrors the apps, so a moved file keeps its relative imports:

```
src/modules/   src/utils/   src/types/
```

## Releasing

Tag `vX.Y.Z`, then repin each consumer. A shared change is one commit here, one
tag, and three consumer bumps.
