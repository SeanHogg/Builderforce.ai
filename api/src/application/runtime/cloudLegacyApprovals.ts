/**
 * cloudLegacyApprovals — which of a pre-cutover cursor's gate keys may resume as APPROVED calls.
 *
 * The old engine recorded `policyAskedGates` when it ASKED, not when a person answered. So a cursor parked on a pending approval
 * holds its key, and so does one whose approval was rejected (the rejected call retried identically would otherwise run unapproved).
 * A legacy resume therefore trusts the keys only when the execution's LATEST governance approval is `approved`; pending, rejected or
 * missing means none is trusted and the gate asks again. (A key carries no approval id, so the latest decision is the evidence there is.)
 */
import { and, desc, eq } from 'drizzle-orm';
import { approvals } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { GOVERNANCE_GATE_ACTION } from '../../domain/approval/requestKind';
import type { CloudLoopState } from './cloudRunState';

export async function trustedLegacyApprovals(db: Db, tenantId: number, executionId: number, saved: CloudLoopState | undefined): Promise<readonly string[]> {
  const keys = saved && !saved.run ? saved.policyAskedGates ?? [] : [];
  if (keys.length === 0) return [];
  const [latest] = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(and(eq(approvals.tenantId, tenantId), eq(approvals.executionId, executionId), eq(approvals.actionType, GOVERNANCE_GATE_ACTION)))
    .orderBy(desc(approvals.createdAt))
    .limit(1);
  return latest?.status === 'approved' ? keys : [];
}
