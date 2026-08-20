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
  projects,
  pullRequests,
  tasks,
} from '../../infrastructure/database/schema';
import { TaskPriority, TaskStatus } from '../../domain/shared/types';
import { isResolveError, resolveRepoCredential } from '../repos/resolveRepoCredential';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordManagerActionOnChange, stateFingerprint } from '../manager/managerActionJournal';
import { withDirectTaskKey } from '../task/taskKeys';
import {
  classifyPullRequest,
  extractTaskId,
  type ReconciliationCheck,
  type ReconciliationPrInput,
  type ReconciliationDecision,
} from './prReconciliationClassifier';

type FetchLike = typeof fetch;

/** Bump when scheduled apply semantics change so an old run cannot postpone rollout validation. */
export const PR_RECONCILIATION_POLICY_VERSION = 4;

export interface GithubPrSnapshot extends ReconciliationPrInput {
  url: string;
  baseBranch: string;
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
          number: number; title: string; body: string; url: string; isDraft: boolean;
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
        number title body url isDraft headRefName baseRefName headRefOid
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
        number: node.number, title: node.title, body: node.body, url: node.url,
        headBranch: node.headRefName, baseBranch: node.baseRefName, headOid: node.headRefOid, isDraft: node.isDraft,
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

/** Canonical CI state consumed by the existing manager merge/remediation queue. */
export function canonicalBuildState(decision: ReconciliationDecision): {
  buildStatus: 'failure' | 'pending' | 'success' | null;
  buildError: string | null;
} {
  const { checkSummary } = decision;
  if (checkSummary.failed > 0) {
    const failed = [...checkSummary.changeSpecificFailures, ...checkSummary.sharedInfrastructureFailures];
    return { buildStatus: 'failure', buildError: failed.length > 0 ? failed.join(', ') : 'GitHub checks failed' };
  }
  if (checkSummary.pending > 0) return { buildStatus: 'pending', buildError: null };
  if (checkSummary.total > 0) return { buildStatus: 'success', buildError: null };
  return { buildStatus: null, buildError: null };
}

/**
 * Persist how each non-close PR was handed off. These are queue dispositions, not
 * destructive provider actions; diagnostics deliberately approval-check only `close`.
 */
export function reconciliationQueueAction(
  decision: ReconciliationDecision,
  hasValidTicket: boolean,
): string | null {
  if (!hasValidTicket) return 'quarantine_investigate';
  switch (decision.recommendedAction) {
    case 'review': return 'queue_review';
    case 'repair_pr': return 'queue_repair_pr';
    case 'repair_infrastructure': return 'queue_infrastructure';
    case 'wait': return 'queue_wait';
    case 'investigate': return 'queue_investigate';
    case 'close': return null;
  }
}

export const isDependencyBot = (author: string | null | undefined): boolean =>
  /^(?:app\/)?dependabot(?:\[bot\])?$/i.test(author ?? '');

/**
 * Dependabot PRs intentionally have no BuilderForce task reference. Give each one
 * its own durable ticket so normal review/sign-off/merge policy can govern it; one
 * shared ticket would be completed by the first merge and make every sibling stale.
 */
export async function ensureDependencyReviewTask(
  db: Db,
  args: {
    tenantId: number; projectId: number; repoId: string; prNumber: number; prUrl: string;
    title: string; body: string; headBranch: string;
  },
): Promise<{ id: number; status: string; completedAt: Date | null; description: string | null } | null> {
  const [existing] = await db.select({
    id: tasks.id, status: tasks.status, completedAt: tasks.completedAt, description: tasks.description,
  })
    .from(tasks).where(scopedToTenant(tasks, args.tenantId, eq(tasks.projectId, args.projectId), eq(tasks.githubPrNumber, args.prNumber))).limit(1);
  if (existing) {
    if (existing.status.toLowerCase() === TaskStatus.DONE) {
      const [reopened] = await db.update(tasks).set({
        status: TaskStatus.READY, completedAt: null, updatedAt: new Date(),
      }).where(scopedToTenant(tasks, args.tenantId, eq(tasks.id, existing.id))).returning({
        id: tasks.id, status: tasks.status, completedAt: tasks.completedAt, description: tasks.description,
      });
      return reopened ?? existing;
    }
    return existing;
  }

  const [project] = await db.select({ key: projects.key }).from(projects)
    .where(scopedToTenant(projects, args.tenantId, eq(projects.id, args.projectId))).limit(1);
  if (!project) return null;
  const description = [
    `Review automated dependency pull request #${args.prNumber}.`,
    '',
    `GitHub: ${args.prUrl}`,
    `Branch: ${args.headBranch}`,
    '',
    'Validate compatibility and security impact, require the normal checks and sign-offs, then merge or close the PR.',
    args.body.trim() ? `\nProvider summary:\n${args.body.trim().slice(0, 4_000)}` : '',
  ].filter(Boolean).join('\n');
  return withDirectTaskKey(db, args.projectId, project.key, async (key) => {
    const [created] = await db.insert(tasks).values({
      projectId: args.projectId, key,
      title: `Dependency PR #${args.prNumber}: ${args.title}`.slice(0, 500),
      description, status: TaskStatus.READY, priority: TaskPriority.HIGH,
      source: 'pr_reconciler', githubPrUrl: args.prUrl, githubPrNumber: args.prNumber,
      gitBranch: args.headBranch, explicitRepoId: args.repoId,
      startDate: new Date(), updatedAt: new Date(),
    }).returning({
      id: tasks.id, status: tasks.status, completedAt: tasks.completedAt, description: tasks.description,
    });
    if (!created) throw new Error(`Could not create dependency review ticket for PR #${args.prNumber}`);
    return created;
  });
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

    const internalRows = await db.select({
      id: pullRequests.id, number: pullRequests.number, taskId: pullRequests.taskId,
      updatedAt: pullRequests.updatedAt,
    }).from(pullRequests).where(and(
      eq(pullRequests.repoId, repo.id), eq(pullRequests.tenantId, args.tenantId),
    )).orderBy(desc(pullRequests.updatedAt), desc(pullRequests.id));
    // First row wins after deterministic newest-first ordering. A pre-migration
    // duplicate can no longer make association depend on database heap order.
    const internalByNumber = new Map<number, (typeof internalRows)[number]>();
    for (const row of internalRows) {
      if (row.number != null && !internalByNumber.has(row.number)) internalByNumber.set(row.number, row);
    }
    const extractedByPr = new Map(githubPrs.map((pr) => [pr.number, extractTaskId(pr.title, pr.body, pr.headBranch)]));
    const candidateTaskIds = [...new Set(githubPrs.flatMap((pr) => [
      internalByNumber.get(pr.number)?.taskId,
      extractedByPr.get(pr.number),
    ]).filter((id): id is number => id != null))];
    const taskIds = candidateTaskIds;
    const taskRows = taskIds.length === 0 ? [] : await db.select({
      id: tasks.id, status: tasks.status, completedAt: tasks.completedAt, description: tasks.description,
    })
      .from(tasks).where(scopedToTenant(tasks, args.tenantId, eq(tasks.projectId, repo.projectId), inArray(tasks.id, taskIds)));
    const taskById = new Map(taskRows.map((t) => [t.id, t]));
    const taskRefByPr = new Map<number, number | null>();
    for (const pr of githubPrs) {
      const stored = internalByNumber.get(pr.number)?.taskId ?? null;
      const extracted = extractedByPr.get(pr.number) ?? null;
      // A stale/cross-project stored link must not suppress a valid reference in
      // the current GitHub title/body/branch.
      const valid = stored != null && taskById.has(stored)
        ? stored
        : extracted != null && taskById.has(extracted) ? extracted : null;
      taskRefByPr.set(pr.number, valid);
    }

    // Dependency bots do not know BuilderForce task syntax. Create one review
    // ticket per PR before classification so they enter the same governed path.
    if (mode === 'apply') {
      for (const pr of githubPrs.filter((item) => isDependencyBot(item.author) && taskRefByPr.get(item.number) == null)) {
        const ticket = await ensureDependencyReviewTask(db, {
          tenantId: args.tenantId, projectId: repo.projectId, repoId: repo.id, prNumber: pr.number,
          prUrl: pr.url, title: pr.title, body: pr.body, headBranch: pr.headBranch,
        });
        if (ticket) {
          taskById.set(ticket.id, ticket);
          taskRefByPr.set(pr.number, ticket.id);
        } else {
          errorCount++;
          await recordError(db, {
            runId, tenantId: args.tenantId, repoId: repo.id, prNumber: pr.number,
            phase: 'action', code: 'DEPENDENCY_TICKET_FAILED',
          }, new Error(`Could not create or recover a dependency review ticket for PR #${pr.number}`));
        }
      }
    }
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

    // Reconciliation is the inventory boundary; the manager is the policy boundary.
    // Persist EVERY GitHub PR. The manager merge query requires a valid task link, so
    // unlinked rows are visible/auditable without becoming an orphan merge back door.
    const canonicalByNumber = new Map(internalByNumber);
    if (mode === 'apply') {
      const missing = decisions.filter((item) => !internalByNumber.has(item.pr.number));
      if (missing.length > 0) {
        const inserted = await db.insert(pullRequests).values(missing.map(({ pr, taskId, decision }) => {
          const build = canonicalBuildState(decision);
          return {
            tenantId: args.tenantId, segmentId: repo.segmentId ?? null,
            projectId: repo.projectId, repoId: repo.id, taskId,
            provider: 'github', number: pr.number, url: pr.url,
            branchName: pr.headBranch, baseBranch: pr.baseBranch,
            status: pr.isDraft ? 'draft' : 'open',
            buildStatus: build.buildStatus, buildError: build.buildError,
            createdAt: new Date(pr.createdAt), updatedAt: new Date(),
          };
        })).onConflictDoNothing().returning({
          id: pullRequests.id, number: pullRequests.number, taskId: pullRequests.taskId,
          updatedAt: pullRequests.updatedAt,
        });
        for (const row of inserted) if (row.number != null) canonicalByNumber.set(row.number, row);
      }

      // Existing rows can predate ticket extraction and CI ingestion. Update every
      // provider-open row (including a concurrent insert ignored above) in bounded
      // parallel batches; this is intentionally before item persistence so a
      // failed handoff is visible as a failed run, never a misleading "queued" item.
      for (let offset = 0; offset < decisions.length; offset += 25) {
        await Promise.all(decisions.slice(offset, offset + 25).map(({ pr, taskId, decision }) => {
          const build = canonicalBuildState(decision);
          return db.update(pullRequests).set({
            taskId, url: pr.url, branchName: pr.headBranch, baseBranch: pr.baseBranch,
            status: pr.isDraft ? 'draft' : 'open',
            externalTicketRef: taskId == null
              ? (isDependencyBot(pr.author) ? 'dependency-review-unlinked' : 'reconciliation-unlinked')
              : null,
            buildStatus: build.buildStatus, buildError: build.buildError, updatedAt: new Date(),
          }).where(and(
            eq(pullRequests.tenantId, args.tenantId), eq(pullRequests.repoId, repo.id),
            eq(pullRequests.number, pr.number),
          ));
        }));
      }
      const refreshed = githubPrs.length === 0 ? [] : await db.select({
        id: pullRequests.id, number: pullRequests.number, taskId: pullRequests.taskId,
        updatedAt: pullRequests.updatedAt,
      }).from(pullRequests).where(and(
        eq(pullRequests.repoId, repo.id), eq(pullRequests.tenantId, args.tenantId),
        inArray(pullRequests.number, githubPrs.map((pr) => pr.number)),
      )).orderBy(desc(pullRequests.updatedAt), desc(pullRequests.id));
      for (const row of refreshed) {
        if (row.number != null && !canonicalByNumber.has(row.number)) canonicalByNumber.set(row.number, row);
      }
    }

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
      const batch = decisions.slice(offset, offset + 100).map(({ pr, taskId, ticket, decision }) => {
        const queueAction = mode === 'apply'
          ? reconciliationQueueAction(decision, taskId != null && ticket != null)
          : null;
        return ({
        runId, tenantId: args.tenantId, repoId: repo.id, prNumber: pr.number, prUrl: pr.url,
        title: pr.title, headBranch: pr.headBranch, taskId, taskStatus: ticket?.status ?? null,
        classification: decision.classification, recommendedAction: decision.recommendedAction,
        confidence: decision.confidence, reasonCodes: decision.reasonCodes,
        checkSummary: decision.checkSummary,
        appliedAction: null,
        appliedAt: null,
        evidence: {
          headOid: pr.headOid, author: pr.author, createdAt: pr.createdAt, updatedAt: pr.updatedAt,
          changedFiles: pr.changedFiles, additions: pr.additions, deletions: pr.deletions,
          mergeable: pr.mergeable, mergeStateStatus: pr.mergeStateStatus,
          handoff: queueAction,
          ticketSource: internalByNumber.get(pr.number)?.taskId != null ? 'builderforce_pull_request' : (taskId != null ? 'github_text' : null),
        },
      });
      });
      if (batch.length) await db.insert(prReconciliationItems).values(batch);
    }

    let applied = 0;
    let queued = 0;
    let journaled = 0;
    let repairTicketsReopened = 0;
    let reviewTicketsQueued = 0;
    if (mode === 'apply') {
      // A journal string is not a queue. Put green PRs into the lane consumed by
      // ManagerService.coordinatePullRequests so its reviewer/sign-off workflow
      // can actually see and assign them on the next sweep.
      const reviewTaskIds = [...new Set(decisions
        .filter(({ decision, taskId }) => decision.classification === 'ready_for_review' && taskId != null)
        .map(({ taskId }) => taskId as number))];
      if (reviewTaskIds.length) {
        const moved = await db.update(tasks).set({
          status: TaskStatus.IN_REVIEW,
          completedAt: null,
          updatedAt: new Date(),
        }).where(scopedToTenant(tasks, args.tenantId, eq(tasks.projectId, repo.projectId), inArray(tasks.id, reviewTaskIds))).returning({ id: tasks.id });
        reviewTicketsQueued = moved.length;
      }

      // Every PR targets the same moving base. Activating hundreds of repair
      // tickets in parallel creates hundreds of soon-to-be-stale branches and an
      // execution retry storm. Activate exactly one stable head; the next sweep
      // advances naturally after that PR merges or closes.
      const repairHead = decisions
        .filter(({ decision, taskId }) => decision.classification === 'repair' && taskId != null)
        .sort((a, b) => Date.parse(a.pr.createdAt) - Date.parse(b.pr.createdAt) || a.pr.number - b.pr.number)[0];
      if (repairHead?.taskId != null) {
        const ticket = taskById.get(repairHead.taskId);
        const marker = `[PR reconciliation repair #${repairHead.pr.number}]`;
        const repairNote = `${marker} Repair the existing pull request at ${repairHead.pr.url}. ${repairHead.decision.reasonCodes.join(', ')}. Sync the latest ${repairHead.pr.baseBranch}, fix the reported conflict/check failure, run the relevant checks, and push to the existing ${repairHead.pr.headBranch} branch; do not open a replacement PR.`;
        const description = ticket && 'description' in ticket && typeof ticket.description === 'string'
          ? ticket.description
          : '';
        const [activated] = await db.update(tasks).set({
          status: TaskStatus.IN_PROGRESS,
          completedAt: null,
          description: description.includes(marker) ? description : `${description}\n\n${repairNote}`.trim(),
          updatedAt: new Date(),
        }).where(scopedToTenant(tasks, args.tenantId, eq(tasks.id, repairHead.taskId))).returning({ id: tasks.id });
        repairTicketsReopened = activated ? 1 : 0;
      }

      for (const item of decisions.filter(({ decision }) => decision.recommendedAction !== 'close')) {
        const canonical = canonicalByNumber.get(item.pr.number);
        if (!canonical) {
          errorCount++;
          await recordError(db, {
            runId, tenantId: args.tenantId, repoId: repo.id, prNumber: item.pr.number,
            phase: 'persistence', code: 'CANONICAL_PR_MISSING',
          }, new Error(`PR #${item.pr.number} could not be handed to the manager queue`));
          continue;
        }
        const handoff = reconciliationQueueAction(item.decision, item.taskId != null && item.ticket != null) ?? 'queue_investigate';
        const wrote = await recordManagerActionOnChange(db, {
          tenantId: args.tenantId, projectId: repo.projectId,
          taskId: item.taskId, prId: canonical.id, actionType: 'reconcile_pr',
          stateKey: `pr-reconciliation:${repo.id}:${item.pr.number}`,
          fingerprint: stateFingerprint([
            item.pr.headOid, item.taskId, item.ticket?.status, item.decision.classification,
            item.decision.checkSummary.failed, item.decision.checkSummary.pending,
          ]),
          summary: `PR #${item.pr.number} reconciled: ${handoff}.`,
          detail: {
            runId, handoff, classification: item.decision.classification,
            reasonCodes: item.decision.reasonCodes, taskStatus: item.ticket?.status ?? null,
          },
        });
        queued++;
        if (wrote) journaled++;
        await db.update(prReconciliationItems).set({
          appliedAction: handoff, appliedAt: new Date(),
        }).where(and(
          eq(prReconciliationItems.tenantId, args.tenantId),
          eq(prReconciliationItems.runId, runId), eq(prReconciliationItems.prNumber, item.pr.number),
        ));
      }

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

    const summary: Record<string, number> = {
      policyVersion: PR_RECONCILIATION_POLICY_VERSION,
      total: decisions.length,
      applied,
      queued,
      journaled,
      repairTicketsReopened,
      reviewTicketsQueued,
      quarantined: decisions.filter(({ taskId, ticket }) => taskId == null || ticket == null).length,
      policyApproved: policyApproved.length,
    };
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
  const appliedItems = items.filter((item) => item.appliedAction === 'close');
  const routedItems = items.filter((item) => item.appliedAction != null && item.appliedAction !== 'close');
  return {
    run, items, errors,
    verification: {
      persistedItemCount: items.length,
      summaryItemCount: Number(persistedSummary.total ?? 0),
      itemCountMatches: items.length === Number(persistedSummary.total ?? 0),
      persistedErrorCount: errors.length,
      summaryErrorCount: run.errorCount,
      errorCountMatches: errors.length === run.errorCount,
      persistedAppliedCount: appliedItems.length,
      summaryAppliedCount: Number(persistedSummary.applied ?? 0),
      appliedCountMatches: appliedItems.length === Number(persistedSummary.applied ?? 0),
      persistedRoutedCount: routedItems.length,
      summaryRoutedCount: Number(persistedSummary.routed ?? 0),
      routedCountMatches: routedItems.length === Number(persistedSummary.routed ?? 0),
      dryRunHadNoActions: run.mode !== 'dry_run' || items.every((item) => item.appliedAction == null),
      allActionsWereExplicitlyApproved: appliedItems
        .every((item) => (run.approvedPrNumbers as number[]).includes(item.prNumber)),
    },
  };
}
