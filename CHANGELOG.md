## v3.5.0 (2026-09-27)

### Feat

- **ui**: search appends remote entries under a Places heading
- **ui**: tooltips wait 150ms on hover before showing
- **map**: fitPadding keeps fits clear of the map controls overlay
- **ui**: calendar input marks today with a dot and jumps to the feed's edges
- **ui**: issue rows carry several actions, a key and a show all button

### Fix

- **map**: cap basemap sources at their last real tile and export MAP_MAX_ZOOM

## v3.4.0 (2026-09-27)

### Feat

- **ui**: tint a highlight range as a band in the calendar input

## v3.3.2 (2026-09-27)

### Fix

- **ui**: style the guide's continue button as primary

## v3.3.1 (2026-09-27)

### Fix

- **shell**: render the brand as text instead of an h1

## v3.3.0 (2026-09-26)

### Feat

- **ui**: share the selected-row class and use toggles in the load modal

## v3.2.0 (2026-09-25)

### Feat

- **gtfs**: resolve stop time events against the schedule and render them as shared prediction cells

## v3.1.1 (2026-09-24)

### Fix

- **ui**: stack the sidebar-modal menu above the pane below md

## v3.1.0 (2026-09-24)

### Feat

- **ui**: hoist the app shell from test-track
- **load-modal**: list logical feeds from feeds.json

## v3.0.0 (2026-09-23)

### BREAKING CHANGE

- EXAMPLES and scripts/generate-atlas-data.ts are removed. Use knownExamples() and drop the atlas script and public/atlas-feeds.json.

### Feat

- load examples and the feed catalog from data.gtfs.zone

## v2.4.0 (2026-09-21)

### Feat

- share the route coverage notes and stacked direction sections

## v2.3.1 (2026-09-20)

### Fix

- keep notifications working when the container is gone

## v2.3.0 (2026-09-20)

### Feat

- add a shared color input with its own palette popover

## v2.2.1 (2026-09-20)

### Fix

- hold shared module state on globalThis

## v2.2.0 (2026-09-19)

### Feat

- add gtfs/rt-index, gtfs/alerts and gtfs/entity-render
- add gtfs/rt-types and the gtfs/feed-session interface

## v2.1.0 (2026-09-19)

### Feat

- add ui/load-modal and gtfs/spec-markup
- add the near-identical wave A modules

## v2.0.0 (2026-09-17)

### BREAKING CHANGE

- every import path changes. `interlocking/modules/*`,
`interlocking/utils/*` and `interlocking/types/*` are gone.

### Refactor

- reorganise src into ui/ gtfs/ map/ util/

## v1.1.0 (2026-09-17)

### Feat

- **scripts**: ship generate-atlas-data

## v1.0.1 (2026-09-17)

### Fix

- redraw the guide '?' nav icon at proper proportions

## v1.0.0 (2026-09-16)

## v0.2.0 (2026-09-16)

### Feat

- add the remaining 34 files of the first cut

## v0.1.0 (2026-09-16)

### Feat

- add route-colors as the pilot shared module

## v0.0.2 (2026-08-27)

## v0.0.1 (2026-08-27)
