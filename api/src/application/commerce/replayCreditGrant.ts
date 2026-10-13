/**
 * THE OPERATOR'S INSIGHTS CREDIT GRANT — audited, ledgered, never a back door (D17).
 *
 * Builderforce is customer #1: its own workspace installs Insights and records
 * against the same allowance and credits as anyone. When an operator gives a
 * workspace recordings (the Builderforce workspace, a design partner), the grant is:
 *
 *   1. an `admin_audit_log` row (`REPLAY_CREDITS_GRANTED`, actor, tenant, units, reason),
 *   2. THEN a `ledger_entries` credit on `replay_recordings` whose reference is
 *      `replay-grant:<audit id>` — so the ledger row always names the audit row that
 *      authorised it, and one audit row can never credit twice.
 *
 * Audit first, on purpose: a credit with no audit row would be exactly the unmetered
 * back door D17 rules out. A failed audit write fails the grant.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { writeAdminAudit } from '../../infrastructure/audit/adminAudit';
import { NotFoundError, ValidationError } from '../../domain/shared/errors';
import { loadTenantPlanRow } from '../tenant/tenantPlanSnapshot';
import { recordReplayTrace, REPLAY_TRACE_VERBS } from '../replay/replayTrace';
import { creditReplayGrant, replayGrantReference, replayWalletSnapshot } from './replayWallet';

export const REPLAY_CREDITS_GRANTED_EVENT = 'REPLAY_CREDITS_GRANTED';

/** A single grant above this is a typo, not a decision (1M = the largest pack). */
export const REPLAY_GRANT_MAX_UNITS = 1_000_000;

export interface ReplayCreditGrantResult {
  auditId: string;
  reference: string;
  units: number;
  credits: number;
}

export async function grantReplayCredits(
  db: Db,
  env: Env,
  input: { actorId: string; tenantId: number; units: number; reason: string; ipAddress?: string | null },
): Promise<ReplayCreditGrantResult> {
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) throw new ValidationError('tenantId must be a workspace id');
  if (!Number.isInteger(input.units) || input.units <= 0 || input.units > REPLAY_GRANT_MAX_UNITS) {
    throw new ValidationError(`units must be a whole number from 1 to ${REPLAY_GRANT_MAX_UNITS}`);
  }
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ValidationError('A grant needs a reason');
  if (!(await loadTenantPlanRow(env, input.tenantId, db))) throw new NotFoundError('Workspace', input.tenantId);

  const auditId = crypto.randomUUID();
  await writeAdminAudit(db, REPLAY_CREDITS_GRANTED_EVENT, input.actorId, {
    id: auditId,
    tenantId: input.tenantId,
    metadata: { units: input.units, reason: reason.slice(0, 500), reference: replayGrantReference(auditId) },
    ipAddress: input.ipAddress ?? null,
  });

  await creditReplayGrant(db, env, {
    tenantId: input.tenantId,
    units: input.units,
    auditId,
    reason: reason.slice(0, 500),
    actorId: input.actorId,
  });

  await recordReplayTrace(env, db, {
    tenantId: input.tenantId,
    verb: REPLAY_TRACE_VERBS.creditsAdded,
    summary: `Operator granted ${input.units} recordings`,
    metadata: { source: 'operator_grant', auditId, units: input.units },
  });

  const snapshot = await replayWalletSnapshot(db, env, input.tenantId);
  return { auditId, reference: replayGrantReference(auditId), units: input.units, credits: snapshot.credits };
}
