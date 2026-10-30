/**
 * cloudLegacyApprovals - which of a pre-cutover cursor's gate keys may resume as APPROVED calls.
 *
 * The old engine recorded `policyAskedGates` when it ASKED, not when a person answered. So a cursor parked on a pending approval
 * holds its key, and so does one whose approval was rejected (the rejected call retried identically would otherwise run unapproved).
 * A key (`<gateId>|<tool>|<hash>`) is therefore trusted only when the LATEST governance approval on this execution for THAT key's tool
 * is `approved` (matched by the quoted tool name the gate's question carries); pending, rejected or missing means the gate asks again.
 * Per tool, not per execution: [A rejected, B approved] trusts B and asks about A again.
 */
import { and, desc, eq } from 'drizzle-orm';
import { approvals } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { GOVERNANCE_GATE_ACTION } from '../../domain/approval/requestKind';
import type { CloudLoopState } from './cloudRunState';

/** The tool a legacy gate key is about (`<gateId>|<tool>|<hash>`), or null when the key is not in that shape. */
const toolOfKey = (key: string): string | null => key.split('|')[1] ?? null;

export async function trustedLegacyApprovals(db: Db, tenantId: number, executionId: number, saved: CloudLoopState | undefined): Promise<readonly string[]> {
  const keys = saved && !saved.run ? saved.policyAskedGates ?? [] : [];
  if (keys.length === 0) return [];
  const decisions = await db
    .select({ status: approvals.status, description: approvals.description })
    .from(approvals)
    .where(and(eq(approvals.tenantId, tenantId), eq(approvals.executionId, executionId), eq(approvals.actionType, GOVERNANCE_GATE_ACTION)))
    .orderBy(desc(approvals.createdAt));
  // The latest decision per tool (rows are newest first): the first one seen for a tool is its latest.
  const latest = new Map<string, string>();
  for (const d of decisions) {
    const tool = /"([^"]+)"/.exec(d.description ?? '')?.[1];
    if (tool && !latest.has(tool)) latest.set(tool, d.status);
  }
  return keys.filter((key) => {
    const tool = toolOfKey(key);
    return tool !== null && latest.get(tool) === 'approved';
  });
}
