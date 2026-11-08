/**
 * branchScanRun — the "Run scan" action of `/api/governance/vuln-scans` (PRD 08 §10): scan a
 * connected repo's branch on demand, with the same use case as the automatic scan of an agent PR
 * (`prSecurityScan.runPullRequestScan`), minus the pull request.
 *
 * LEAST PRIVILEGE. Only a repo connected to THIS workspace can be scanned: the repo is resolved
 * through `resolveRepoCredential` (tenant-scoped, its own linked credential) and must belong to the
 * caller's segment. A repo with no usable credential is a clean 4xx, not a silent skip.
 *
 * A branch other than the default is diffed against the default (the changed files); the default
 * branch itself has nothing to diff against, so its tree is scanned.
 */
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ActorIdentity } from '../activity/activityLog';
import { recordAutomatedEvidence } from '../governance/automatedSocEvidence';
import { resolveRepoCommitSha } from '../repos/readRepoContents';
import { isResolveError, resolveRepoCredential } from '../repos/resolveRepoCredential';
import { openIncidentsForCriticalFindings } from './criticalFindingIncidents';
import { collectBranchFiles, collectChangedFiles, runPullRequestScan, type PrScanOutcome } from './prSecurityScan';

export type BranchScanResult =
  | { ok: true; branch: string; outcome: PrScanOutcome; incidentsOpened: number }
  | { ok: false; status: 400 | 404; error: string };

export async function runBranchScan(
  env: Env, db: Db,
  args: { tenantId: number; segmentId: string; actor: ActorIdentity; userId: string; repoId: string; ref?: string | null },
): Promise<BranchScanResult> {
  const resolved = await resolveRepoCredential(db, integrationCredentialSecret(env), args.tenantId, args.repoId);
  if (isResolveError(resolved)) return { ok: false, status: resolved.status, error: resolved.error };
  // A repo of another segment is invisible to this caller — same answer as "no such repo".
  if (resolved.repo.segmentId !== args.segmentId) {
    return { ok: false, status: 404, error: 'Repository not found' };
  }

  const base = (resolved.repo.defaultBranch ?? 'main').trim();
  const branch = (args.ref ?? '').trim() || base;
  const read = {
    provider: resolved.repo.provider, host: resolved.repo.host, owner: resolved.repo.owner,
    repo: resolved.repo.repo, token: resolved.token, ref: branch,
  };
  // Pin the reads to the branch's commit as resolved NOW (null only where the provider cannot say).
  const head = await resolveRepoCommitSha(read);
  const pin = head.ok ? head.sha : null;
  const collected = branch === base ? await collectBranchFiles(read, pin) : await collectChangedFiles(read, base, pin);
  const scope = {
    tenantId: args.tenantId, segmentId: args.segmentId, pullRequestId: null, executionId: null,
    repoRef: `${resolved.repo.owner}/${resolved.repo.repo}`, ref: branch, triggeredBy: `user:${args.userId}`,
    headSha: head.ok ? head.sha : null,
  };
  const outcome = await runPullRequestScan(env, db, args.actor, scope, collected);

  const incidentsOpened = await openIncidentsForCriticalFindings(env, db, args.actor, {
    tenantId: args.tenantId, segmentId: outcome.segmentId ?? args.segmentId, where: `${scope.repoRef}@${branch}`,
    repoRef: scope.repoRef,
  }, outcome.scans.map((s) => s.scanId));

  // SOC 2 evidence only for a COMPLETE scan: every scan completed and none truncated.
  const first = outcome.scans[0];
  if (first && !outcome.truncated && outcome.scans.every((s) => s.status === 'completed')) {
    await recordAutomatedEvidence(env, db, {
      tenantId: args.tenantId, segmentId: outcome.segmentId ?? args.segmentId, kind: 'scan', sourceId: first.scanId,
      note: `manual scan of ${scope.repoRef}@${branch} by user ${args.userId}; scans: ${outcome.scans.map((s) => `${s.scanType}=${s.status}(${s.scanId})`).join(', ')}`,
    });
  }
  return { ok: true, branch, outcome, incidentsOpened };
}
