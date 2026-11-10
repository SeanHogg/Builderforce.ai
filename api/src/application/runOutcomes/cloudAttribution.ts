/**
 * Per-run commit attribution for a CLOUD run (PRD 41 §D1 `followup-fix` step 4), recorded at
 * `cloudFinalize`. Every cloud write is a one-file commit whose subject carries the run's own
 * marker (`<Verb> <path> — task #<id> · run #<executionId> (<agent>)`, `agentCommitMarker.ts`),
 * so the run's commits are exactly the branch commits carrying that marker, and each one names
 * its path.
 *
 * The branch listing is the one `recordRunRollbackSnapshot` already made (handed over through
 * its `onListed`), never a second provider call. Best-effort: the caller catches and reports;
 * attribution never changes a run's outcome.
 *
 * Spelling: run id `cloud:<executionId>` (`cloudRunId`, the shared run-id space) and repository
 * `https://<host>/<owner>/<repo>` (`repositoryIdentityOf`), the way a device spells a remote.
 * `committedAt` is the finalize time: the provider listing carries no commit dates, and every
 * one of the run's commits happened before its finalize.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { BranchCommit } from '../repos/branchLifecycle';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { cloudRunId } from '../../domain/execution/cloudRunId';
import { repositoryIdentityOf } from '../../domain/runOutcomes/repositoryIdentity';
import { PATH_MAX, type ParsedAttribution } from '../../domain/runOutcomes/runOutcomeRecord';
import { parseAgentCommitSubject, runCommitMarker } from '../runtime/agentCommitMarker';
import { runOutcomesDatabase, upsertAttributions } from './runOutcomeStore';

/** A removal leaves no content of the run's in the commit, so it attributes nothing. */
const CONTENT_FREE_VERBS: ReadonlySet<string> = new Set(['Remove']);

/** The run's attributions among a branch's commits (pure). */
export function cloudRunAttributions(
  commits: readonly BranchCommit[],
  run: { taskId: number; executionId: number; branch: string; committedAt: Date },
): ParsedAttribution[] {
  const marker = runCommitMarker(run.taskId, run.executionId);
  const seen = new Set<string>();
  const out: ParsedAttribution[] = [];
  for (const commit of commits) {
    if (!commit.sha || !commit.message.includes(marker)) continue;
    const subject = parseAgentCommitSubject(commit.message, marker);
    if (!subject || CONTENT_FREE_VERBS.has(subject.verb) || subject.path.length > PATH_MAX) continue;
    const commitSha = commit.sha.toLowerCase();
    const key = `${commitSha}\0${subject.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ commitSha, path: subject.path, branch: run.branch, addedLines: null, committedAt: run.committedAt, source: 'cloud-finalize' });
  }
  return out;
}

/** Record a finished cloud run's attributions. Returns how many were written. */
export async function recordCloudRunAttributions(
  core: Db,
  args: { tenantId: number; executionId: number; taskId: number; repoCtx: TicketRepoContext; commits: readonly BranchCommit[]; now?: Date },
): Promise<number> {
  const rows = cloudRunAttributions(args.commits, {
    taskId: args.taskId, executionId: args.executionId, branch: args.repoCtx.branch, committedAt: args.now ?? new Date(),
  });
  if (rows.length === 0) return 0;
  await upsertAttributions(runOutcomesDatabase(core), args.tenantId, cloudRunId(args.executionId), repositoryIdentityOf(args.repoCtx), rows);
  return rows.length;
}
