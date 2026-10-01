# AGENTS.md

Shared browser-side library for the gtfs.zone frontends (editor, rt-viewer,
rt-manager, feed-list). It ships raw TypeScript under `src/` with no build step
and is consumed as a git dependency pinned by tag; it has no deployment.

## Commands

```bash
pnpm run check          # typecheck + lint + check:exports
pnpm run check:exports  # flag exports no consumer imports
```

## Architecture

Four peers by domain, not the apps' `modules/utils/types` split: `src/ui/`
(chrome with no GTFS), `src/gtfs/` (the transit domain, including its
rendering), `src/map/` (everything importing maplibre-gl), `src/util/` (pure).
The public surface, the app shell and the four edits a consumer needs are in
[README.md](README.md).

- **No barrel `index.ts` files.** Every module is its own entry point
  (`gtfs-zone-web-common/ui/navbar-actions`). Barrels would defeat
  `check:exports`, which stands in for knip here.
- **A module arrives by moving out of an app, not by being copied.** Once here
  it is edited here, never in parallel in a consumer.
- **Nothing app-specific belongs here.** If it only makes sense for one app, it
  stays in that app.
- **Peer dependencies stay peers.** A second copy of maplibre is a broken map.
  `gtfs-realtime-bindings` is an optional peer imported as a type only, so
  nothing here pulls protobufjs into a bundle.
- The feed catalog is not source here: `gtfs/feed-catalog.ts` fetches it from
  `https://data.gtfs.zone`, published by feed-catalog.

## UI conventions

These apply here and in every consumer:

- No `cursor-help` (the question-mark pointer), on tooltip triggers or anywhere.
- An on/off setting is a daisyUI `toggle`, never a `checkbox`. The hidden
  inputs behind `swap` icon buttons are the only checkboxes.
- Rows picked from a list are highlighted with `SELECTED_ROW_CLASS` from
  `gtfs-zone-web-common/ui/selectable-row`, not a per-row checkbox.
- Disable, don't hide, conditional action buttons: render the control
  `disabled`, with a `title` saying why.

## Conventions

- **Commits**: Conventional Commits, enforced by the `commit-msg` hook. Setup and
  release are in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Releasing**: push the tag as well as the commit (`--follow-tags`).
  Consumers pin by tag from GitHub, so an unpushed tag breaks `pnpm install`
  for every app that repins. A repinned app's dev server needs a restart.
- **Plans**: write plans to `CURRENT_PLAN.md` at the repo root as a
  checklist (`- [ ]`), ticked off as work lands. It is neither tracked nor
  gitignored: never stage or commit it.
