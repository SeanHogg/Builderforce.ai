import type React from 'react';
import type { BulkAction, BulkSkipReason } from './collectionTypes';

/**
 * The entity a Collection acts on. `null` marks a READ-ONLY catalog — the bulk
 * bar renders nothing and no selection checkboxes appear. W1+ migrations add
 * entity keys here as their bulk port registers server-side (PRD 47 §4/§5).
 */
export type BulkEntityKey =
  | 'project'
  | 'task'
  | 'role'
  | 'creation-session'
  | 'workflow'
  | 'prd'
  | 'team'
  | 'agent'
  | 'persona'
  | 'prompt'
  | 'skill'
  | 'integration'
  | 'connector'
  | 'mcp-server'
  | 'api-key'
  | 'session'
  | 'brain-chat'
  | 'contributor'
  | 'recording'
  | 'lead';

/** The set of bulk actions an entity port supports. */
export type BulkCapability = BulkAction;

/** One row of the bulk-capability matrix the bulk bar consults (PRD 47 §3.1). */
export interface BulkCapabilityRow {
  /** The actions this entity's port supports. */
  actions: BulkAction[];
  /** The capability that gates EVERY action (administer-level for destructive). */
  permission: string;
  /** Whether the entity models archive (shows the Active/Archived/All filter). */
  hasArchive?: boolean;
}

/**
 * The bulk-capability matrix. The bulk bar shows an action only when the
 * entity's row lists it AND `usePermission(row.permission)` passes; when the
 * entity supports it but the role does not, the action renders DISABLED WITH
 * REASON (the RoleGate convention), never hidden. Permissions resolve through
 * the collection.* capabilities in lib/rbac.
 */
export const BULK_CAPABILITIES: Record<BulkEntityKey, BulkCapabilityRow> = {
  project:      { actions: ['delete', 'archive', 'restore', 'merge'], permission: 'collections.manage', hasArchive: true },
  task:         { actions: ['delete', 'archive', 'restore', 'merge'], permission: 'collections.manage', hasArchive: true },
  role:         { actions: ['delete', 'merge'], permission: 'collections.manage' },
  'creation-session': { actions: ['delete', 'archive', 'restore', 'merge'], permission: 'collections.manage', hasArchive: true },
  workflow:     { actions: ['delete', 'archive'], permission: 'collections.manage', hasArchive: true },
  prd:          { actions: ['delete', 'archive'], permission: 'collections.manage', hasArchive: true },
  team:         { actions: ['delete'], permission: 'collections.manage' },
  agent:        { actions: ['delete', 'archive'], permission: 'collections.manage', hasArchive: true },
  persona:      { actions: ['delete', 'archive'], permission: 'collections.manage', hasArchive: true },
  prompt:       { actions: ['delete', 'archive'], permission: 'collections.manage', hasArchive: true },
  skill:        { actions: ['delete'], permission: 'collections.manage' },
  integration:  { actions: ['delete'], permission: 'collections.manage' },
  connector:    { actions: ['delete'], permission: 'collections.manage' },
  'mcp-server': { actions: ['delete'], permission: 'collections.manage' },
  'api-key':    { actions: ['delete'], permission: 'collections.manage' },
  session:      { actions: ['delete'], permission: 'collections.manage' },
  'brain-chat': { actions: ['delete', 'archive', 'restore', 'merge'], permission: 'collections.manage', hasArchive: true },
  contributor:  { actions: ['delete', 'merge'], permission: 'collections.manage' },
  recording:    { actions: ['delete'], permission: 'collections.manage' },
  lead:         { actions: ['delete'], permission: 'collections.manage' },
};

export interface CollectionDescriptor<Row> {
  entity: BulkEntityKey | null;          // null = read-only collection (no selection, no bulk bar)
  surfaceKey: string;                     // preference key, e.g. 'projects.tasks'
  rowId: (row: Row) => string;
  columns: CollectionColumn<Row>[];       // List mode
  card: (row: Row) => React.ReactNode;    // Card mode body (selection checkbox is added by CollectionCards)
  label: (row: Row) => string;            // merge picker + confirm copy
  defaultView?: 'card' | 'table';
  defaultSort: { key: string; dir: 'asc' | 'desc' };
  emptyKey: string;                       // i18n key
}

export interface CollectionColumn<Row> {
  key: string; header: string;            // header is an already-translated string
  cell: (row: Row) => React.ReactNode;
  sortKey?: string;                       // must match the server allowlist for server sources
  compare?: (a: Row, b: Row) => number;   // local sources
  width?: string; align?: 'start' | 'end';
}

/** Human-readable skip reason keys for the expandable toast. */
export type { BulkSkipReason };
