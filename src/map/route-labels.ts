/**
 * Route name labels along route lines: a symbol layer on a route source whose
 * features carry `route_id`, drawing one image per route. Images are rendered
 * on demand from `styleimagemissing`, so the basemap needs no glyphs.
 */

import type {
  FilterSpecification,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl';

export const ROUTE_LABELS_LAYER = 'routes-label';

/** Prefix of the image ids; the rest is the route id. */
const LABEL_IMAGE = 'route-label|';

/** Labels fade in over this zoom range. */
const LABEL_ZOOM_MIN = 11;
const LABEL_ZOOM_MAX = 12;
const LABEL_FONT = '600 12px system-ui, sans-serif';
const LABEL_HEIGHT = 18;

export interface RouteLabel {
  text: string;
  color: string;
}

/** The name shown for a route: short name, then long name, then the id. */
export function routeLabelText(route: {
  id: string;
  short_name?: string;
  long_name?: string;
}): string {
  return route.short_name || route.long_name || route.id;
}

/** `text` in `color` with a light halo, as image data at 2x. */
function labelImage(text: string, color: string): ImageData {
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = LABEL_FONT;
  const w = Math.ceil(probe.measureText(text).width) + 8;
  const h = LABEL_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = h * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  return ctx.getImageData(0, 0, w * 2, h * 2);
}

/** The label layer on `source`, showing nothing until a filter is set. */
export function routeLabelLayerSpec(source: string): SymbolLayerSpecification {
  return {
    id: ROUTE_LABELS_LAYER,
    type: 'symbol',
    source,
    minzoom: LABEL_ZOOM_MIN,
    filter: routeLabelFilter([]),
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 400,
      'icon-image': ['concat', LABEL_IMAGE, ['get', 'route_id']],
      'icon-rotation-alignment': 'viewport',
      'icon-allow-overlap': false,
      'icon-padding': 4,
    },
    paint: {
      'icon-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        LABEL_ZOOM_MIN,
        0,
        LABEL_ZOOM_MAX,
        1,
      ],
    },
  };
}

/** Filter that labels only these routes. */
export function routeLabelFilter(routeIds: string[]): FilterSpecification {
  return [
    'in',
    ['get', 'route_id'],
    ['literal', [...new Set(routeIds)]],
  ] as unknown as FilterSpecification;
}

/**
 * Render label images when the map asks for them. `lookup` resolves a route id
 * to its text and color, or null to leave the image missing.
 */
export function installRouteLabelImages(
  map: MapLibreMap,
  lookup: (routeId: string) => RouteLabel | null
): void {
  map.on('styleimagemissing', (e: { id: string }) => {
    if (!e.id.startsWith(LABEL_IMAGE) || map.hasImage(e.id)) {
      return;
    }
    const label = lookup(e.id.slice(LABEL_IMAGE.length));
    if (label) {
      map.addImage(e.id, labelImage(label.text, label.color), {
        pixelRatio: 2,
      });
    }
  });
}

/**
 * Drop the label images of `routeIds`, or of every route, so they render again
 * with their current names and colors.
 */
export function clearRouteLabelImages(
  map: MapLibreMap,
  routeIds?: string[]
): void {
  const ids = routeIds
    ? routeIds.map((id) => `${LABEL_IMAGE}${id}`)
    : map.listImages().filter((id) => id.startsWith(LABEL_IMAGE));
  for (const id of ids) {
    if (map.hasImage(id)) {
      map.removeImage(id);
    }
  }
}
