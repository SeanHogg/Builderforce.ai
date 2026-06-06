/**
 * Trigger sync — keeps the `workflow_triggers` registry in agreement with a
 * definition's graph. Called on every create / update / import of a definition:
 * it deletes the definition's existing trigger rows and recreates them from the
 * current activatable trigger nodes, carrying the definition's run target and
 * computing each row's activation state:
 *
 *   schedule       → next_run_at from the cron expression (in its timezone)
 *   rss            → next_run_at = now (poll on the next tick) + empty cursor
 *   webhook        → random token + optional signing secret
 *   inbound-email  → random token (the inbox local-part) + optional secret
 *
 * Existing webhook/inbound-email tokens are preserved across re-sync (matched by
 * nodeId) so a published webhook URL / email address survives an edit.
 */

import { eq } from 'drizzle-orm';
import { workflowTriggers } from '../../infrastructure/database/schema';
import {
  extractTriggers,
  triggerNeedsToken,
  generateTriggerToken,
  configString,
  type TriggerSpec,
} from '../../domain/workflowTriggers';
import { nextCronTime, isValidCron } from '../../domain/workflowSchedule';
import type { WorkflowDefinition } from '../../domain/workflowGraph';
import type { RunTarget } from './instantiateRun';
import type { Db } from '../../infrastructure/database/connection';

export interface SyncTriggersParams {
  definitionId: string;
  tenantId: number;
  segmentId?: string | null;
  definition: WorkflowDefinition;
  target: RunTarget;
}

/** Compute the initial activation state for one trigger row. */
function activationFor(
  spec: TriggerSpec,
  now: Date,
  existingToken: string | undefined,
): { token: string | null; secret: string | null; nextRunAt: Date | null; cursor: string | null } {
  if (spec.triggerType === 'schedule') {
    const cron = configString(spec.config, 'cron');
    const tz = configString(spec.config, 'timezone') ?? 'UTC';
    const nextRunAt = cron && isValidCron(cron) ? nextCronTime(cron, now, tz) : null;
    return { token: null, secret: null, nextRunAt, cursor: null };
  }
  if (spec.triggerType === 'rss') {
    // Poll on the next tick; cursor stays empty until the first item is seen.
    return { token: null, secret: null, nextRunAt: now, cursor: null };
  }
  // webhook / inbound-email — keep an existing token so published URLs survive edits.
  if (triggerNeedsToken(spec.triggerType)) {
    return {
      token: existingToken ?? generateTriggerToken(),
      secret: configString(spec.config, 'secret') ?? null,
      nextRunAt: null,
      cursor: null,
    };
  }
  return { token: null, secret: null, nextRunAt: null, cursor: null };
}

/**
 * Re-sync the trigger registry for one definition. Idempotent: safe to call on
 * every save. Returns the number of activatable triggers now registered.
 */
export async function syncDefinitionTriggers(db: Db, params: SyncTriggersParams): Promise<number> {
  const specs = extractTriggers(params.definition);

  // Preserve existing webhook/inbound-email tokens by nodeId so a published
  // address survives a graph edit.
  const existing = await db
    .select({ nodeId: workflowTriggers.nodeId, token: workflowTriggers.token })
    .from(workflowTriggers)
    .where(eq(workflowTriggers.definitionId, params.definitionId));
  const tokenByNode = new Map(existing.map((r) => [r.nodeId, r.token ?? undefined]));

  // Replace the whole set — simplest correct re-sync; the per-definition row
  // count is tiny (one per trigger node).
  await db.delete(workflowTriggers).where(eq(workflowTriggers.definitionId, params.definitionId));

  if (specs.length === 0) return 0;

  const now = new Date();
  await db.insert(workflowTriggers).values(
    specs.map((spec) => {
      const act = activationFor(spec, now, tokenByNode.get(spec.nodeId));
      return {
        tenantId: params.tenantId,
        segmentId: params.segmentId ?? null,
        definitionId: params.definitionId,
        nodeId: spec.nodeId,
        triggerType: spec.triggerType,
        enabled: true,
        config: JSON.stringify(spec.config),
        runtime: params.target.runtime,
        agentHostId: params.target.runtime === 'host' ? params.target.agentHostId ?? null : null,
        cloudAgentRef: params.target.runtime === 'cloud' ? params.target.cloudAgentRef ?? null : null,
        token: act.token,
        secret: act.secret,
        nextRunAt: act.nextRunAt,
        cursor: act.cursor,
        createdAt: now,
        updatedAt: now,
      };
    }),
  );

  return specs.length;
}
