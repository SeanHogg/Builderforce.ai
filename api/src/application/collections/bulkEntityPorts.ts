/**
 * The ONE bulk-entity registry (PRD 47 §3.3).
 *
 * Every entity that offers bulk Delete / Archive / Merge on a Collection surface
 * registers a {@link BulkEntityPort} here, and `POST /api/collections/:entity/bulk`
 * resolves through this map. There is no second delete path: the entity's
 * single-record route is rewritten to call its port with `[id]`, so a bulk call
 * and a one-off click run the exact same set-based code.
 *
 * D2: the tenant the port acts for is ALWAYS the authenticated JWT tenant the
 * caller's membership established — the request body carries no tenant id and a
 * port never reads one from a client-supplied field.
 *
 * D3: a port keeps its entity's EXISTING delete semantics (hard vs soft); bulk
 * is a shape change, not a behaviour change.
 *
 * D4: a merged-away source is archived or tombstoned, never hard-deleted, so a
 * merge can be revisited.
 */
import type { BulkAction } from '@builderforce/interaction-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { Permission } from '../../domain/permissions/permissionRegistry';

/** The bulk entities registered in this deployment (the registry's keys). */
export type BulkEntityKey =
  | 'project'
  | 'task'
  | 'creationSession'
  | 'spec'
  | 'workflow'
  | 'workflowDefinition'
  | 'team'
  | 'role'
  | 'brainChat'
  | 'chatSession'
  | 'persona'
  | 'prompt'
  | 'alert'
  | 'knowledgeDoc'
  | 'incident'
  | 'rfp'
  | 'user'
  | 'tenant'
  | 'suspectAccount';

/** Everything a port needs to act, handed down from `runBulkAction`. */
export interface BulkPortContext {
  tenantId: number;
  actor: string;
  db: Db;
  env: Env;
}

/**
 * The per-id verdicts of one bulk pass. A port partitions the ids it was given
 * into `succeeded` (the action applied) and `skipped` (it did not, with a
 * reason). A cross-tenant id is ALWAYS `not_found` — the response never confirms
 * that a record outside the caller's tenant exists.
 */
export interface BulkOutcome {
  succeeded: string[];
  skipped: Array<{ id: string; reason: 'not_found' | 'forbidden' | 'builtin' | 'conflict' | 'already' }>;
}

/**
 * The per-entity contract the bulk endpoint runs through.
 *
 * A port declares its capabilities; the endpoint rejects an action the entity
 * does not offer (400) BEFORE any permission check or write. Each capability
 * maps to a permission; the endpoint enforces it with `requirePermission`.
 * `invalidate` bumps the version tokens / broadcasts for the rows the pass
 * touched, so the next cached list read reflects the change.
 *
 * `merge` is optional; when present the endpoint requires `targetId` to be one
 * of `ids` and passes the REST of `ids` as `sourceIds`. `dryRun` must compute
 * the preview counts and write NOTHING.
 */
export interface BulkEntityPort {
  entity: BulkEntityKey;
  capabilities: BulkAction[];
  permissions: Partial<Record<BulkAction, Permission>>;
  delete?(ctx: BulkPortContext, ids: string[]): Promise<BulkOutcome>;
  /** `archived: true` archives, `false` restores. One port answers both. */
  archive?(ctx: BulkPortContext, ids: string[], archived: boolean): Promise<BulkOutcome>;
  merge?(ctx: BulkPortContext, targetId: string, sourceIds: string[], dryRun: boolean): Promise<BulkOutcome>;
  /** Bump the cache versions / broadcast for `touched` (what the pass changed). */
  invalidate(ctx: BulkPortContext, touched: string[]): Promise<void>;
}

const registry = new Map<BulkEntityKey, BulkEntityPort>();

/** Register (or replace) a port. Idempotent so tests can re-register freely. */
export function registerBulkEntityPort(port: BulkEntityPort): void {
  registry.set(port.entity, port);
}

export function getBulkEntityPort(entity: string): BulkEntityPort | undefined {
  return registry.get(entity as BulkEntityKey);
}

/** Test helper: reset every registered port. */
export function clearBulkEntityPorts(): void {
  registry.clear();
}
