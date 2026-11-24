/**
 * One map-level click handler with a "click away": a click that hits a
 * feature of the given layers goes to `onFeature`, one that hits nothing goes
 * to `onEmpty`. The pointer cursor follows the same hit test on hover.
 *
 * MapLibre already drops the click that ends a drag (past its
 * `clickTolerance`) and never sees clicks on map controls, which sit outside
 * the canvas container. Clicks on DOM inside it (markers, popups) are ignored
 * here: only a click whose target is the canvas counts.
 */

import type {
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
  PointLike,
} from 'maplibre-gl';

interface MapClickOptions {
  /** Layers to hit-test. Layers not on the map (yet) are skipped. */
  layers: readonly string[];
  /** Half-width of the square hit box around the pointer, in px. 0 tests the point. */
  radiusPx?: number;
  /** The hit features, topmost rendered first. Never empty. */
  onFeature: (features: MapGeoJSONFeature[], e: MapMouseEvent) => void;
  onEmpty: (e: MapMouseEvent) => void;
}

/** Features of `layers` under `point`, topmost rendered first. */
function hitTest(
  map: MapLibreMap,
  point: { x: number; y: number },
  layers: readonly string[],
  radiusPx = 0
): MapGeoJSONFeature[] {
  const present = layers.filter((id) => map.getLayer(id));
  if (present.length === 0) {
    return [];
  }
  const geometry: PointLike | [PointLike, PointLike] =
    radiusPx > 0
      ? [
          [point.x - radiusPx, point.y - radiusPx],
          [point.x + radiusPx, point.y + radiusPx],
        ]
      : [point.x, point.y];
  return map.queryRenderedFeatures(geometry, { layers: present });
}

/** Wire click and hover; the returned function removes both listeners. */
export function onMapClick(
  map: MapLibreMap,
  options: MapClickOptions
): () => void {
  const { layers, radiusPx = 0, onFeature, onEmpty } = options;
  const canvas = map.getCanvas();

  const click = (e: MapMouseEvent): void => {
    if (e.originalEvent.target !== canvas) {
      return;
    }
    const found = hitTest(map, e.point, layers, radiusPx);
    if (found.length > 0) {
      onFeature(found, e);
    } else {
      onEmpty(e);
    }
  };
  const move = (e: MapMouseEvent): void => {
    canvas.style.cursor =
      hitTest(map, e.point, layers, radiusPx).length > 0 ? 'pointer' : '';
  };

  map.on('click', click);
  map.on('mousemove', move);
  return () => {
    map.off('click', click);
    map.off('mousemove', move);
  };
}
