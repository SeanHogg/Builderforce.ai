/**
 * The CORE-database facts the run-outcome label sweep reads (PRD 41 §D1): a tenant's pull
 * requests on the branches its runs committed to, each PR's merge deployment (when it was
 * recorded and whether a post-merge build failed it, `deployment_events`), and the PRD 23
 * review sign-offs on the PRs' tickets.
 *
 * Read-only, tenant-scoped, one statement per kind of fact per tenant (never one per run).
 * The run-outcomes tables themselves are on the operational endpoint (`runOutcomeStore`).
 */

import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { deploymentEvents, projectRepositories, pullRequests, ticketRoleSignoffs } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { parseRepositoryIdentity, sameRepository, type RepositoryAddress } from '../../domain/runOutcomes/repositoryIdentity';
import type { RunMergeDeployment, RunPullRequest, RunReviewSignoff } from '../../domain/runOutcomes/labelInputs';
import { runOutcomeChunks as chunks } from './runOutcomeStore';

/** A tenant's pull request with the repository it is on. */
export interface TenantPullRequest extends RunPullRequest {
  branchName: string;
  repository: RepositoryAddress;
}

/** The tenant's recorded PRs on any of `branches`, with their repository and post-merge failure flag. */
export async function pullRequestsOnBranches(core: Db, tenantId: number, branches: readonly string[]): Promise<TenantPullRequest[]> {
  const out: TenantPullRequest[] = [];
  for (const part of chunks([...new Set(branches)])) {
    const rows = await core.select({
      id: pullRequests.id,
      number: pullRequests.number,
      taskId: pullRequests.taskId,
      status: pullRequests.status,
      branchName: pullRequests.branchName,
      createdAt: pullRequests.createdAt,
      updatedAt: pullRequests.updatedAt,
      mergedAt: pullRequests.mergedAt,
      mergeSha: pullRequests.mergeSha,
      buildStatus: pullRequests.buildStatus,
      host: projectRepositories.host,
      owner: projectRepositories.owner,
      repo: projectRepositories.repo,
    }).from(pullRequests)
      .innerJoin(projectRepositories, eq(projectRepositories.id, pullRequests.repoId))
      .where(scopedToTenant(pullRequests, tenantId, inArray(pullRequests.branchName, part)));
    const deployments = await mergeDeployments(core, tenantId, rows.map((r) => r.id));
    for (const row of rows) {
      if (!row.branchName) continue;
      out.push({
        id: row.id,
        number: row.number,
        taskId: row.taskId,
        status: row.status,
        branchName: row.branchName,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        mergedAt: row.mergedAt,
        mergeSha: row.mergeSha,
        buildStatus: row.buildStatus,
        mergeDeployment: deployments.get(row.id) ?? null,
        repository: { host: row.host, owner: row.owner, repo: row.repo },
      });
    }
  }
  return out;
}

/**
 * Each PR's merge deployment (`recordMergeDeployment`, keyed by the PR row id): when it was
 * recorded, and whether a post-merge build marked it a change failure
 * (`setPullRequestBuildStatus`). Several rows for one PR fold to the earliest time, failed
 * when any is.
 */
async function mergeDeployments(core: Db, tenantId: number, prIds: readonly string[]): Promise<Map<string, RunMergeDeployment>> {
  const out = new Map<string, RunMergeDeployment>();
  if (prIds.length === 0) return out;
  const rows = await core.select({ ref: deploymentEvents.externalRef, isFailure: deploymentEvents.isFailure, deployedAt: deploymentEvents.deployedAt })
    .from(deploymentEvents)
    .where(scopedToTenant(deploymentEvents, tenantId, inArray(deploymentEvents.externalRef, [...prIds])));
  for (const row of rows) {
    if (typeof row.ref !== 'string' || !(row.deployedAt instanceof Date)) continue;
    const seen = out.get(row.ref);
    out.set(row.ref, {
      at: seen && seen.at.getTime() <= row.deployedAt.getTime() ? seen.at : row.deployedAt,
      failed: (seen?.failed ?? false) || row.isFailure === true,
    });
  }
  return out;
}

/** The PRs of `prs` on this run's repository identity and branch. */
export function pullRequestsOfRun(prs: readonly TenantPullRequest[], repository: string, branches: ReadonlySet<string>): TenantPullRequest[] {
  const address = parseRepositoryIdentity(repository);
  if (!address) return [];
  return prs.filter((pr) => branches.has(pr.branchName) && sameRepository(pr.repository, address));
}

/** PRD 23 sign-offs on these tickets since `since`, keyed by task id. */
export async function reviewSignoffsByTask(core: Db, tenantId: number, taskIds: readonly number[], since: Date): Promise<Map<number, RunReviewSignoff[]>> {
  const out = new Map<number, RunReviewSignoff[]>();
  for (const part of chunks([...new Set(taskIds)])) {
    const rows = await core.select({ taskId: ticketRoleSignoffs.taskId, verdict: ticketRoleSignoffs.verdict, createdAt: ticketRoleSignoffs.createdAt })
      .from(ticketRoleSignoffs)
      .where(scopedToTenant(ticketRoleSignoffs, tenantId, and(inArray(ticketRoleSignoffs.taskId, part), gte(ticketRoleSignoffs.createdAt, since))));
    for (const row of rows) {
      const list = out.get(row.taskId) ?? [];
      list.push({ verdict: row.verdict, createdAt: row.createdAt });
      out.set(row.taskId, list);
    }
  }
  return out;
}
