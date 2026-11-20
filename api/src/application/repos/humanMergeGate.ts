/**
 * humanMergeGate - the security gate in front of a PERSON's "Approve & Merge" (`POST
 * /api/repos/pull-requests/:id/merge`).
 *
 * The same gate every automatic merge uses applies to a human: a PR the scanners have not cleared, at the
 * commit it has right now, cannot be merged with a click. The only way past a blocked PR is a MANAGER
 * recording the SHA-bound accept-risk override (`prSecurityOverride`), which the gate honours for that
 * commit only. A blocked answer is a 409 whose body carries the gate's reasons, so the UI can show them.
 * A missing scan is scheduled past the response rather than run inline in the request; the person retries
 * once it completes. An allow carries the head commit the merge must pin to (`expectedHeadSha`).
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { securityVerdictEnsuringScan } from '../security/ensurePrSecurityVerdict';
import { describeSecurityBlock } from '../security/prSecurityGate';
import type { GateReason } from '../security/securityMergeGate';

export type HumanMergeGate =
  | { ok: true; headSha: string }
  /** `error` is English (logs, API clients); the UI words `details.reasons` itself, by `code`, in the viewer's language. */
  | { ok: false; status: 409; body: { error: string; code: 'security_gate'; details: { reasons: GateReason[]; headSha: string | null } } };

/**
 * The checks a PERSON's merge passes — the in-product button, and a person's pre-approved merge
 * grant (PRD 48 §4.6, `grantedMergeCohort.ts`), which must work EXACTLY like the button. One
 * function, so the two cannot drift. `mode` only says WHERE a missing scan runs: the request
 * defers it past the response; the sweep may run it inline when its budget affords one.
 */
export async function gateHumanMerge(
  db: Db, env: Env, tenantId: number, pullRequestId: string,
  options: { mode?: 'defer' | 'inline' } = {},
): Promise<HumanMergeGate> {
  const verdict = await securityVerdictEnsuringScan(db, env, tenantId, pullRequestId, { mode: options.mode ?? 'defer' });
  if (verdict.allow) return { ok: true, headSha: verdict.headSha };
  return {
    ok: false, status: 409,
    body: { error: describeSecurityBlock(verdict), code: 'security_gate', details: { reasons: verdict.reasons, headSha: verdict.headSha } },
  };
}
