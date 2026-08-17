/**
 * The KV store backing the Tools node kinds `set-variable` / `get-variable`
 * (scope='run') and `increment` (scope='definition') — see
 * `infrastructure/database/schema/agents.ts`'s `workflowVariables` table for
 * why the two share one generic (scope, scopeId, key) shape instead of two
 * tables. Plain functions over `Db`, matching the other node-kind helpers
 * `cloudExecutor.ts` already imports (`googleCredential.ts`, `connectorNode.ts`)
 * rather than a class-based repository — this has no domain entity of its own.
 */

import { and, eq, sql } from 'drizzle-orm';
import { workflowVariables } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export type VariableScope = 'run' | 'definition';

/** Read one variable; `''` when unset (a workflow reading before any write
 *  should see an empty string, not throw). */
export async function getWorkflowVariable(
  db: Db,
  tenantId: number,
  scope: VariableScope,
  scopeId: string,
  key: string,
): Promise<string> {
  const [row] = await db
    .select({ value: workflowVariables.value })
    .from(workflowVariables)
    .where(and(
      eq(workflowVariables.tenantId, tenantId),
      eq(workflowVariables.scope, scope),
      eq(workflowVariables.scopeId, scopeId),
      eq(workflowVariables.key, key),
    ))
    .limit(1);
  return row?.value ?? '';
}

/** Write (upsert) one variable. */
export async function setWorkflowVariable(
  db: Db,
  tenantId: number,
  scope: VariableScope,
  scopeId: string,
  key: string,
  value: string,
): Promise<void> {
  await db
    .insert(workflowVariables)
    .values({ tenantId, scope, scopeId, key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [workflowVariables.scope, workflowVariables.scopeId, workflowVariables.key],
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Atomically add `step` to a numeric counter (creating it at `step` if unset)
 * and return the new value — the definition-scoped persistence is what makes
 * this behave like Make's Increment function (survives across runs) rather
 * than a run-scoped `set-variable`.
 */
export async function incrementWorkflowVariable(
  db: Db,
  tenantId: number,
  scopeId: string,
  key: string,
  step: number,
): Promise<number> {
  const [row] = await db
    .insert(workflowVariables)
    .values({ tenantId, scope: 'definition', scopeId, key, value: String(step), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [workflowVariables.scope, workflowVariables.scopeId, workflowVariables.key],
      set: {
        value: sql`(COALESCE(NULLIF(${workflowVariables.value}, '')::numeric, 0) + ${step})::text`,
        updatedAt: new Date(),
      },
    })
    .returning({ value: workflowVariables.value });
  return Number(row?.value ?? step);
}
