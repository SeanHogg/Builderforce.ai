import { and, desc, eq } from 'drizzle-orm';
import { executionClaimEvidence, executionClaims, toolAuditEvents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { supportsExecutionClaim, type ExecutionClaimKind } from '../../domain/provenance/finishEvidence';

/** Persist an immutable completion claim and its exact supporting audit rows. */
export async function recordCodeCompletionClaim(
  db: Db,
  args: { tenantId: number; executionId: number; statement: string },
): Promise<{ ok: true; claimId: string; evidenceIds: number[] } | { ok: false; error: string }> {
  try {
    const candidates = await db
      .select({ id: toolAuditEvents.id, toolName: toolAuditEvents.toolName, category: toolAuditEvents.category, result: toolAuditEvents.result })
      .from(toolAuditEvents)
      .where(and(eq(toolAuditEvents.tenantId, args.tenantId), eq(toolAuditEvents.executionId, args.executionId)))
      .orderBy(desc(toolAuditEvents.id))
      .limit(500);
    const evidenceIds = candidates.filter((event) => supportsExecutionClaim('code_completion', event)).map((event) => event.id);
    if (evidenceIds.length === 0) return { ok: false, error: 'No successful mutation or verification event supports this completion claim.' };

    const [claim] = await db.insert(executionClaims).values({
      tenantId: args.tenantId,
      executionId: args.executionId,
      kind: 'code_completion',
      statement: args.statement.slice(0, 20_000),
    }).returning({ id: executionClaims.id });
    if (!claim) return { ok: false, error: 'Could not persist the completion claim.' };

    // The database trigger attaches these same qualifying events atomically and
    // rejects the claim insert when none exist. Read the authoritative edges back:
    // the caller reports what the database accepted, not what the preflight guessed.
    const attached = await db
      .select({ id: executionClaimEvidence.toolAuditEventId })
      .from(executionClaimEvidence)
      .where(and(
        eq(executionClaimEvidence.tenantId, args.tenantId),
        eq(executionClaimEvidence.claimId, claim.id),
      ));
    return { ok: true, claimId: claim.id, evidenceIds: attached.map((edge) => edge.id) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function recordTypedExecutionClaim(
  db: Db,
  args: { tenantId: number; executionId: number; kind: Exclude<ExecutionClaimKind, 'code_completion'>; statement: string },
): Promise<{ ok: true; claimId: string; evidenceIds: number[] } | { ok: false; error: string }> {
  try {
    const candidates = await db.select({ id: toolAuditEvents.id, toolName: toolAuditEvents.toolName, category: toolAuditEvents.category, result: toolAuditEvents.result })
      .from(toolAuditEvents).where(and(eq(toolAuditEvents.tenantId, args.tenantId), eq(toolAuditEvents.executionId, args.executionId)))
      .orderBy(desc(toolAuditEvents.id)).limit(500);
    if (!candidates.some((event) => supportsExecutionClaim(args.kind, event))) return { ok: false, error: `No successful evidence supports the ${args.kind} claim.` };
    const [claim] = await db.insert(executionClaims).values({ tenantId: args.tenantId, executionId: args.executionId, kind: args.kind, statement: args.statement.slice(0, 20_000) }).returning({ id: executionClaims.id });
    if (!claim) return { ok: false, error: 'Could not persist the claim.' };
    const attached = await db.select({ id: executionClaimEvidence.toolAuditEventId }).from(executionClaimEvidence).where(and(eq(executionClaimEvidence.tenantId, args.tenantId), eq(executionClaimEvidence.claimId, claim.id)));
    return { ok: true, claimId: claim.id, evidenceIds: attached.map((edge) => edge.id) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
