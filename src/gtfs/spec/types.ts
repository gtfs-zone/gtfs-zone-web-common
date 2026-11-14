export type GTFSPresence =
  | 'Required'
  | 'Optional'
  | 'Conditionally Required'
  | 'Conditionally Forbidden'
  | 'Recommended';

export interface GTFSEnumValue {
  value: number | string;
  label: string;
  description: string;
  /** Overlay id (e.g. 'google') when the value comes from a spec extension. */
  origin?: string;
  /** Picker group heading for the value. */
  group?: string;
}

/** A behavior note from a spec extension, shown alongside the description. */
export interface GTFSSpecNote {
  origin: string;
  text: string;
}

export interface GTFSForeignKeyTarget {
  file: string;
  field: string;
}

export interface GTFSFieldSpec {
  name: string;
  /** Verbatim reference type string, including the compound "Foreign ID referencing `x.y`" forms. */
  type: string;
  presence: GTFSPresence;
  presenceCondition?: string;
  description: string;
  /**
   * The field naming the file's entity (read-only in forms, the target of an
   * ID rename). Not the row key: that is `GTFSFileSpec.primaryKey`.
   */
  isEntityId?: boolean;
  allowEmpty?: boolean;
  /** A few fields legitimately reference more than one table, hence the array. */
  foreignKey?: GTFSForeignKeyTarget[];
  enumValues?: GTFSEnumValue[];
  /** Overlay id when the field comes from a spec extension. */
  origin?: string;
  notes?: GTFSSpecNote[];
}

/**
 * A file's primary key as the reference states it: the fields that identify a
 * row, `*` (all provided fields) or `none` (the file allows one row).
 */
export type GTFSPrimaryKey = string[] | '*' | 'none';

export interface GTFSFileSpec {
  filename: string;
  /** Unset only where the reference states no key (locations.geojson). */
  primaryKey?: GTFSPrimaryKey;
  format?: 'csv' | 'geojson';
  presence: GTFSPresence;
  presenceCondition?: string;
  description: string;
  fields?: GTFSFieldSpec[];
  /** Overlay id when the file comes from a spec extension. */
  origin?: string;
  notes?: GTFSSpecNote[];
}

export interface GTFSSpec {
  specVersion: string;
  files: GTFSFileSpec[];
}
