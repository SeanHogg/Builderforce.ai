/**
 * `runBulkAction` — the ONE pass every bulk request runs (PRD 47 §3.3).
 *
 * Steps, in order:
 *   1. Resolve the port from the registry. Unknown entity → 404.
 *   2. The action must be in `port.capabilities`. Otherwise → 400.
 *   3. Enforce `port.permissions[action]` against the caller's membership.
 *   4. Call the port with the authenticated tenant (never a body tenant).
 *   5. Record one activity event per succeeded id (`recordActivityBatch`).
 *   6. `port.invalidate(touched)` bumps the version tokens / broadcasts.
 *   7. Return the `BulkResult`.
 *
 * `dryRun` skips steps 5 and 6 entirely: a preview writes nothing.
 */
import type { BulkAction, BulkResult } from '@builderforce/interaction-contract';
import { BULK_MAX } from '@builderforce/interaction-contract';
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import type { Permission } from '../../domain/permissions/permissionRegistry';
import { NotFoundError, ValidationError, ForbiddenError } from '../../domain/shared/errors';
import { memberHasPermission } from '../rbac/effectivePermissions';
import { recordActivityBatch, resolveActorFromContext, SYSTEM_ACTOR } from '../activity/activityLog';
import {
  getBulkEntityPort,
  type BulkEntityPort,
  type BulkPortContext,
} from './bulkEntityPorts';

/**
 * The permission gate. `memberHasPermission` in production; tests swap this to
 * assert the gate runs (and passes/fails) without a database.
 */
export let bulkPermissionCheck: (
  db: BulkPortContext['db'],
  tenantId: number,
  userId: string,
  role: string,
  permission: Permission,
  env?: BulkPortContext['env'],
) => Promise<boolean> = memberHasPermission;

/** Test hook: replace the permission gate. Returns a restore function. */
export function setBulkPermissionCheck(check: typeof bulkPermissionCheck): () => void {
  const prev = bulkPermissionCheck;
  bulkPermissionCheck = check;
  return () => { bulkPermissionCheck = prev; };
}

export interface RunBulkActionInput {
  entity: string;
  action: BulkAction;
  ids: string[];
  targetId?: string;
  dryRun?: boolean;
}

export async function runBulkAction(
  c: Context<HonoEnv>,
  input: RunBulkActionInput,
): Promise<BulkResult> {
  const port = getBulkEntityPort(input.entity);
  if (!port) throw new NotFoundError('collection entity', input.entity);
  if (input.ids.length < 1 || input.ids.length > BULK_MAX) {
    throw new ValidationError(`Bulk request must carry 1 to ${BULK_MAX} ids; got ${input.ids.length}`);
  }
  if (!port.capabilities.includes(input.action)) {
    throw new ValidationError(`Entity '${input.entity}' does not support bulk '${input.action}'`);
  }

  const db = c.get('db');
  if (!db) throw new ForbiddenError('Bulk actions require an authenticated workspace session');
  const tenantId = c.get('tenantId') as number | undefined;
  const userId = c.get('userId') as string | undefined;
  const role = c.get('role') as string | undefined;
  if (tenantId == null || !userId || !role) {
    throw new ForbiddenError('Bulk actions require an authenticated workspace session');
  }

  const permission = port.permissions[input.action];
  if (permission) {
    const allowed = await bulkPermissionCheck(db, tenantId, userId, role, permission, c.env);
    if (!allowed) throw new ForbiddenError(`Requires the '${permission}' permission`);
  }

  const ctx: BulkPortContext = { tenantId, actor: userId, db, env: c.env };
  const actor = await resolveActorFromContext(c.env, db, c).catch(() => SYSTEM_ACTOR);

  const outcome = input.action === 'merge'
    ? await runMerge(port, ctx, input)
    : input.action === 'archive' || input.action === 'restore'
      ? await port.archive!(ctx, input.ids, input.action === 'archive')
      : await port.delete!(ctx, input.ids);

  const result: BulkResult = {
    action: input.action,
    succeeded: outcome.succeeded,
    skipped: outcome.skipped,
  };

  // dryRun previews nothing and writes nothing — skip the activity ledger and
  // the cache bump so a "Merge (preview)" is observably side-effect free.
  if (!input.dryRun) {
    const label = `${input.action} ${port.entity}`;
    await recordActivityBatch(c.env, db, outcome.succeeded.map((id) => ({
      tenantId,
      actor,
      verb: `collection.${input.action}`,
      targetType: port.entity,
      targetId: id,
      targetLabel: label,
      summary: label,
    })));
    await port.invalidate(ctx, [...outcome.succeeded, ...outcome.skipped.map((s) => s.id)]);
  }

  return result;
}

async function runMerge(
  port: BulkEntityPort,
  ctx: BulkPortContext,
  input: RunBulkActionInput,
): Promise<Awaited<ReturnType<NonNullable<BulkEntityPort['merge']>>>> {
  if (!input.targetId) throw new ValidationError(`Bulk 'merge' requires a targetId`);
  if (!input.ids.includes(input.targetId)) {
    throw new ValidationError(`Bulk 'merge' targetId must be one of ids`);
  }
  const sourceIds = input.ids.filter((id) => id !== input.targetId);
  return port.merge!(ctx, input.targetId, sourceIds, input.dryRun === true);
}
