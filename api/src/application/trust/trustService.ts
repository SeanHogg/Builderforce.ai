import { sha256Hex } from '../../domain/shared/hash';
import { secretLeakReasons, type TrustTier } from '../../domain/trust/contentTrust';
import { agentContextContributions, agentOutboundInspections } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export async function recordContextContribution(db: Db, args: { tenantId: number; executionId: number; sourceKind: string; sourceRef?: string; trustTier: TrustTier; content: string }): Promise<void> {
  await db.insert(agentContextContributions).values({
    tenantId: args.tenantId, executionId: args.executionId, sourceKind: args.sourceKind,
    sourceRef: args.sourceRef ?? null, trustTier: args.trustTier, contentHash: await sha256Hex(args.content),
  });
}

export async function inspectOutboundContent(db: Db, args: { tenantId: number; executionId: number; seam: string; target?: string; content: string }): Promise<{ ok: true } | { ok: false; reasons: string[] }> {
  const reasons = secretLeakReasons(args.content);
  await db.insert(agentOutboundInspections).values({
    tenantId: args.tenantId, executionId: args.executionId, seam: args.seam,
    target: args.target ?? null, verdict: reasons.length ? 'blocked' : 'allowed', reasons,
    contentHash: await sha256Hex(args.content),
  });
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
