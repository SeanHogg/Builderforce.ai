/**
 * draftPrPorts — the REAL ports behind `draftPrForCi`: the repository's workflows, the ONE task PR-open
 * step, and the bookkeeping that settles the single-PR claim. Kept apart from the pure decision
 * (`draftPrForCi`) so that decision loads, and is tested, without the database, the PR client or the
 * provider readers.
 *
 * Per-run memory lives in this object's closure (it is built once per agent invocation): the workflow read is
 * made once, and a repository that cannot have the early draft (a PR for the branch already exists that is not
 * ours, or GitHub refuses drafts on its plan) is remembered so no later finish attempt retries the provider.
 */
import type { Db } from '../../infrastructure/database/connection';
import { reportCaughtError, reportedFallback } from '../observability/caughtErrorReporter';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { openClaimedPullRequest, releaseTaskPrClaim } from '../repos/openTaskPullRequest';
import { recordTaskPullRequest } from '../repos/recordTaskPullRequest';
import { listRepoFiles, readRepoFile } from '../repos/readRepoContents';
import { findPlatformDraftPullRequest, PLATFORM_DRAFT_STATUS } from '../repos/platformDraftPullRequest';
import { draftPullRequestText } from '../runtime/runPullRequestText';
import type { DraftPrPorts } from './draftPrForCi';
import { workflowTriggersOnPullRequest } from './workflowTriggers';

const WORKFLOW_DIR = '.github/workflows';
const SOURCE = 'application/ci/draftPrPorts.ts';

/** Whether a workflow definitely runs for a pull request into the run's base; null when the repository could not be read in full. */
async function readPullRequestWorkflow(readCtx: Parameters<typeof listRepoFiles>[0], base: string): Promise<boolean | null> {
  const listed = await listRepoFiles(readCtx, WORKFLOW_DIR).catch(reportedFallback(null, { source: SOURCE, operation: 'listWorkflows', context: { base } }));
  if (!listed?.ok) return null;
  let complete = true;
  for (const path of listed.paths.filter((p) => /\.ya?ml$/i.test(p))) {
    const read = await readRepoFile(readCtx, path).catch(reportedFallback(null, { source: SOURCE, operation: 'readWorkflow', context: { path } }));
    if (!read?.ok) { complete = false; continue; }
    if (workflowTriggersOnPullRequest(read.content, base)) return true;
  }
  return complete ? false : null;
}

/** The real ports for one task's repository. GitHub only: the workflows are read from `.github/workflows`. */
export function draftPrPorts(a: {
  db: Db; repoCtx: TicketRepoContext; task: { id: number; title: string }; agentLabel: string; tenantId: number;
  /** The run opening the draft: the marker that makes the row the platform's own. */
  executionId: number;
  record: (result: string, detail: Record<string, unknown>) => Promise<void>;
}): DraftPrPorts {
  const { repoCtx, db, tenantId } = a;
  const readCtx = { ...repoCtx, ref: repoCtx.branch };
  let workflow: boolean | undefined; // the repository's workflows, read once per run
  let unavailable = false; // the early draft cannot be had for this run: stop asking
  return {
    record: a.record,
    draftOpen: async () => !!(await findPlatformDraftPullRequest(db, { tenantId, taskId: a.task.id, repoId: repoCtx.repoId, branch: repoCtx.branch }).catch(reportedFallback(null, { source: SOURCE, operation: 'findPlatformDraft', context: { taskId: a.task.id } }))),
    hasPullRequestWorkflow: async () => {
      if (repoCtx.provider !== 'github' || unavailable) return false;
      workflow ??= (await readPullRequestWorkflow(readCtx, repoCtx.base)) ?? undefined;
      return workflow === true;
    },
    openDraft: async () => {
      const claim: { retook?: boolean; at?: Date } = {};
      const pr = await openClaimedPullRequest(db, tenantId, a.task.id, {
        provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
        token: repoCtx.token, head: repoCtx.branch, base: repoCtx.base,
        ...draftPullRequestText({ taskId: a.task.id, taskTitle: a.task.title, agentLabel: a.agentLabel }),
        draft: true,
      }, claim).catch((error): { ok: false; code: 'provider_error'; reason: string } => ({ ok: false, code: 'provider_error', reason: error instanceof Error ? error.message : 'pr failed' }));
      if (!pr.ok) {
        if ('claimLost' in pr) return { ok: false, exists: true, reason: 'the task already has a pull request' };
        // GitHub refuses a draft on a private repository of a free plan. Not an error to retry, and never a non-draft PR mid-run.
        if (pr.code === 'draft_unsupported') unavailable = true;
        return { ok: false, exists: false, reason: pr.reason };
      }
      // A PR for this branch that this call did NOT create is someone else's: left alone, and no early draft for this run.
      // The one exception is the recovery of OUR OWN earlier open (a dead claim, no record): the provider reports it a draft.
      if (pr.existing && !(claim.retook && pr.draft === true)) {
        unavailable = true;
        await releaseTaskPrClaim(db, tenantId, a.task.id, claim.at);
        return { ok: false, exists: true, reason: 'a pull request for this branch already exists' };
      }
      // The DURABLE record of who opened it (`platformDraftPullRequest`): a `draft` row plus the task's PR stamp naming the
      // same number, written in ONE transaction. If it fails the claim stays held, so the recovery above finds the PR once
      // the claim goes stale instead of opening a second one.
      try {
        await recordTaskPullRequest(db, {
          tenantId, segmentId: repoCtx.segmentId, projectId: repoCtx.projectId, repoId: repoCtx.repoId,
          taskId: a.task.id, provider: repoCtx.provider, number: pr.number, url: pr.url,
          branchName: repoCtx.branch, baseBranch: repoCtx.base, status: PLATFORM_DRAFT_STATUS,
          platformDraftExecutionId: a.executionId,
        });
      } catch (error) {
        reportCaughtError(error, { source: SOURCE, operation: 'recordDraftPr' });
        return { ok: false, exists: false, reason: `draft PR #${pr.number} opened but not recorded; it is recovered once the claim expires` };
      }
      return pr;
    },
  };
}
