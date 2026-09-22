import { moduleState } from '../util/module-state';
import { DATA_ORIGIN } from './data-origin';
import type { FeedSelection } from './feed-selection';

/** geometry-car's last reachability answer for one half of a source. */
export type SourceState = 'up' | 'down' | 'unknown';

export interface ExampleFeed {
  slug: string;
  name: string;
  description?: string;
  selection: FeedSelection;
  /** Absent on the compiled-in fallback, which nothing has checked. */
  state?: { scheduled: SourceState; realtime: SourceState };
}

/**
 * The curated set lives in geometry-car (`src/geometry_car/data/examples.yaml`),
 * which checks it daily and publishes it as `examples.json`. The rules for
 * editing it, and the per-host rot notes, are in that file's header.
 *
 * This fallback is only what the load modal shows until that fetch lands, or
 * when it fails, so the list is never empty: our own two feeds plus one agency
 * that has been stable. Feeds served by our stack use path-only realtime URLs,
 * resolved against each app's RT base (`feed-url-resolve.ts`). rt.gtfs.zone,
 * cdn.mbta.com and content.amtrak.com send no CORS headers, so they proxy;
 * raw.githubusercontent.com does, so it does not.
 */
export const FALLBACK_EXAMPLES: readonly ExampleFeed[] = [
  {
    slug: 'amtrak',
    name: 'Amtrak',
    description:
      'National rail - schedule from Amtrak, realtime via rt.gtfs.zone',
    selection: {
      scheduled: {
        kind: 'url',
        url: 'https://content.amtrak.com/content/gtfs/GTFS.zip',
        useCors: true,
        label: 'Amtrak',
      },
      realtime: {
        vehiclesUrl: '/amtrak/vehicle_positions.pb',
        tripUpdatesUrl: '/amtrak/trip_updates.pb',
        alertsUrl: '/amtrak/service_alerts.pb',
        useCors: true,
        label: 'Amtrak RT',
      },
    },
  },
  {
    slug: 'columbia-county',
    name: 'Columbia County',
    description:
      'Columbia County Public Transportation, NY - realtime via rt.gtfs.zone',
    selection: {
      scheduled: {
        kind: 'url',
        url: 'https://raw.githubusercontent.com/columbia-county-ny-transit/gtfs-generator/refs/heads/main/columbia_county_gtfs.zip',
        useCors: false,
        label: 'Columbia County',
      },
      realtime: {
        vehiclesUrl: '/columbia-county/vehicle_positions.pb',
        tripUpdatesUrl: '/columbia-county/trip_updates.pb',
        alertsUrl: '/columbia-county/service_alerts.pb',
        useCors: true,
        label: 'Columbia County RT',
      },
    },
  },
  {
    slug: 'mbta',
    name: 'MBTA',
    description:
      'Boston - three separate realtime .pb files straight from the agency',
    selection: {
      scheduled: {
        kind: 'url',
        url: 'https://cdn.mbta.com/MBTA_GTFS.zip',
        useCors: true,
        label: 'MBTA',
      },
      realtime: {
        vehiclesUrl: 'https://cdn.mbta.com/realtime/VehiclePositions.pb',
        tripUpdatesUrl: 'https://cdn.mbta.com/realtime/TripUpdates.pb',
        alertsUrl: 'https://cdn.mbta.com/realtime/Alerts.pb',
        useCors: true,
        label: 'MBTA RT',
      },
    },
  },
];

const shared = moduleState('gtfs/examples', () => ({
  cached: null as Promise<ExampleFeed[]> | null,
  loaded: null as ExampleFeed[] | null,
}));

/** The published curated set. Rejects when it cannot be fetched. */
export function loadExamples(): Promise<ExampleFeed[]> {
  shared.cached ??= fetch(`${DATA_ORIGIN}/examples.json`)
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      }
      const doc = (await res.json()) as { examples?: ExampleFeed[] };
      if (!doc.examples?.length) {
        throw new Error('examples.json lists no examples');
      }
      shared.loaded = doc.examples;
      return doc.examples;
    })
    .catch((err) => {
      // Not cached on failure, so reopening the modal retries rather than
      // falling back for the rest of the session.
      shared.cached = null;
      throw err;
    });
  return shared.cached;
}

/**
 * The best set to hand for a synchronous lookup: the published one once it has
 * loaded, the fallback before that.
 */
export function knownExamples(): readonly ExampleFeed[] {
  return shared.loaded ?? FALLBACK_EXAMPLES;
}
