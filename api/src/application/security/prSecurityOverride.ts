/**
 * prSecurityOverride — a MANAGER's reasoned acceptance of the security risk of one pull request at
 * one head commit (PRD 08 §10), so a PR the scanners cannot fully cover (too large, a broken scanner,
 * an OSV outage) is not stuck forever behind the merge gate.
 *
 * THE OVERRIDE IS NARROW BY CONSTRUCTION
 *   - it is tied to the PR's CURRENT head commit, read from the provider at the moment of acceptance;
 *     the gate honours it for that commit only, so any later push needs a new decision;
 *   - it needs a written reason;
 *   - it is audited through the governance mutation envelope (`accept_risk`) AND recorded as SOC 2
 *     evidence of kind `override` - never as a clean scan.
 * The scans' own results are untouched: the findings stay open and visible.
 */
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { prSecurityOverrides, pullRequests, segments } from '../../infrastructure/database/schema';
import type { ActorIdentity } from '../activity/activityLog';
import { recordAutomatedEvidence } from '../governance/automatedSocEvidence';
import { recordGovernanceMutation } from '../governance/mutationAudit';
import type { SegmentScope } from '../shared/segmentScope';
import { securityVerdictEnsuringScan } from './ensurePrSecurityVerdict';
import { resolvePullRequestHead } from './prSecurityGate';

export const MIN_OVERRIDE_REASON_CHARS = 10;

export type AcceptRiskResult =
  | { ok: true; headSha: string; alreadyAccepted: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/**
 * The tenant's default segment: where SOC 2 evidence for a TENANT-scope act is filed. `soc_controls` /
 * `soc_evidence` are segment-scoped, so evidence cannot be segment-less; the default segment is the
 * tenant-level home. (The override row and the audit envelope themselves carry segment NULL, scope 'tenant'.)
 */
export async function tenantDefaultSegmentId(db: Db, tenantId: number): Promise<string | null> {
  const [row] = await db.select({ id: segments.id }).from(segments)
    .where(and(eq(segments.tenantId, tenantId), eq(segments.isDefault, true))).limit(1);
  return row?.id ?? null;
}

export async function acceptPrSecurityRisk(
  env: Env, db: Db, scope: SegmentScope,
  args: {
    pullRequestId: string; reason: string; actor: ActorIdentity;
    /** True for a tenant-wide OWNER. A PR that belongs to NO segment can be overridden by nobody else: a
     *  segment manager has authority over a segment, and this PR is not in one. */
    tenantAdmin: boolean;
    /** The head commit the manager SAW (the UI sends the SHA it displayed). Required: the risk accepted is
     *  the risk of THAT commit, so if the head has moved since, nothing is recorded (409). */
    expectedHeadSha: string;
  },
): Promise<AcceptRiskResult> {
  const reason = args.reason.trim();
  if (reason.length < MIN_OVERRIDE_REASON_CHARS) {
    return { ok: false, status: 400, error: `a reason of at least ${MIN_OVERRIDE_REASON_CHARS} characters is required` };
  }
  const [pr] = await db
    .select({ id: pullRequests.id, number: pullRequests.number, url: pullRequests.url, status: pullRequests.status, segmentId: pullRequests.segmentId })
    .from(pullRequests)
    .where(and(
      eq(pullRequests.id, args.pullRequestId),
      eq(pullRequests.tenantId, scope.tenantId),
      // The caller's segment, OR a PR that belongs to no segment (the tenant's) - the latter only for a
      // tenant admin, checked just below and recorded with scope 'tenant'.
      or(eq(pullRequests.segmentId, scope.segmentId), isNull(pullRequests.segmentId)),
    ))
    .limit(1);
  if (!pr) return { ok: false, status: 404, error: 'pull request not found' };
  if (pr.segmentId == null && !args.tenantAdmin) {
    return { ok: false, status: 403, error: 'this pull request belongs to no segment; only a tenant owner can accept its risk' };
  }
  if (pr.status === 'merged' || pr.status === 'closed') return { ok: false, status: 409, error: `the pull request is already ${pr.status}` };

  const head = await resolvePullRequestHead(db, env, scope.tenantId, pr.id);
  if (!head.ok) return { ok: false, status: 409, error: `the PR head commit could not be read: ${head.reason}` };
  if (head.sha.toLowerCase() !== args.expectedHeadSha.trim().toLowerCase()) {
    return { ok: false, status: 409, error: `the pull request head moved to ${head.sha.slice(0, 12)} since you looked (you saw ${args.expectedHeadSha.slice(0, 12)}); review the new commit and accept again` };
  }

  const tenantScope = pr.segmentId == null;
  const written = await db.insert(prSecurityOverrides).values({
    tenantId: scope.tenantId, segmentId: pr.segmentId, pullRequestId: pr.id,
    headSha: head.sha, reason, acceptedBy: args.actor.ref,
  }).onConflictDoNothing({ target: [prSecurityOverrides.pullRequestId, prSecurityOverrides.headSha] })
    .returning({ id: prSecurityOverrides.id });
  if (written.length === 0) return { ok: true, headSha: head.sha, alreadyAccepted: true };

  await recordGovernanceMutation(env, db, {
    actor: args.actor, tenantId: scope.tenantId, segmentId: pr.segmentId, entity: 'pr-security-override',
    entityId: written[0]!.id, action: 'accept_risk', after: { pullRequestId: pr.id, headSha: head.sha, reason },
    note: { scope: tenantScope ? 'tenant' : 'segment' },
  });
  // One consistent record: a segment PR's evidence goes to its segment; a TENANT-scope act (segment NULL on
  // the override row and the audit envelope) is filed under the tenant's DEFAULT segment - evidence cannot be
  // segment-less - and says `scope: tenant` in its note.
  const evidenceSegment = tenantScope ? await tenantDefaultSegmentId(db, scope.tenantId) : pr.segmentId;
  await recordAutomatedEvidence(env, db, {
    tenantId: scope.tenantId, segmentId: evidenceSegment, kind: 'override', sourceId: `${pr.id}@${head.sha}`, url: pr.url ?? null,
    note: `scope: ${tenantScope ? 'tenant' : 'segment'}; Security risk of PR #${pr.number ?? '?'} at commit ${head.sha.slice(0, 12)} accepted by ${args.actor.name}: ${reason}`,
  });
  return { ok: true, headSha: head.sha, alreadyAccepted: false };
}

/**
 * What the manager is about to accept: the PR's head commit right now and why the gate holds it (or that
 * it does not). Evaluates what is RECORDED (`check`) - looking never starts a scan. The UI shows the
 * commit and sends it back as `expectedHeadSha`.
 */
export async function describePrGate(db: Db, env: Env, scope: SegmentScope, pullRequestId: string, tenantAdmin: boolean) {
  const [pr] = await db
    .select({ id: pullRequests.id, segmentId: pullRequests.segmentId })
    .from(pullRequests)
    .where(and(
      eq(pullRequests.id, pullRequestId),
      eq(pullRequests.tenantId, scope.tenantId),
      or(eq(pullRequests.segmentId, scope.segmentId), isNull(pullRequests.segmentId)),
    ))
    .limit(1);
  // A segment-less PR is the tenant admin's to see here; to anyone else it does not exist.
  if (!pr || (pr.segmentId == null && !tenantAdmin)) return null;
  const verdict = await securityVerdictEnsuringScan(db, env, scope.tenantId, pullRequestId, { mode: 'check' });
  return {
    headSha: verdict.headSha,
    allowed: verdict.allow,
    overridden: verdict.allow && verdict.overridden === true,
    reasons: verdict.allow ? [] : verdict.reasons,
  };
}

/**
 * The segment's open pull requests, newest first - what the accept-risk picker offers. Segment-less PRs
 * are included for a TENANT admin only (they are the only role that can override one).
 */
export async function listOpenPullRequests(db: Db, scope: SegmentScope, tenantAdmin: boolean) {
  return db
    .select({ id: pullRequests.id, number: pullRequests.number, url: pullRequests.url, branchName: pullRequests.branchName })
    .from(pullRequests)
    .where(and(
      eq(pullRequests.tenantId, scope.tenantId),
      tenantAdmin
        ? or(eq(pullRequests.segmentId, scope.segmentId), isNull(pullRequests.segmentId))
        : eq(pullRequests.segmentId, scope.segmentId),
      eq(pullRequests.status, 'open'),
    ))
    .orderBy(desc(pullRequests.createdAt))
    .limit(100);
}
