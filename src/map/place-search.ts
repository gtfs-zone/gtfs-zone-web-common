/**
 * Place and POI search through Photon (komoot's OSM geocoder: no key, CORS
 * allowed), biased towards the map centre. Feeds
 * `SearchController.getRemoteEntries`; `SearchPlaceMarker` rings the pick.
 */

import {
  LngLatBounds,
  type Map as MapLibreMap,
  type PaddingOptions,
} from 'maplibre-gl';
import { neutralMarker, type SearchEntry } from '../ui/search-controller';
import { resolveThemeColor } from '../util/theme-color';

const PHOTON_URL = 'https://photon.komoot.io/api/';
const LIMIT = 5;

const PLACE_SOURCE = 'search-place';
const PLACE_RING_LAYER = 'search-place-ring';
const PLACE_EXTENT_LAYER = 'search-place-extent';
const PLACE_MAX_ZOOM = 17;

export interface PlacePayload {
  kind: 'place';
  lon: number;
  lat: number;
  /** [west, south, east, north], when Photon has one (cities, areas). */
  extent?: [number, number, number, number];
  name: string;
}

/** The ring's point and the extent's outline, as GeoJSON. */
interface PlaceFeature {
  type: 'Feature';
  properties: Record<string, never>;
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: Array<[number, number]> };
}

interface PhotonFeature {
  geometry: { type: string; coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    osm_value?: string;
    city?: string;
    country?: string;
    /** Photon order: [west, north, east, south]. */
    extent?: [number, number, number, number];
  };
}

function placeName(p: PhotonFeature['properties']): string {
  if (p.name) {
    return p.name;
  }
  return [p.street, p.housenumber].filter(Boolean).join(' ');
}

export async function searchPlaces(
  query: string,
  center: { lng: number; lat: number } | null,
  signal: AbortSignal
): Promise<SearchEntry<PlacePayload>[]> {
  const params = new URLSearchParams({ q: query, limit: String(LIMIT) });
  if (center) {
    params.set('lat', center.lat.toFixed(5));
    params.set('lon', center.lng.toFixed(5));
  }
  console.log(`[PlaceSearch] Querying "${query}"`);
  const response = await fetch(`${PHOTON_URL}?${params}`, { signal });
  if (!response.ok) {
    throw new Error(`Photon responded ${response.status}`);
  }
  const data = (await response.json()) as { features?: PhotonFeature[] };

  const entries: SearchEntry<PlacePayload>[] = [];
  for (const feature of data.features ?? []) {
    if (feature.geometry?.type !== 'Point') {
      continue;
    }
    const p = feature.properties;
    const name = placeName(p);
    if (!name) {
      continue;
    }
    const [lon, lat] = feature.geometry.coordinates;
    const kind = p.osm_value?.replace(/_/g, ' ');
    const where = [p.city !== name ? p.city : undefined, p.country]
      .filter(Boolean)
      .join(', ');
    entries.push({
      payload: {
        kind: 'place',
        lon,
        lat,
        extent: p.extent
          ? [p.extent[0], p.extent[3], p.extent[2], p.extent[1]]
          : undefined,
        name,
      },
      icon: neutralMarker(),
      primary: name,
      secondary: [kind, where].filter(Boolean).join(', ') || undefined,
      haystack: name,
    });
  }
  console.log(`[PlaceSearch] "${query}": ${entries.length} results`);
  return entries;
}

/**
 * The picked place on the map: a ring on its point and a dashed box on its
 * extent, drawn above every other layer. A basemap change drops both, so the
 * caller runs `redraw()` after one.
 */
export class SearchPlaceMarker {
  private place: PlacePayload | null = null;

  constructor(private map: MapLibreMap) {}

  /**
   * Ring the place and move there. A direct camera move: the user asked to go
   * there, so any auto-zoom preference does not apply.
   */
  focus(place: PlacePayload, padding: PaddingOptions): void {
    console.log(
      `[SearchPlaceMarker] Focusing "${place.name}" at ${place.lon},${place.lat}`
    );
    this.place = place;
    this.redraw();
    if (place.extent) {
      const [west, south, east, north] = place.extent;
      this.map.fitBounds(new LngLatBounds([west, south], [east, north]), {
        padding,
        maxZoom: PLACE_MAX_ZOOM,
      });
    } else {
      this.map.flyTo({
        center: [place.lon, place.lat],
        zoom: PLACE_MAX_ZOOM,
        padding,
        essential: true,
      });
    }
  }

  clear(): void {
    if (!this.place) {
      return;
    }
    console.log('[SearchPlaceMarker] Clearing');
    this.place = null;
    this.removeLayers();
  }

  /** (Re)draw the place on top of every other layer. */
  redraw(): void {
    this.removeLayers();
    const place = this.place;
    if (!place) {
      return;
    }
    const features: PlaceFeature[] = [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
      },
    ];
    if (place.extent) {
      const [west, south, east, north] = place.extent;
      features.push({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        },
      });
    }
    const accent = resolveThemeColor('--color-primary', '#3b82f6');
    this.map.addSource(PLACE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });
    this.map.addLayer({
      id: PLACE_EXTENT_LAYER,
      type: 'line',
      source: PLACE_SOURCE,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': accent,
        'line-width': 2,
        'line-dasharray': [2, 2],
      },
    });
    this.map.addLayer({
      id: PLACE_RING_LAYER,
      type: 'circle',
      source: PLACE_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 12,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': accent,
        'circle-stroke-width': 3,
      },
    });
  }

  private removeLayers(): void {
    for (const layerId of [PLACE_RING_LAYER, PLACE_EXTENT_LAYER]) {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    }
    if (this.map.getSource(PLACE_SOURCE)) {
      this.map.removeSource(PLACE_SOURCE);
    }
  }
}
