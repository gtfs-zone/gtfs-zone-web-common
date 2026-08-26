# interlocking

Shared browser-side utilities for gtfs.zone apps, consumed as a plain pnpm
git dependency: `pnpm add "interlocking@git+https://git.kcfam.us/gtfs.zone/interlocking.git#v0.0.1"`.

Ships raw `.ts` source, no build step. Modules previously hand-copied
(vendored) across `test-track`, `coloring-book` and `yard-master` move here
once they're identical across all consumers.
