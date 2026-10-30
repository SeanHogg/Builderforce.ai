/**
 * cloudLegacyApprovals - which of a pre-cutover cursor's gate keys may resume as APPROVED calls.
 *
 * The old engine recorded `policyAskedGates` when it ASKED, not when a person answered. So a cursor parked on a pending approval
 * holds its key, and so does one whose approval was rejected (the rejected call retried identically would otherwise run unapproved).
 * A key (`<gateId>|<tool>|<hash>`) is therefore trusted only when the LATEST governance approval on this execution for THAT EXACT CALL
 * is `approved`: each approval's key is recomputed (`policyGateCallKey`) from the gate id, the quoted tool name and the JSON arguments its
 * description carries; pending, rejected, missing - or an approval whose arguments cannot be recovered (truncated) - means the gate asks
 * again. Per call, not per tool: [run_command("ls") approved, run_command("rm -rf /") rejected] trusts the first and asks about the second.
 */
import { and, desc, eq } from 'drizzle-orm';
import { policyGateCallKey } from '@builderforce/agent-tools';
import { approvals } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { GOVERNANCE_GATE_ACTION } from '../../domain/approval/requestKind';
import { asJsonObject, parseJsonOr } from '../../domain/shared/json';
import type { CloudLoopState } from './cloudRunState';

/**
 * The gate key of the call an approval was raised for (`durableHuman.approve` writes `Approve the agent's use of "<tool>"? ...` then
 * `Governance gate "<gateId>" ... with these arguments: <JSON>`), or null when it cannot be recovered - e.g. arguments cut at 500 chars.
 */
function keyOfApproval(description: string | null): string | null {
  const tool = /"([^"]+)"/.exec(description ?? '')?.[1];
  const gateId = /Governance gate "([^"]+)"/.exec(description ?? '')?.[1];
  const rawArgs = /with these arguments: ([\s\S]*)$/.exec(description ?? '')?.[1];
  if (!tool || !gateId || rawArgs === undefined) return null;
  // Truncated or otherwise unparseable arguments: this approval cannot vouch for any call.
  const args = asJsonObject(parseJsonOr<unknown>(rawArgs, null));
  return args ? policyGateCallKey(gateId, tool, args) : null;
}

export async function trustedLegacyApprovals(db: Db, tenantId: number, executionId: number, saved: CloudLoopState | undefined): Promise<readonly string[]> {
  const keys = saved && !saved.run ? saved.policyAskedGates ?? [] : [];
  if (keys.length === 0) return [];
  const decisions = await db
    .select({ status: approvals.status, description: approvals.description })
    .from(approvals)
    .where(and(eq(approvals.tenantId, tenantId), eq(approvals.executionId, executionId), eq(approvals.actionType, GOVERNANCE_GATE_ACTION)))
    .orderBy(desc(approvals.createdAt));
  // The latest decision per call key (rows are newest first): the first one seen for a key is its latest.
  const latest = new Map<string, string>();
  for (const d of decisions) {
    const key = keyOfApproval(d.description);
    if (key && !latest.has(key)) latest.set(key, d.status);
  }
  return keys.filter((key) => latest.get(key) === 'approved');
}
