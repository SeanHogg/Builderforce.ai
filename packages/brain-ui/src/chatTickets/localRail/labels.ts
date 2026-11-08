/**
 * The local-first rail pieces' copy, read through the ONE label contract (`labelCatalog.ts`)
 * under the rail's `ct.` prefix, with English defaults for any key a host catalog lacks.
 * `{name}` placeholders stay literal in the catalog and are filled by the components.
 */
import { bundleLookup, stringsFrom, type LabelLookup } from '../../labelCatalog';

export interface LocalRailLabels {
  syncStatusPending: string;
  syncStatusSyncing: string;
  syncStatusSynced: string;
  syncStatusConflict: string;
  syncStatusDeadLetter: string;
  /** The badge's accessible name; `{status}` is the status word. */
  syncStatusAria: string;
  freshnessUpdated: string;
  freshnessNever: string;
  freshnessDeviceOnly: string;
  summaryAria: string;
  summaryMode: string;
  summaryModeLocalOnly: string;
  summaryModeHybrid: string;
  summaryModeSpecific: string;
  summaryDestination: string;
  summaryNoAccount: string;
  summaryQueued: string;
  summaryConflicts: string;
  summaryDeadLetters: string;
  summaryLastPush: string;
  summaryLastPull: string;
  summaryNever: string;
}

export const DEFAULT_LOCAL_RAIL_LABELS: LocalRailLabels = {
  syncStatusPending: 'Not synced yet',
  syncStatusSyncing: 'Syncing',
  syncStatusSynced: 'Synced',
  syncStatusConflict: 'Conflict',
  syncStatusDeadLetter: 'Failed to sync',
  syncStatusAria: 'Sync status: {status}',
  freshnessUpdated: 'Updated {time}',
  freshnessNever: 'Not read from the platform yet',
  freshnessDeviceOnly: 'Only on this device',
  summaryAria: 'Sync summary',
  summaryMode: 'Mode: {mode}',
  summaryModeLocalOnly: 'Local only',
  summaryModeHybrid: 'Hybrid',
  summaryModeSpecific: 'Specific',
  summaryDestination: 'To {destination}',
  summaryNoAccount: 'This device only',
  summaryQueued: 'Queued: {n} ({size})',
  summaryConflicts: 'Conflicts: {n}',
  summaryDeadLetters: 'Failed: {n}',
  summaryLastPush: 'Last push: {time}',
  summaryLastPull: 'Last pull: {time}',
  summaryNever: 'never',
};

export function localRailLabelsFrom(lookup: LabelLookup): LocalRailLabels {
  return stringsFrom(DEFAULT_LOCAL_RAIL_LABELS, lookup);
}

/** Over a host's flat bundle (`ct.*` keys), the shape the VS Code extension posts. */
export function localRailLabelsFromBundle(bundle: Readonly<Record<string, string>>, prefix = 'ct.'): LocalRailLabels {
  return localRailLabelsFrom(bundleLookup(bundle, (key) => `${prefix}${key}`));
}
