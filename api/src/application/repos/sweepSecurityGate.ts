/**
 * sweepSecurityGate - the security gate as the PR merge sweep uses it: ONE call in, a verdict out, so
 * `prMergeSweep.ts` carries no gate logic of its own.
 *
 * The sweep is a cron job with a small per-project budget. The step behind the gate includes a model
 * review of up to 25s, so it runs INLINE only when the budget affords it; otherwise the scan is
 * scheduled past this pass (`defer`) and the merge is attempted on the next pass, once the verdict
 * exists. Either way the verdict is the same gate's, and an allow carries the head commit the merge
 * must pin to.
 *
 * CI AND THE PIN MUST BE THE SAME COMMIT. Under an `on_green` policy the merge rides on green CI, and
 * green CI is a fact about ONE commit. If the security verdict landed on a newer head than the commit CI
 * passed on (a push between the two), the pin would ship code CI never saw: that is a block
 * (`ci_not_on_head`) until CI is green on the head that was security-checked.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { PassBudget } from '../manager/passBudget';
import { describeSecurityBlock } from '../security/prSecurityGate';
import { gateReason, type GateReason } from '../security/securityMergeGate';
import { INLINE_STEP_MIN_REMAINING_MS, securityVerdictEnsuringScan } from '../security/ensurePrSecurityVerdict';
import { pollPrCiHead, type PollablePr } from './pollPrCiStatus';

export type SweepSecurityGate =
  | { allow: true; headSha: string }
  | { allow: false; reasons: GateReason[]; summary: string };

const block = (reasons: GateReason[]): SweepSecurityGate =>
  ({ allow: false, reasons, summary: `held for security: ${reasons.map((r) => r.message).join('; ')}` });

export async function sweepSecurityGate(
  db: Db, env: Env, budget: Pick<PassBudget, 'canAfford'>, tenantId: number, pr: PollablePr, requireCiGreenOnHead: boolean,
): Promise<SweepSecurityGate> {
  const verdict = await securityVerdictEnsuringScan(db, env, tenantId, pr.id, {
    mode: budget.canAfford(INLINE_STEP_MIN_REMAINING_MS) ? 'inline' : 'defer',
  });
  if (!verdict.allow) return { allow: false, reasons: verdict.reasons, summary: describeSecurityBlock(verdict) };

  if (requireCiGreenOnHead) {
    const ci = await pollPrCiHead(env, db, tenantId, pr);
    if (!ci || !ci.headSha || ci.headSha.toLowerCase() !== verdict.headSha.toLowerCase() || !ci.green) {
      return block([gateReason(
        'ci_not_on_head',
        `CI has not passed on the security-checked commit ${verdict.headSha.slice(0, 12)}; the merge waits for CI on this head`,
        { detail: verdict.headSha.slice(0, 12) },
      )]);
    }
  }
  return { allow: true, headSha: verdict.headSha };
}
