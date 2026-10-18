/**
 * Auto-approval rule evaluation — the policy half of `requestApproval`.
 *
 * Lived in `approvalRuleRoutes.ts` (a presentation file) and was imported from
 * there by `approvalRoutes.ts`; it moved here so the ONE request use case in the
 * application layer can apply it to every door that raises an approval.
 *
 * Matching criteria (all non-null fields must match):
 *   • actionType         — exact string match (null = any action type)
 *   • maxEstimatedCost   — metadata.estimatedCost ≤ value  (null = ignored)
 *   • maxFilesChanged    — metadata.filesChanged  ≤ value  (null = ignored)
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { approvalRules } from '../../infrastructure/database/schema';

/** True when any enabled rule for the tenant matches (meaning: auto-approve). */
export async function checkAutoApprovalRules(
  db: Db,
  tenantId: number,
  actionType: string,
  metadata: Record<string, unknown> | null,
): Promise<boolean> {
  const rules = await db
    .select()
    .from(approvalRules)
    .where(and(eq(approvalRules.tenantId, tenantId), eq(approvalRules.isEnabled, true)));

  for (const rule of rules) {
    if (rule.actionType !== null && rule.actionType !== actionType) continue;

    if (rule.maxEstimatedCost !== null) {
      const estimatedCost = Number(metadata?.estimatedCost ?? 0);
      if (estimatedCost > rule.maxEstimatedCost) continue;
    }

    if (rule.maxFilesChanged !== null) {
      const filesChanged = Number(metadata?.filesChanged ?? 0);
      if (filesChanged > rule.maxFilesChanged) continue;
    }

    return true;
  }

  return false;
}
