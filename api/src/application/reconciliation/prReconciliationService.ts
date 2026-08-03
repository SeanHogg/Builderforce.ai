import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  ideAgents,
  prReconciliationErrors,
  prReconciliationItems,
  prReconciliationRuns,
  projectRepositories,
  pullRequests,
  tasks,
} from '../../infrastructure/database/schema';
import { isResolveError, resolveRepoCredential } from '../repos/resolveRepoCredential';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  classifyPullRequest,
  extractTaskId,
  type ReconciliationCheck,
  type ReconciliationPrInput,
} from './prReconciliationClassifier';

type FetchLike = typeof fetch;

export interface GithubPrSnapshot extends ReconciliationPrInput {
  url: string;
  headOid: string;
  createdAt: string;
  updatedAt: string;
  author: string | null;
}

interface GithubGraphqlResponse {
  data?: {
    repository?: {
      pullRequests: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          number: number; title: string; url: string; isDraft: boolean;
          headRefName: string; baseRefName: string; headRefOid: string;
          createdAt: string; updatedAt: string; mergeable: string; mergeStateStatus: string;
          changedFiles: number; additions: number; deletions: number;
          author: { login?: string } | null;
          commits: { nodes: Array<{ commit: { statusCheckRollup: null | { contexts: { nodes: Array<null | {
            __typename: 'CheckRun' | 'StatusContext'; name?: string; status?: string; conclusion?: string;
            detailsUrl?: string; context?: string; state?: string; targetUrl?: string;
          }> } } } }> };
        }>;
      };
    };
  };
  errors?: Array<{ message: string; path?: Array<string | number>; type?: string }>;
}

const GITHUB_QUERY = `
query ReconcilePullRequests($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 25, after: $cursor, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft headRefName baseRefName headRefOid
        createdAt updatedAt mergeable mergeStateStatus changedFiles additions deletions
        author { login }
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { name status conclusion detailsUrl }
          ... on StatusContext { context state targetUrl }
        } } } } } }
      }
    }
  }
}`;

class ReconciliationError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

const githubBase = (host: string | null): string =>
  !host || host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;

export async function fetchOpenPullRequests(
  token: string,
  owner: string,
  repo: string,
  host: string | null,
  fetchFn: FetchLike = fetch,
): Promise<GithubPrSnapshot[]> {
  const endpoint = !host || host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`;
  const result: GithubPrSnapshot[] = [];
  let cursor: string | null = null;

  // 100 PRs × a full status rollup is large enough for GitHub's GraphQL edge to
  // return HTTP 502 on the real 410-PR Builderforce repository. Twenty-five keeps
  // responses bounded; forty pages still permits a deliberately capped 1,000 PRs.
  for (let page = 1; page <= 40; page++) {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Builderforce-PR-Reconciler/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ query: GITHUB_QUERY, variables: { owner, repo, cursor } }),
    });
    if (!response.ok) {
      throw new ReconciliationError('GITHUB_HTTP_ERROR', `GitHub GraphQL returned HTTP ${response.status}`, {
        status: response.status,
        response: (await response.text().catch(() => '')).slice(0, 2_000),
      });
    }
    const payload = await response.json() as GithubGraphqlResponse;
    if (payload.errors?.length) {
      throw new ReconciliationError('GITHUB_GRAPHQL_ERROR', payload.errors.map((e) => e.message).join('; '), {
        errors: payload.errors,
      });
    }
    const connection = payload.data?.repository?.pullRequests;
    if (!connection) throw new ReconciliationError('GITHUB_REPOSITORY_NOT_FOUND', `GitHub repository ${owner}/${repo} was not returned`);

    for (const node of connection.nodes) {
      const contexts = node.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
      const checks: ReconciliationCheck[] = contexts.filter((c): c is NonNullable<typeof c> => c != null).map((c) => ({
        name: c.__typename === 'CheckRun' ? (c.name ?? 'unnamed check') : (c.context ?? 'unnamed status'),
        state: c.__typename === 'CheckRun'
          ? (c.conclusion || c.status || 'UNKNOWN')
          : (c.state || 'UNKNOWN'),
        detailsUrl: c.__typename === 'CheckRun' ? c.detailsUrl : c.targetUrl,
      }));
      result.push({
        number: node.number, title: node.title, body: '', url: node.url,
        headBranch: node.headRefName, headOid: node.headRefOid, isDraft: node.isDraft,
        createdAt: node.createdAt, updatedAt: node.updatedAt, author: node.author?.login ?? null,
        changedFiles: node.changedFiles, additions: node.additions, deletions: node.deletions,
        mergeable: node.mergeable, mergeStateStatus: node.mergeStateStatus, checks,
      });
    }
    if (!connection.pageInfo.hasNextPage) return result;
    if (!connection.pageInfo.endCursor) throw new ReconciliationError('GITHUB_PAGINATION_ERROR', 'GitHub reported another page without an end cursor');
    cursor = connection.pageInfo.endCursor;
  }
  throw new ReconciliationError('GITHUB_PAGE_LIMIT', 'Open PR inventory exceeded the 1,000 PR safety limit');
}

interface ErrorContext {
  runId: string;
  tenantId: number;
  repoId: string;
  prNumber?: number;
  phase: 'configuration' | 'collection' | 'correlation' | 'classification' | 'action' | 'persistence';
  code?: string;
  details?: Record<string, unknown>;
}

async function recordError(db: Db, context: ErrorContext, error: unknown): Promise<void> {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const code = error instanceof ReconciliationError ? error.code : (context.code ?? 'UNEXPECTED_ERROR');
  const details = { ...context.details, ...(error instanceof ReconciliationError ? error.details : {}) };
  reportCaughtError(error, {
    source: 'application/reconciliation/prReconciliationService.ts',
    operation: `prReconciliation.${context.phase}`,
    context: { runId: context.runId, repoId: context.repoId, prNumber: context.prNumber, code, details },
  });
  try {
    await db.insert(prReconciliationErrors).values({
      runId: context.runId, tenantId: context.tenantId, repoId: context.repoId,
      prNumber: context.prNumber, phase: context.phase, code,
      message: normalized.message, stack: normalized.stack ?? null, details,
    });
  } catch (persistenceError) {
    reportCaughtError(persistenceError, {
      source: 'application/reconciliation/prReconciliationService.ts',
      operation: 'prReconciliation.persistError',
      context: { runId: context.runId, originalCode: code, originalMessage: normalized.message },
    });
  }
}

export interface RunReconciliationArgs {
  tenantId: number;
  repoId: string;
  mode?: 'dry_run' | 'apply';
  approvedPrNumbers?: number[];
  /** Internal scheduled-agent policy. Never populated from an HTTP request. */
  autoApplyCloseCandidates?: boolean;
  requestedBy?: string | null;
}

/**
 * `requested_by` is a foreign key to users.id. Machine JWT subjects such as
 * `agentHost:mcp` are deliberately not users, so they must remain audit-attributed
 * through the request/error context rather than being written into this column.
 */
export function reconciliationRequesterId(
  userId: string | null | undefined,
  machineActor: unknown,
): string | null {
  return machineActor == null ? (userId || null) : null;
}

/** Exact unattended-action policy: no recommendation except a high-confidence close may enter the allowlist. */
export function policyApprovedCloseNumbers(items: Array<{
  pr: { number: number };
  decision: { classification: string; confidence: string };
}>): number[] {
  return items
    .filter(({ decision }) => decision.classification === 'close_candidate' && decision.confidence === 'high')
    .map(({ pr }) => pr.number)
    .sort((a, b) => a - b);
}

export interface ReconciliationRunResult {
  runId: string;
  status: 'completed' | 'completed_with_errors';
  summary: Record<string, number>;
  errors: number;
}

export async function runPrTicketReconciliation(
  env: Env,
  db: Db,
  args: RunReconciliationArgs,
  fetchFn: FetchLike = fetch,
): Promise<ReconciliationRunResult> {
  const mode = args.mode ?? 'dry_run';
  const approved = [...new Set((args.approvedPrNumbers ?? []).filter((n) => Number.isInteger(n) && n > 0))];
  if (args.autoApplyCloseCandidates && mode !== 'apply') {
    throw new ReconciliationError('INVALID_AUTO_APPLY_MODE', 'Automatic close-candidate policy requires apply mode');
  }
  if (mode === 'apply' && approved.length === 0 && !args.autoApplyCloseCandidates) {
    throw new ReconciliationError('APPROVAL_REQUIRED', 'Apply mode requires an explicit non-empty approvedPrNumbers allowlist');
  }

  const [repo] = await db.select().from(projectRepositories).where(and(
    eq(projectRepositories.id, args.repoId), eq(projectRepositories.tenantId, args.tenantId),
  )).limit(1);
  if (!repo) throw new ReconciliationError('REPOSITORY_NOT_FOUND', 'Repository not found');
  if (repo.provider !== 'github') throw new ReconciliationError('UNSUPPORTED_PROVIDER', 'PR reconciliation currently supports GitHub repositories only');

  const [agent] = await db.select({ id: ideAgents.id }).from(ideAgents).where(and(
    eq(ideAgents.tenantId, args.tenantId), eq(ideAgents.builtinKind, 'pr_reconciler'), eq(ideAgents.status, 'active'),
  )).limit(1);

  const [created] = await db.insert(prReconciliationRuns).values({
    tenantId: args.tenantId, projectId: repo.projectId, repoId: repo.id,
    agentRef: agent?.id ?? null, mode, requestedBy: args.requestedBy ?? null,
    approvedPrNumbers: approved,
  }).returning({ id: prReconciliationRuns.id });
  if (!created) throw new ReconciliationError('RUN_CREATE_FAILED', 'The reconciliation run could not be created');
  const runId = created.id;
  let errorCount = 0;

  try {
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
    const resolved = await resolveRepoCredential(db, secret, args.tenantId, repo.id);
    if (isResolveError(resolved)) throw new ReconciliationError('CREDENTIAL_RESOLUTION_FAILED', resolved.error, { status: resolved.status });

    let githubPrs: GithubPrSnapshot[];
    try {
      githubPrs = await fetchOpenPullRequests(resolved.token, repo.owner, repo.repo, repo.host, fetchFn);
    } catch (error) {
      errorCount++;
      await recordError(db, { runId, tenantId: args.tenantId, repoId: repo.id, phase: 'collection' }, error);
      throw error;
    }

    const internalRows = await db.select({ id: pullRequests.id, number: pullRequests.number, taskId: pullRequests.taskId })
      .from(pullRequests).where(and(eq(pullRequests.repoId, repo.id), eq(pullRequests.tenantId, args.tenantId)));
    const internalByNumber = new Map(internalRows.filter((r) => r.number != null).map((r) => [r.number as number, r]));
    const taskRefByPr = new Map<number, number | null>();
    for (const pr of githubPrs) {
      taskRefByPr.set(pr.number, internalByNumber.get(pr.number)?.taskId ?? extractTaskId(pr.title, pr.body, pr.headBranch));
    }

    const taskIds = [...new Set([...taskRefByPr.values()].filter((id): id is number => id != null))];
    const taskRows = taskIds.length === 0 ? [] : await db.select({ id: tasks.id, status: tasks.status, completedAt: tasks.completedAt })
      .from(tasks).where(and(eq(tasks.projectId, repo.projectId), inArray(tasks.id, taskIds)));
    const taskById = new Map(taskRows.map((t) => [t.id, t]));
    const prsByTask = new Map<number, number[]>();
    for (const [prNumber, taskId] of taskRefByPr) {
      if (taskId == null) continue;
      prsByTask.set(taskId, [...(prsByTask.get(taskId) ?? []), prNumber]);
    }

    const decisions = githubPrs.map((pr) => {
      const taskId = taskRefByPr.get(pr.number) ?? null;
      const ticket = taskId == null ? null : taskById.get(taskId) ?? null;
      return { pr, taskId, ticket, decision: classifyPullRequest({
        pr, taskId, ticket,
        duplicateOpenPrNumbers: taskId == null ? [] : (prsByTask.get(taskId) ?? []),
      }) };
    });

    // The scheduled reconciler is itself the policy approver for the one action it
    // is allowed to take unattended: closing HIGH-confidence close candidates.
    // Persist the resolved numbers before acting so diagnostics always show the
    // exact allowlist the run used. HTTP callers cannot enable this flag.
    const policyApproved = args.autoApplyCloseCandidates
      ? policyApprovedCloseNumbers(decisions)
      : [];
    const resolvedApproved = [...new Set([...approved, ...policyApproved])].sort((a, b) => a - b);
    if (mode === 'apply') {
      await db.update(prReconciliationRuns)
        .set({ approvedPrNumbers: resolvedApproved })
        .where(scopedToTenant(prReconciliationRuns, args.tenantId, eq(prReconciliationRuns.id, runId)));
    }

    for (let offset = 0; offset < decisions.length; offset += 100) {
      const batch = decisions.slice(offset, offset + 100).map(({ pr, taskId, ticket, decision }) => ({
        runId, tenantId: args.tenantId, repoId: repo.id, prNumber: pr.number, prUrl: pr.url,
        title: pr.title, headBranch: pr.headBranch, taskId, taskStatus: ticket?.status ?? null,
        classification: decision.classification, recommendedAction: decision.recommendedAction,
        confidence: decision.confidence, reasonCodes: decision.reasonCodes,
        checkSummary: decision.checkSummary,
        evidence: {
          headOid: pr.headOid, author: pr.author, createdAt: pr.createdAt, updatedAt: pr.updatedAt,
          changedFiles: pr.changedFiles, additions: pr.additions, deletions: pr.deletions,
          mergeable: pr.mergeable, mergeStateStatus: pr.mergeStateStatus,
          ticketSource: internalByNumber.get(pr.number)?.taskId != null ? 'builderforce_pull_request' : (taskId != null ? 'github_text' : null),
        },
      }));
      if (batch.length) await db.insert(prReconciliationItems).values(batch);
    }

    let applied = 0;
    if (mode === 'apply') {
      const approvedSet = new Set(resolvedApproved);
      for (const item of decisions.filter((d) => approvedSet.has(d.pr.number))) {
        if (item.decision.classification !== 'close_candidate' || item.decision.confidence !== 'high') {
          errorCount++;
          await recordError(db, {
            runId, tenantId: args.tenantId, repoId: repo.id, prNumber: item.pr.number,
            phase: 'action', code: 'ACTION_NOT_ALLOWED',
            details: { classification: item.decision.classification, confidence: item.decision.confidence },
          }, new Error('Approved PR is not a high-confidence close candidate; no action was taken'));
          continue;
        }
        try {
          const response = await fetchFn(`${githubBase(repo.host)}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${item.pr.number}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${resolved.token}`,
              Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
              'User-Agent': 'Builderforce-PR-Reconciler/1.0', 'X-GitHub-Api-Version': '2022-11-28',
            },
            body: JSON.stringify({ state: 'closed' }),
          });
          if (!response.ok) throw new ReconciliationError('GITHUB_CLOSE_FAILED', `GitHub returned HTTP ${response.status} while closing PR #${item.pr.number}`, {
            status: response.status, response: (await response.text().catch(() => '')).slice(0, 2_000),
          });
          await db.update(prReconciliationItems).set({ appliedAction: 'close', appliedAt: new Date() }).where(scopedToTenant(
            prReconciliationItems, args.tenantId,
            eq(prReconciliationItems.runId, runId), eq(prReconciliationItems.prNumber, item.pr.number),
          ));
          await db.update(pullRequests).set({ status: 'closed', updatedAt: new Date() }).where(and(
            eq(pullRequests.repoId, repo.id), eq(pullRequests.number, item.pr.number), eq(pullRequests.tenantId, args.tenantId),
          ));
          applied++;
        } catch (error) {
          errorCount++;
          await recordError(db, { runId, tenantId: args.tenantId, repoId: repo.id, prNumber: item.pr.number, phase: 'action' }, error);
        }
      }
    }

    const summary: Record<string, number> = { total: decisions.length, applied, policyApproved: policyApproved.length };
    for (const { decision } of decisions) summary[decision.classification] = (summary[decision.classification] ?? 0) + 1;
    const status = errorCount > 0 ? 'completed_with_errors' : 'completed';
    await db.update(prReconciliationRuns).set({ status, summary, errorCount, finishedAt: new Date() })
      .where(scopedToTenant(prReconciliationRuns, args.tenantId, eq(prReconciliationRuns.id, runId)));
    return { runId, status, summary, errors: errorCount };
  } catch (error) {
    if (errorCount === 0) {
      errorCount++;
      await recordError(db, { runId, tenantId: args.tenantId, repoId: repo.id, phase: 'configuration' }, error);
    }
    await db.update(prReconciliationRuns).set({ status: 'failed', errorCount, finishedAt: new Date() })
      .where(scopedToTenant(prReconciliationRuns, args.tenantId, eq(prReconciliationRuns.id, runId)));
    throw error;
  }
}

export async function listReconciliationRuns(db: Db, tenantId: number, repoId?: string, limit = 25) {
  const rows = await db.select().from(prReconciliationRuns).where(repoId
    ? and(eq(prReconciliationRuns.tenantId, tenantId), eq(prReconciliationRuns.repoId, repoId))
    : eq(prReconciliationRuns.tenantId, tenantId))
    .orderBy(desc(prReconciliationRuns.startedAt)).limit(Math.min(Math.max(limit, 1), 100));
  return rows;
}

export async function getReconciliationDiagnostics(db: Db, tenantId: number, runId: string) {
  const [run] = await db.select().from(prReconciliationRuns).where(and(
    eq(prReconciliationRuns.id, runId), eq(prReconciliationRuns.tenantId, tenantId),
  )).limit(1);
  if (!run) return null;
  const [items, errors] = await Promise.all([
    db.select().from(prReconciliationItems).where(and(eq(prReconciliationItems.runId, runId), eq(prReconciliationItems.tenantId, tenantId)))
      .orderBy(prReconciliationItems.prNumber),
    db.select().from(prReconciliationErrors).where(and(eq(prReconciliationErrors.runId, runId), eq(prReconciliationErrors.tenantId, tenantId)))
      .orderBy(desc(prReconciliationErrors.createdAt)),
  ]);
  const persistedSummary = (run.summary ?? {}) as Record<string, number>;
  return {
    run, items, errors,
    verification: {
      persistedItemCount: items.length,
      summaryItemCount: Number(persistedSummary.total ?? 0),
      itemCountMatches: items.length === Number(persistedSummary.total ?? 0),
      persistedErrorCount: errors.length,
      summaryErrorCount: run.errorCount,
      errorCountMatches: errors.length === run.errorCount,
      dryRunHadNoActions: run.mode !== 'dry_run' || items.every((item) => item.appliedAction == null),
      allActionsWereExplicitlyApproved: items.filter((item) => item.appliedAction != null)
        .every((item) => (run.approvedPrNumbers as number[]).includes(item.prNumber)),
    },
  };
}
