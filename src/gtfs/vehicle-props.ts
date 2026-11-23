/**
 * The props a vehicle position reports about itself: position, bearing,
 * speed, status, occupancy and timestamp. Returned as `prop()` rows so pages
 * add their own rows around them.
 */

import type { VehiclePosition } from './rt-types';
import {
  OCCUPANCY_LABELS,
  VEHICLE_STATUS_LABELS,
  escHtml,
  prop,
  timestampWithAge,
} from './entity-render';
import { formatSpeed } from '../i18n/fmt';
import { t } from '../i18n/messages';

export interface VehiclePropsOptions {
  /** Show an omitted field as "not reported" instead of leaving it out. */
  showMissing?: boolean;
  /** Replaces the plain coordinates, for example with a map link. */
  positionHtml?: string;
  /** Leave out the status row, when the page shows it elsewhere. */
  omitStatus?: boolean;
}

export function vehicleProps(
  vehicle: VehiclePosition,
  options: VehiclePropsOptions = {}
): string[] {
  const missing = `<span class="opacity-40">${escHtml(t('vehicleProps.notReported'))}</span>`;
  const row = (label: string, value: string | undefined): string =>
    value !== undefined
      ? prop(label, value)
      : options.showMissing
        ? prop(label, missing)
        : '';
  const label = (labels: Record<number, string>, value: number | undefined) =>
    value === undefined ? undefined : escHtml(labels[value] ?? String(value));

  return [
    prop(
      t('vehicleProps.position'),
      options.positionHtml ??
        escHtml(`${vehicle.lat.toFixed(5)}, ${vehicle.lon.toFixed(5)}`)
    ),
    row(
      t('vehicleProps.bearing'),
      vehicle.bearing === undefined
        ? undefined
        : `${escHtml(vehicle.bearing.toFixed(0))}°`
    ),
    row(
      t('vehicleProps.speed'),
      vehicle.speed === undefined
        ? undefined
        : escHtml(formatSpeed(vehicle.speed))
    ),
    options.omitStatus
      ? ''
      : row(
          t('vehicleProps.status'),
          label(VEHICLE_STATUS_LABELS, vehicle.currentStatus)
        ),
    row(
      t('vehicleProps.occupancy'),
      label(OCCUPANCY_LABELS, vehicle.occupancyStatus)
    ),
    vehicle.timestamp === undefined && !options.showMissing
      ? ''
      : prop(t('vehicleProps.timestamp'), timestampWithAge(vehicle.timestamp)),
  ];
}
