/**
 * Padding for a map fit that keeps the result clear of the `#map-controls`
 * overlay (the search bar and the buttons beside it) along the top edge.
 *
 * The overlay is measured on every call because it wraps on narrow screens, so
 * its height changes with the viewport.
 */

import type { Map as MapLibreMap, PaddingOptions } from 'maplibre-gl';

/** How far `#map-controls` reaches down into the map container, or 0. */
function overlayHeight(map: MapLibreMap): number {
  const controls = document.getElementById('map-controls');
  if (!controls) {
    return 0;
  }
  const overlap =
    controls.getBoundingClientRect().bottom -
    map.getContainer().getBoundingClientRect().top;
  return Math.max(0, overlap);
}

export function fitPadding(
  map: MapLibreMap,
  base: number,
  bottom = 0
): PaddingOptions {
  return {
    top: base + overlayHeight(map),
    bottom: base + bottom,
    left: base,
    right: base,
  };
}
