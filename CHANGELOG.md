## v7.14.1 (2026-11-25)

### Fix

- **focus**: drop a pending link focus on user navigation

## v7.14.0 (2026-11-25)

### Feat

- **map**: add onMapClick with a click-away callback

## v7.13.0 (2026-11-25)

### Feat

- **route,stop**: render the route and stop pages as tree pages
- **scheduled**: read a route's trips on a service day

## v7.12.0 (2026-11-25)

### Feat

- **trip**: link vehicles, trip updates and departures to the trip page
- **trip**: add the trip page and its service lines

## v7.11.4 (2026-11-25)

### Fix

- **sidebar-modal**: scroll the sidebar and pane independently

## v7.11.3 (2026-11-25)

### Fix

- **map**: render route label images from the missing image resolver

## v7.11.2 (2026-11-24)

### Fix

- **panel**: restore the panel scroll after list boxes mount

## v7.11.1 (2026-11-24)

### Perf

- **gtfs**: cache feed-zone formatters and memoize serviceDayStart

## v7.11.0 (2026-11-24)

### Feat

- **store**: count source lines per row when the stream is asked to

## v7.10.1 (2026-11-24)

### Perf

- **rt**: build the panel's RtIndex lazily and only when its inputs change

## v7.10.0 (2026-11-23)

### Feat

- **rt**: Schedule, Feed info and Agency tree pages
- **rt**: realtime node pages, shared vehicle page and alert page on TreePage

## v7.9.0 (2026-11-23)

### Feat

- **rt**: shared endpoint status, prediction table and vehicle props
- **rt**: move the realtime poller, routed help, shortcut and navbar lists here

## v7.8.0 (2026-11-22)

### Feat

- **rt-panel**: render TreePages through a shared TreePageMounter
- **list-box**: keep search, rows and scroll across a page re-render
- **breadcrumbs**: realtime tree chain, node crumbs and validation
- **tree-location**: TreeLocation union, TREE_PAGE_SPECS and trip key helpers
- **page-state**: untypedPages and migrate schema options

## v7.7.0 (2026-11-22)

### Feat

- **breadcrumbs**: treeCrumbs over a label source, Agency step always
- **tree-page**: page scaffold over PanelHost that mounts list boxes
- **list-box**: scrollbox or lazy list with search, from an array or pages
- **panel-host**: afterRender hook for mounting into the rendered page

### Refactor

- **entity-row**: take only the hash builder as link context

## v7.6.0 (2026-11-22)

### Feat

- **load-modal**: add a Realtime only toggle and role icons

## v7.5.1 (2026-11-22)

### Fix

- **gtfs**: match trip schedule_relationship codes to the spec

## v7.5.0 (2026-11-22)

### Feat

- **about**: link diff.gtfs.zone from the project section

## v7.4.0 (2026-11-22)

### Feat

- **feed-catalog**: agencyCount and overlaps from search.json and feeds.json

## v7.3.0 (2026-11-22)

### Feat

- **store**: pattern-level read API for stop_times
- **zip-index**: read a zip's central directory without inflating
- **spec**: GTFS spec layer with one primary key list

## v7.2.0 (2026-11-21)

### Feat

- **ui**: renderScrollbox for pages with several capped lists

## v7.1.0 (2026-11-21)

### Feat

- **ui**: rows-only scrolling through scroll-host and scroll-rows

## v7.0.1 (2026-11-21)

### Fix

- **ui**: lazy list skips horizontal-only scroll wrappers when picking its root

## v7.0.0 (2026-11-21)

### BREAKING CHANGE

- IssueRow.items is { count, page(start, end) } and moreCount is gone. attachIssueCard mounts each row's list when it is opened. The data-issue-show-all button and the issue.showAll string are removed.

### Feat

- **ui**: issue card reads row items a page at a time into a lazy list
- **ui**: lazy list that appends pages on scroll, with a debounced search input

## v6.4.0 (2026-11-21)

### Feat

- **map**: vehicles in a white and a dark ring, shrunk where they crowd

## v6.3.0 (2026-11-17)

### Feat

- **search**: match feeds by place tags

## v6.2.0 (2026-11-16)

### Feat

- **feed**: fetch trip rows without stop_times on request

### Perf

- **store**: index scheduled vehicle runs from per-trip span arrays
- **map**: draw routes and stops from vector tiles cut in the store worker

## v6.1.0 (2026-11-16)

### Feat

- **store**: parse only the listed tables, keep other .txt entries as files

## v6.0.0 (2026-11-14)

### BREAKING CHANGE

- SearchController's getEntries and limit options are replaced
by getGroups, groupLimit and remoteLimit; scheduleSearchEntries is replaced by
scheduleSearchGroups.

### Feat

- **search**: group map search results into capped sections

## v5.30.0 (2026-11-14)

### Feat

- **map**: draw scheduled vehicles as hollow markers

## v5.29.0 (2026-11-14)

### Feat

- **feed**: place scheduled vehicles along the trip's shape
- **feed**: simulate scheduled vehicle positions in the store worker

## v5.28.0 (2026-11-14)

### Feat

- **load-modal**: app-provided sections listed above Your feeds

## v5.27.0 (2026-11-14)

### Feat

- **feed**: parse cache in OPFS, optional realtime in the load modal

## v5.26.0 (2026-11-14)

### Feat

- **load-modal**: list stored feeds, load catalog rows in one click

## v5.25.1 (2026-11-14)

### Fix

- **feed-selection**: default the CORS proxy to cors.gtfs.zone

## v5.25.0 (2026-11-14)

### Feat

- **store**: list edited trips and shapes

## v5.24.1 (2026-11-13)

### Fix

- **store**: mirror changes to tables created after the load
- **store**: report a full OPFS quota as QuotaExceededError

## v5.24.0 (2026-11-13)

### Feat

- **store**: keep non-table archive entries and mirror all tables but a list

## v5.23.0 (2026-11-13)

### Feat

- **store**: extensible store worker, key lookup and fold
- **store**: save and restore a feed base as one OPFS file

## v5.22.0 (2026-11-13)

### Feat

- **store**: columnar feed store in a worker, GTFSScheduled on top

## v5.21.0 (2026-11-12)

### Feat

- **calendar**: per-day state and extra legend entries
- **map**: label routes with a vehicle or in the spotlight

## v5.20.0 (2026-11-09)

### Feat

- **i18n**: add German

## v5.19.0 (2026-11-08)

### Feat

- **ui**: let the app drive the guide's open page

## v5.18.0 (2026-11-08)

### Feat

- **ui**: let the app drive the sidebar modal's active entry

## v5.17.0 (2026-11-08)

### Feat

- **ui**: close routed modals via history.back() and drop the in-memory history

## v5.16.0 (2026-11-05)

### Feat

- **gtfs**: read route type labels and paint ranks from gtfs-zone-vocab

## v5.15.0 (2026-10-28)

### Feat

- **ui**: add a GitHub link navbar action

### Fix

- **deps**: upgrade packages with published security advisories

## v5.14.0 (2026-10-18)

### Feat

- **gtfs**: draw a return lane on routes that loop back to their first stop

## v5.13.0 (2026-10-18)

### Feat

- **gtfs**: say never seen up for a down feed no check has seen up

## v5.12.1 (2026-10-17)

### Fix

- **load**: credit gtfs.zone instead of the bare rt.gtfs.zone host

## v5.12.0 (2026-10-17)

### Feat

- **load**: show a large feed's size in red and label the picked row selected
- **route-colors**: treat a route_color shared by every route as no color

### Fix

- **search**: truncate a long secondary so the name stays visible

## v5.11.1 (2026-10-04)

### Fix

- **notifications**: show notifications above modals
- **i18n**: match a regional locale cookie by its language

## v5.11.0 (2026-10-03)

### Feat

- **map**: add shared RtMapController for the realtime maps

### Fix

- **scripts**: count abstract classes in check:exports

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
