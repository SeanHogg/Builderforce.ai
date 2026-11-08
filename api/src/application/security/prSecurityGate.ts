/**
 * prSecurityGate — the ONE reader that feeds the merge verdict (PRD 08 §10 acceptance: "no agent PR
 * auto-merges with an open BLOCKER security finding", and no PR merges on a scan that did not happen).
 *
 * FIVE callers, one gate, no shortcut:
 *   - `runtime/cloudFinalize.ts`      immediate auto-merge at the end of a cloud run  (via the step's verdict)
 *   - `repos/openTaskPullRequest.ts`  the Done-drag path                               (via the step's verdict)
 *   - `ci/ingestRepoCiEvent.ts`       merge-on-green-CI                                (ensurePrSecurityVerdict)
 *   - `repos/prMergeSweep.ts`         the manager's autonomous merge                   (sweepSecurityGate)
 *   - `POST /api/repos/pull-requests/:id/merge` the human merge                        (ensurePrSecurityVerdict)
 * The step computes its verdict with `securityGateAtHead` and the others ask the provider for the head
 * commit NOW (`resolvePullRequestHead`) and call the same function, so every path applies
 * `evaluateSecurityGate` to the same inputs.
 *
 * THE GATE IS KEYED ON THE HEAD COMMIT. Scan rows carry the commit they covered; a push after the scan
 * is a new commit with no rows, which blocks until it is re-scanned. A PR whose scans are absent or still
 * running blocks too - there is no state in which "nothing recorded" reads as "nothing found".
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { pullRequests, prSecurityOverrides, vulnerabilityFindings, vulnerabilityScans } from '../../infrastructure/database/schema';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { resolveHeadSha } from '../repos/resolvePrHeadSha';
import { isResolveError, resolveRepoCredential } from '../repos/resolveRepoCredential';
import {
  BLOCKING_SEVERITIES, evaluateSecurityGate, reasonMessages, UNRESOLVED_FINDING_STATUSES,
  type SecurityGateInput, type SecurityMergeVerdict,
} from './securityMergeGate';

/** Everything the pure gate needs for one PR (all commits - the gate filters to the current head). */
export async function loadGateInputs(db: Db, tenantId: number, pullRequestId: string, currentHeadSha: string | null): Promise<SecurityGateInput> {
  const scans = await db
    .select({
      scanType: vulnerabilityScans.scanType, status: vulnerabilityScans.status, truncated: vulnerabilityScans.truncated,
      headSha: vulnerabilityScans.headSha, segmentId: vulnerabilityScans.segmentId, updatedAt: vulnerabilityScans.updatedAt,
    })
    .from(vulnerabilityScans)
    .where(and(eq(vulnerabilityScans.tenantId, tenantId), eq(vulnerabilityScans.pullRequestId, pullRequestId)));

  const findings = await db
    .select({
      id: vulnerabilityFindings.id, severity: vulnerabilityFindings.severity, status: vulnerabilityFindings.status,
      title: vulnerabilityFindings.title, category: vulnerabilityFindings.category, filePath: vulnerabilityFindings.filePath,
      headSha: vulnerabilityScans.headSha,
    })
    .from(vulnerabilityFindings)
    .innerJoin(vulnerabilityScans, eq(vulnerabilityScans.id, vulnerabilityFindings.scanId))
    .where(and(
      eq(vulnerabilityScans.tenantId, tenantId),
      eq(vulnerabilityScans.pullRequestId, pullRequestId),
      inArray(vulnerabilityFindings.status, [...UNRESOLVED_FINDING_STATUSES]),
      inArray(vulnerabilityFindings.severity, [...BLOCKING_SEVERITIES]),
    ));

  const overrides = await db
    .select({ headSha: prSecurityOverrides.headSha })
    .from(prSecurityOverrides)
    .where(and(eq(prSecurityOverrides.tenantId, tenantId), eq(prSecurityOverrides.pullRequestId, pullRequestId)));

  return { currentHeadSha, scans, findings, overrideShas: overrides.map((o) => o.headSha) };
}

/** The verdict for a PR at a KNOWN head commit (the step has just read it). */
export async function securityGateAtHead(db: Db, tenantId: number, pullRequestId: string, headSha: string | null): Promise<SecurityMergeVerdict> {
  return evaluateSecurityGate(await loadGateInputs(db, tenantId, pullRequestId, headSha));
}

export type PullRequestHead = { ok: true; sha: string } | { ok: false; reason: string };

/** The PR's head commit NOW, from the provider (GitHub, GitLab, Bitbucket Cloud and Server). */
export async function resolvePullRequestHead(db: Db, env: Env, tenantId: number, pullRequestId: string): Promise<PullRequestHead> {
  const [pr] = await db
    .select({ repoId: pullRequests.repoId, branchName: pullRequests.branchName, number: pullRequests.number })
    .from(pullRequests)
    .where(and(eq(pullRequests.id, pullRequestId), eq(pullRequests.tenantId, tenantId)))
    .limit(1);
  if (!pr?.repoId) return { ok: false, reason: 'the PR has no repository recorded' };
  const resolved = await resolveRepoCredential(db, integrationCredentialSecret(env), tenantId, pr.repoId);
  if (isResolveError(resolved)) return { ok: false, reason: resolved.error };
  // Every provider, through the ONE head resolver (the PR/MR resource; GitHub's branch commit only
  // when the PR has no provider number yet).
  return resolveHeadSha(
    { provider: resolved.repo.provider, host: resolved.repo.host, owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token },
    { number: pr.number, branch: pr.branchName },
  );
}

/** One line for a merge note / manager journal entry. */
export function describeSecurityBlock(verdict: Extract<SecurityMergeVerdict, { allow: false }>): string {
  // English, for logs / audit / the manager journal. The UI words the structured reasons itself.
  return `held for security: ${reasonMessages(verdict.reasons)}`;
}
