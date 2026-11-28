import type { LocalEntityType } from './records.js';

/** A row's key in the committed records Map and in a transaction's draft. */
export const recordKey = (type: LocalEntityType, id: string): string => `${type}:${id}`;

/** The inverse of `recordKey`. An entity type never contains `:`, so the first one splits. */
export const splitRecordKey = (key: string): { entityType: LocalEntityType; id: string } => {
  const at = key.indexOf(':');
  return { entityType: key.slice(0, at) as LocalEntityType, id: key.slice(at + 1) };
};
