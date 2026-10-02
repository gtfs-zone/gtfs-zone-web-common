## v5.10.0 (2026-10-03)

### Feat

- **ui**: add a language toggle navbar action
- **ui**: extract web-common UI strings into en and fr catalogs
- **i18n**: add typed t(), locale resolution and fmt helpers

### Refactor

- **gtfs**: format display times through the i18n fmt helpers

## v5.9.0 (2026-10-03)

### Feat

- **gtfs**: add shared route, stop and alert pages and entity rows

## v5.8.0 (2026-10-03)

### Feat

- **ui**: add focusStopId to the modal transient

### Refactor

- **ui**: drop the feedData nav icon

## v5.7.0 (2026-10-03)

### Feat

- **ui**: add transfers, translations and attributions nav icons

## v5.6.0 (2026-10-03)

### Feat

- **ui**: add ValidatedFocusController with pending link focus
- **gtfs**: add RtPanel for the realtime apps' right panel
- **gtfs**: add schedule search entries, breadcrumb helpers and vehicleRouteId

## v5.5.0 (2026-10-03)

### Feat

- **gtfs**: add FeedSessionBase owning the schedule load

## v5.4.0 (2026-10-03)

### Feat

- **map**: add layer manager for the realtime map

## v5.3.0 (2026-10-02)

### Feat

- **ui**: add page-state schema building the hash codec and guard

## v5.2.0 (2026-10-02)

### Feat

- **ui**: add shared calendar modal and month grid

## v5.1.0 (2026-10-02)

### Feat

- **ui**: add shared help pages and map key

## v5.0.3 (2026-10-01)

## v5.0.2 (2026-10-01)

### Fix

- drop the Forgejo issue link

## v5.0.1 (2026-10-01)

### Fix

- fall back to the default CORS proxy when VITE_CORS_PROXY is empty

## v5.0.0 (2026-10-01)

### BREAKING CHANGE

- consumers import from gtfs-zone-web-common/... and depend on github:gtfs-zone/gtfs-zone-web-common

### Feat

- rename the package to gtfs-zone-web-common and read the CORS proxy from VITE_CORS_PROXY

## v4.0.0 (2026-09-30)

### BREAKING CHANGE

- consumers need maplibre-gl 6 and lib ES2022, and should subscribe through onBasemapChanged instead of map.on('basemap:changed')

### Feat

- **map**: require maplibre-gl 6 and update dependencies

### Fix

- **ui**: link About source and changelog to GitHub

## v3.7.0 (2026-09-30)

### Feat

- **gtfs**: shared feed catalog, state badges, role chips, search and place search

## v3.6.0 (2026-09-29)

### Feat

- **ui**: credit the feed catalogs and their licenses

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
