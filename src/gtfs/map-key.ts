/**
 * Building blocks for a help page's map key: SVG swatches, one labelled row
 * per symbol, and the two-column layout with the shared Stops column.
 */

/** A circle symbol; `dot` adds the station's black inner dot. */
export function mapKeyCircle(
  fill: string,
  stroke: string,
  dot?: boolean
): string {
  const inner = dot ? `<circle cx="7" cy="7" r="2.5" fill="#000000"/>` : '';
  return `<svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink:0"><circle cx="7" cy="7" r="5" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${inner}</svg>`;
}

/** A line symbol, dashed when `dash` is given (in line widths, as on the map). */
export function mapKeyLine(
  color: string,
  dash: number[] | null = null
): string {
  // The swatch stroke is 3px wide.
  const dashAttr = dash
    ? ` stroke-dasharray="${dash.map((d) => d * 3).join(' ')}"`
    : ' stroke-linecap="round"';
  return `<svg width="20" height="14" viewBox="0 0 20 14" style="flex-shrink:0"><line x1="2" y1="7" x2="18" y2="7" stroke="${color}" stroke-width="3"${dashAttr}/></svg>`;
}

/** One key entry: a swatch and its label. */
export function mapKeyRow(swatch: string, label: string): string {
  return `<div class="flex items-center gap-2">${swatch}<span>${label}</span></div>`;
}

/**
 * The stop symbols by location_type, matching `stopFillColor` in
 * `map/stop-layer-style.ts`. `unlocatedLabel` names the grey-ringed stop,
 * which each app describes in its own terms.
 */
function stopRows(unlocatedLabel: string): string {
  return [
    mapKeyRow(mapKeyCircle('#ffffff', '#000000'), 'Stop'),
    mapKeyRow(mapKeyCircle('#ffffff', '#000000', true), 'Station'),
    mapKeyRow(mapKeyCircle('#f59e0b', '#000000'), 'Entrance'),
    mapKeyRow(mapKeyCircle('#8b5cf6', '#000000'), 'Generic node'),
    mapKeyRow(mapKeyCircle('#10b981', '#000000'), 'Boarding area'),
    mapKeyRow(mapKeyCircle('#ffffff', '#9ca3af'), unlocatedLabel),
  ].join('');
}

/** The key: Stops on the left, the app's own `title` and `rows` on the right. */
export function renderMapKey(options: {
  unlocatedLabel: string;
  title: string;
  rows: string;
}): string {
  return `
      <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div class="col-span-2 grid grid-cols-2 gap-x-6">
          <div class="font-semibold text-xs opacity-60 mb-1">Stops</div>
          <div class="font-semibold text-xs opacity-60 mb-1">${options.title}</div>
        </div>
        <div class="flex flex-col gap-1">${stopRows(options.unlocatedLabel)}</div>
        <div class="flex flex-col gap-1">${options.rows}</div>
      </div>
    `;
}
