/**
 * Complete a delta ticket when a PUSH TO THE DEFAULT BRANCH carries its change.
 *
 * `tickets.from_delta` opens its ticket in `in_review`, and two paths already close it: the
 * run's own push to base (`completeShippedTickets`) and a merged pull request
 * (`completeDeltaOnMerge`). Neither sees a DIRECT push to the default branch by a person,
 * another session or a later run — so those tickets piled up in review. This is the third
 * path, fed by the GitHub `push` webhook.
 *
 * ── PR MERGES ARE NOT THIS PATH'S BUSINESS ───────────────────────────────────
 * Every merged pull request ALSO fires a default-branch push. Those commits belong to the
 * merge closer, which deliberately refuses anything but an exact identity — if this path
 * looked at them, file coverage would close the very tickets the merge path refused. So
 * before either rule runs, PR-merge commits are removed:
 *
 *   • the whole push, when its head (`after`) is a merge commit sha recorded on a
 *     `pull_requests` row for a linked project, or when any commit's subject is GitHub's
 *     `Merge pull request #N` (a merge-commit push lists the PR branch's commits too);
 *   • a single commit whose subject ends in a squash merge's `(#N)` (optionally followed by
 *     the closing quote of a revert's quoted subject);
 *   • a single commit whose subject starts with `Revert "` — a revert un-ships a change, it
 *     never ships one.
 *
 * ── HOW THE TWO RULES STAY SAFE ──────────────────────────────────────────────
 * (a) An explicit reference in a commit message — `task-<id>`, `builderforce/task-<id>`,
 *     `ticket/<id>`. A bare `#N` is NOT accepted: on GitHub it means an issue or PR number.
 * (b) The files it changed, admitted only as a proof rather than a guess:
 *   • the candidate is an `in_review` delta ticket (a `work_deltas` row names it) in a
 *     project linked to the pushed repo — the same three conditions the merge path checks;
 *   • the pushed commits cover EVERY file the delta recorded — partial overlap is the norm on
 *     an active repo and never matches — and the delta recorded at least one file;
 *   • no other candidate records the IDENTICAL file set. When two do, the push cannot say
 *     which change it shipped; neither is closed by files, and the ambiguity is returned.
 *
 * ── THE COMMIT-TIME WINDOW IS ADVISORY ───────────────────────────────────────
 * Only commits dated after the ticket's first delta row count. That date is the commit's
 * own timestamp, which the CLIENT writes (and a rebase or amend can preserve an old one), so
 * it narrows the window but cannot be trusted to bound it. That is why rule (b) also relies
 * on the PR-merge exclusion above rather than on time alone. The window never WIDENS on bad
 * input: a future timestamp is clamped to the push's receipt time, and an unparseable one
 * drops the commit from both rules.
 *
 * Closing goes through {@link closeDeltaTickets} — the same review-gated path the merge
 * webhook uses — with the commit sha as the hold journal's evidence.
 */

import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { pullRequests, tasks, workDeltas } from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import { resolveRepoLinks, type RepoLink } from '../contributors/activityIngest';
import { normalizeRepoPath } from '../repos/repoPath';
import { closeDeltaTickets } from './closeDeltaTickets';

/** One commit of a push, in the shape a provider webhook can supply. */
export interface PushedCommit {
  /** The commit sha. */
  id: string;
  /** ISO-8601 commit timestamp (client-written). Unparseable ⇒ the commit is ignored. */
  timestamp: string | null;
  message: string;
  /**
   * Repo-relative paths the commit added, modified or removed — or null when the provider
   * did not give a complete list (absent, or truncated on a huge commit). A null list makes
   * the commit count for rule (a) only: an unknown file list can never prove coverage.
   */
  files: string[] | null;
}

export interface DefaultBranchPushRef {
  /** `owner/repo` — resolved to every linked (tenant, project). */
  repoFullName: string;
  /** The pushed ref, e.g. `refs/heads/main`. */
  ref: string;
  /** The repo's default branch as the payload states it. Absent ⇒ nothing is done. */
  defaultBranch: string | null;
  /** The pushed head sha (`after`), checked against recorded PR merge shas. */
  after?: string | null;
  commits: PushedCommit[];
}

export type DeltaPushRule = 'reference' | 'files';

export interface DeltaPushMatch { taskId: number; sha: string; rule: DeltaPushRule }

export interface DeltaPushAmbiguity {
  /** The normalized file set more than one candidate recorded. */
  files: string[];
  /** The candidates the push covered by files but could not tell apart (none closed by files). */
  taskIds: number[];
}

export interface DeltaPushOutcome {
  /** Tickets moved to done. */
  closed: DeltaPushMatch[];
  /** Matched tickets left in review because the board's review lane needs a person. */
  heldForReview: DeltaPushMatch[];
  /** File-coverage matches that were refused because another candidate records the same files. */
  ambiguous: DeltaPushAmbiguity[];
  /** Why nothing was attempted — a webhook that no-ops must be able to say so. */
  reason?: string;
}

/** A delta ticket the push may close, with its recorded change folded across delta rows. */
export interface DeltaPushCandidate {
  taskId: number;
  tenantId: number;
  /** Normalized, de-duplicated union of every file the ticket's deltas recorded. */
  files: string[];
  /** When the ticket's FIRST delta row was recorded — commits must be newer than this. */
  recordedAt: Date;
}

const subjectOf = (message: string): string => (message.split('\n')[0] ?? '').trim();

/** GitHub's merge-commit subject — the whole push is a PR merge. */
const PR_MERGE_SUBJECT = /^Merge pull request #\d+/i;
/** A squash merge's `(#N)` suffix, optionally closed by a revert's quote. */
const SQUASH_SUFFIX = /\(#\d+\)"?$/;
const REVERT_SUBJECT = /^Revert "/;

/** True when the commit itself is a PR merge (merge commit or squash). PURE. */
export function isPullRequestMergeCommit(message: string): boolean {
  const subject = subjectOf(message);
  return PR_MERGE_SUBJECT.test(subject) || SQUASH_SUFFIX.test(subject);
}

/** True when the commit can never ship a delta: a PR merge or a revert. PURE. */
export function isExcludedCommit(message: string): boolean {
  return isPullRequestMergeCommit(message) || REVERT_SUBJECT.test(subjectOf(message));
}

/**
 * Ticket ids a commit message references explicitly: `task-<id>`,
 * `builderforce/task-<id>`, `ticket/<id>`. A bare `#<n>` is deliberately not one — on
 * GitHub it names an issue or pull request. PURE.
 */
export function referencedTaskIds(message: string): Set<number> {
  const ids = new Set<number>();
  const patterns = [
    /(?<![\w/-])(?:builderforce\/)?task-(\d+)(?!\w)/gi,
    /(?<![\w/-])ticket\/(\d+)(?!\d)/gi,
  ];
  for (const re of patterns) {
    for (const m of message.matchAll(re)) {
      const id = Number(m[1]);
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  return ids;
}

/** The commit's time for the window, clamped to receipt; null when unparseable. */
function commitTime(c: PushedCommit, receivedAt: Date): number | null {
  const t = c.timestamp ? Date.parse(c.timestamp) : NaN;
  if (Number.isNaN(t)) return null;
  return Math.min(t, receivedAt.getTime());
}

interface MatchedTicket extends DeltaPushMatch { tenantId: number }

/**
 * Decide which candidates a push shipped. PURE — every rule in the module header is pinned
 * by tests against this function. Commits are taken in payload order (oldest first, as
 * GitHub sends them), so the evidence sha is the NEWEST qualifying commit. The caller has
 * already dropped pushes that are PR merges; per-commit exclusions happen here.
 */
export function matchPushToDeltas(
  candidates: readonly DeltaPushCandidate[],
  commits: readonly PushedCommit[],
  receivedAt: Date,
): { matches: MatchedTicket[]; ambiguous: DeltaPushAmbiguity[] } {
  const timed = commits.flatMap((c) => {
    const at = commitTime(c, receivedAt);
    if (at == null || isExcludedCommit(c.message)) return [];
    return [{ c, at, refs: referencedTaskIds(c.message), files: c.files ? new Set(c.files.map(normalizeRepoPath)) : null }];
  });
  const after = (cand: DeltaPushCandidate) => timed.filter((t) => t.at > cand.recordedAt.getTime());

  const matches: MatchedTicket[] = [];
  const byReference = new Set<number>();

  // (a) explicit reference.
  for (const cand of candidates) {
    const hit = after(cand).filter((t) => t.refs.has(cand.taskId)).pop();
    if (!hit) continue;
    matches.push({ taskId: cand.taskId, tenantId: cand.tenantId, sha: hit.c.id, rule: 'reference' });
    byReference.add(cand.taskId);
  }

  // (b) full file coverage — only for a delta that recorded files.
  const setKey = (files: readonly string[]) => [...files].sort().join('\n');
  const keyCount = new Map<string, number>();
  for (const cand of candidates) {
    if (cand.files.length === 0) continue;
    const k = setKey(cand.files);
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  const ambiguousByKey = new Map<string, DeltaPushAmbiguity>();
  for (const cand of candidates) {
    if (byReference.has(cand.taskId) || cand.files.length === 0) continue;
    const eligible = after(cand).filter((t) => t.files !== null);
    const touched = new Set<string>();
    for (const t of eligible) for (const f of t.files!) touched.add(f);
    if (!cand.files.every((f) => touched.has(f))) continue;
    const k = setKey(cand.files);
    if ((keyCount.get(k) ?? 0) > 1) {
      const entry = ambiguousByKey.get(k) ?? { files: [...cand.files].sort(), taskIds: [] };
      entry.taskIds.push(cand.taskId);
      ambiguousByKey.set(k, entry);
      continue;
    }
    const evidence = eligible.filter((t) => cand.files.some((f) => t.files!.has(f))).pop()!;
    matches.push({ taskId: cand.taskId, tenantId: cand.tenantId, sha: evidence.c.id, rule: 'files' });
  }
  return { matches, ambiguous: [...ambiguousByKey.values()] };
}

/** Fold the candidate query's rows (one per delta row) into one candidate per ticket. */
export function foldDeltaRows(
  rows: ReadonlyArray<{ taskId: number; tenantId: number; projectId: number | null; status: string; files: unknown; recordedAt: Date }>,
  linkedProjects: ReadonlySet<string>,
): DeltaPushCandidate[] {
  const byTask = new Map<number, { tenantId: number; files: Set<string>; recordedAt: Date }>();
  for (const r of rows) {
    // Defence in depth: the query already scopes these; a row outside them is never a candidate.
    if (r.status !== TaskStatus.IN_REVIEW) continue;
    if (r.projectId == null || !linkedProjects.has(`${r.tenantId}:${r.projectId}`)) continue;
    const entry = byTask.get(r.taskId) ?? { tenantId: r.tenantId, files: new Set<string>(), recordedAt: r.recordedAt };
    if (Array.isArray(r.files)) {
      for (const f of r.files) {
        const path = typeof f === 'string' ? normalizeRepoPath(f) : '';
        if (path) entry.files.add(path);
      }
    }
    // The EARLIEST row opens the window, so commits shipping an earlier row's files count.
    if (r.recordedAt < entry.recordedAt) entry.recordedAt = r.recordedAt;
    byTask.set(r.taskId, entry);
  }
  return [...byTask].map(([taskId, e]) => ({ taskId, tenantId: e.tenantId, files: [...e.files], recordedAt: e.recordedAt }));
}

const nothing = (reason: string): DeltaPushOutcome => ({ closed: [], heldForReview: [], ambiguous: [], reason });

const tenantIdsOf = (links: readonly RepoLink[]) => [...new Set(links.map((l) => l.tenantId))];
const projectIdsOf = (links: readonly RepoLink[]) => [...new Set(links.map((l) => l.projectId!))];

/** True when `after` is the merge commit of a pull request recorded for a linked project. */
async function isRecordedPullRequestMerge(db: Db, links: readonly RepoLink[], after: string | null | undefined): Promise<boolean> {
  if (!after || /^0+$/.test(after)) return false;
  const rows = await db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(and(
      inArray(pullRequests.tenantId, tenantIdsOf(links)),
      inArray(pullRequests.projectId, projectIdsOf(links)),
      eq(pullRequests.mergeSha, after),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Close the delta tickets a default-branch push shipped. Best-effort and fail-closed:
 * anything it cannot establish leaves every ticket exactly where it was, with a reason.
 */
export async function completeDeltaTicketsOnPush(
  env: Env,
  db: Db,
  push: DefaultBranchPushRef,
  receivedAt: Date = new Date(),
): Promise<DeltaPushOutcome> {
  const defaultBranch = push.defaultBranch?.trim();
  if (!defaultBranch) return nothing('the push payload names no default branch');
  if (push.ref !== `refs/heads/${defaultBranch}`) return nothing(`'${push.ref}' is not the default branch '${defaultBranch}'`);
  if (push.commits.length === 0) return nothing('the push carries no commits');
  if (push.commits.some((c) => PR_MERGE_SUBJECT.test(subjectOf(c.message)))) {
    return nothing('the push is a pull-request merge; the merge closer owns it');
  }

  const links = (await resolveRepoLinks(db, push.repoFullName)).filter((l) => l.projectId != null);
  if (links.length === 0) return nothing(`repo '${push.repoFullName}' is not linked to a project`);

  if (await isRecordedPullRequestMerge(db, links, push.after)) {
    return nothing('the pushed head is a recorded pull-request merge commit; the merge closer owns it');
  }

  const times = push.commits.map((c) => commitTime(c, receivedAt)).filter((t): t is number => t != null);
  if (times.length === 0) return nothing('no commit in the push has a readable timestamp');
  const newest = Math.max(...times);
  const rows = await db
    .select({
      taskId: tasks.id, tenantId: workDeltas.tenantId, projectId: tasks.projectId, status: tasks.status,
      files: workDeltas.files, recordedAt: workDeltas.createdAt,
    })
    .from(tasks)
    .innerJoin(workDeltas, and(eq(workDeltas.taskId, tasks.id), eq(workDeltas.tenantId, tasks.tenantId)))
    .where(and(
      inArray(tasks.tenantId, tenantIdsOf(links)),
      inArray(tasks.projectId, projectIdsOf(links)),
      eq(tasks.status, TaskStatus.IN_REVIEW),
      lt(tasks.createdAt, new Date(newest)),
    ));

  const linked = new Set(links.map((l) => `${l.tenantId}:${l.projectId}`));
  const candidates = foldDeltaRows(rows, linked);
  if (candidates.length === 0) return nothing('no delta ticket awaiting review in the linked projects');

  const { matches, ambiguous } = matchPushToDeltas(candidates, push.commits, receivedAt);
  if (ambiguous.length > 0) {
    console.warn(
      `[delta-push] ${push.repoFullName}@${defaultBranch}: ${ambiguous.map((a) => `tickets ${a.taskIds.join(', ')} record the same files`).join('; ')}; completing none of them by files`,
    );
  }

  const { completed } = await closeDeltaTickets(env, db, 'delta_push', matches.map((m) => ({
    tenantId: m.tenantId, taskId: m.taskId,
    evidence: `commit ${m.sha.slice(0, 12)} on ${defaultBranch} (${m.rule === 'reference' ? 'named in the commit message' : 'covers every recorded file'})`,
  })));
  const done = new Set(completed);
  const strip = ({ taskId, sha, rule }: MatchedTicket): DeltaPushMatch => ({ taskId, sha, rule });
  return {
    closed: matches.filter((m) => done.has(m.taskId)).map(strip),
    heldForReview: matches.filter((m) => !done.has(m.taskId)).map(strip),
    ambiguous,
    ...(matches.length === 0 && ambiguous.length === 0 ? { reason: 'no commit names or fully covers an awaiting delta ticket' } : {}),
  };
}
