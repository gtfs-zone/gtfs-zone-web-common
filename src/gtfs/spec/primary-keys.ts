/**
 * Row keys per table, derived from each file's `primaryKey` in the spec.
 */

import { gtfsSpec } from './gtfs-spec';
import type { GTFSFileSpec } from './types';

export interface GTFSTablePrimaryKey {
  /** Filename without its extension, e.g. `stop_times`. */
  tableName: string;
  /** The key fields; empty for `all_fields` and `none`. */
  fields: string[];
  /** One field, several fields, every provided field, or a single-row file. */
  type: 'natural' | 'composite' | 'all_fields' | 'none';
  /** The table allows only one row (feed_info.txt, locations.geojson). */
  singleRow?: boolean;
}

function tableKey(file: GTFSFileSpec): GTFSTablePrimaryKey {
  const tableName = file.filename.replace(/\.(txt|geojson)$/, '');
  const key = file.primaryKey;
  // A GeoJSON file is stored as one row holding the whole FeatureCollection.
  if (key === 'none' || (key === undefined && file.format === 'geojson')) {
    return { tableName, fields: [], type: 'none', singleRow: true };
  }
  if (key === '*' || key === undefined || key.length === 0) {
    return { tableName, fields: [], type: 'all_fields' };
  }
  if (key.length > 1) {
    return { tableName, fields: [...key], type: 'composite' };
  }
  // A single Optional key field (attributions.attribution_id) is left out by
  // real feeds, so only all fields stay unique for those rows.
  const field = file.fields?.find((f) => f.name === key[0]);
  if (field?.presence === 'Optional') {
    return { tableName, fields: [], type: 'all_fields' };
  }
  return { tableName, fields: [...key], type: 'natural' };
}

/** Every table's key, base spec and Google overlay, in spec order. */
export const GTFS_PRIMARY_KEYS: GTFSTablePrimaryKey[] =
  gtfsSpec.files.map(tableKey);

const byTable = new Map(GTFS_PRIMARY_KEYS.map((k) => [k.tableName, k]));

/** Key of a table by name without extension (`stops`), or null. */
export function getGTFSPrimaryKey(
  tableName: string
): GTFSTablePrimaryKey | null {
  return byTable.get(tableName) ?? null;
}

/** The single key field of a table keyed on one field, or null. */
export function getNaturalKeyField(tableName: string): string | null {
  const key = byTable.get(tableName);
  return key?.type === 'natural' ? key.fields[0] : null;
}
