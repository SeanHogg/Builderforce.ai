/**
 * taskRepoSet — the per-task repo SET (migration 0956) and the router that sends
 * each file write to the right repo in it.
 *
 * ── THE INVARIANT THIS PRESERVES ────────────────────────────────────────────
 * A task with fewer than two bindings is the single-repo case and is handled by
 * exactly the code that handled it before: {@link resolveTicketRepoContext}
 * resolves ONE repo, every write lands on its ticket branch, and finalize opens
 * ONE PR. {@link resolveTaskRepoRouter} degenerates to `forPath() => primary` in
 * that case, and {@link openTaskRepoSetPullRequests} returns an empty list after
 * a single indexed read. Multi-repo is additive; the common case is untouched.
 *
 * ── WHAT MULTI-REPO ADDS ────────────────────────────────────────────────────
 * With 2+ bindings, `forPath` routes each write by `pathGlobs` (per-task
 * `match_hints` override, else the repo's project-wide hints) through the pure
 * {@link routeWritePathToRepo}; the receiving binding's `writes_count` is
 * incremented so finalize KNOWS which repos actually received code. Finalize then
 * opens (or updates) a PR per repo whose counter moved and skips the ones that
 * got none — a bound-but-untouched repo must not sprout an empty PR.
 *
 * Every repo in the set gets the SAME branch name (`builderforce/task-<id>`, via
 * {@link ticketBranchName}): one ticket, one branch name, N repos, N PRs.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projectRepositories, tasks, taskRepoBindings } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { routeWritePathToRepo, type RepoSetCandidate } from './resolveRepo';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import {
  resolveTicketRepoContext,
  ticketBranchName,
  type TicketRepoContext,
} from './commitFileAsPendingChange';

/** One row of a task's repo set, joined with the repo it points at. */
export interface TaskRepoBinding {
  id: string;
  repoId: string;
  provider: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
  isDefault: boolean;
  /** Effective routing hints: the per-task override, else the repo's own. */
  matchHints: string | null;
  branch: string | null;
  writesCount: number;
  prUrl: string | null;
  prNumber: number | null;
  prStatus: string | null;
}

/**
 * The task's bound repo set, newest binding last. Tenant-scoped on
 * `task_repo_bindings.tenant_id` (trigger-derived from the task, 0956).
 */
export async function listTaskRepoBindings(
  db: Db,
  tenantId: number,
  taskId: number,
): Promise<TaskRepoBinding[]> {
  const rows = await db
    .select({
      id: taskRepoBindings.id,
      repoId: taskRepoBindings.repoId,
      overrideHints: taskRepoBindings.matchHints,
      branch: taskRepoBindings.branch,
      writesCount: taskRepoBindings.writesCount,
      prUrl: taskRepoBindings.prUrl,
      prNumber: taskRepoBindings.prNumber,
      prStatus: taskRepoBindings.prStatus,
      provider: projectRepositories.provider,
      owner: projectRepositories.owner,
      repo: projectRepositories.repo,
      defaultBranch: projectRepositories.defaultBranch,
      isDefault: projectRepositories.isDefault,
      repoHints: projectRepositories.matchHints,
    })
    .from(taskRepoBindings)
    .innerJoin(projectRepositories, eq(projectRepositories.id, taskRepoBindings.repoId))
    .where(scopedToTenant(taskRepoBindings, tenantId, eq(taskRepoBindings.taskId, taskId)))
    .orderBy(taskRepoBindings.createdAt);

  return rows.map((r) => ({
    id: r.id,
    repoId: r.repoId,
    provider: r.provider,
    owner: r.owner,
    repo: r.repo,
    defaultBranch: r.defaultBranch,
    isDefault: r.isDefault,
    // Per-task override wins; otherwise the repo's project-wide hints route.
    matchHints: r.overrideHints?.trim() ? r.overrideHints : r.repoHints,
    branch: r.branch,
    writesCount: r.writesCount,
    prUrl: r.prUrl,
    prNumber: r.prNumber,
    prStatus: r.prStatus,
  }));
}

/**
 * Replace a task's repo set with `repoIds`. Idempotent: existing bindings are
 * kept (so their branch / write counters / PR survive a re-bind), missing ones
 * are inserted, and removed ones are deleted. Only repos belonging to the task's
 * OWN project in THIS tenant may be bound — a cross-project id is dropped rather
 * than trusted.
 */
export async function setTaskRepoBindings(
  db: Db,
  tenantId: number,
  taskId: number,
  repoIds: string[],
): Promise<{ ok: true; bound: string[] } | { ok: false; reason: string }> {
  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)))
    .limit(1);
  if (!task) return { ok: false, reason: 'task not found' };

  const wanted = [...new Set(repoIds.map((r) => r.trim()).filter(Boolean))];
  const valid = wanted.length
    ? await db
        .select({ id: projectRepositories.id })
        .from(projectRepositories)
        .where(
          and(
            eq(projectRepositories.tenantId, tenantId),
            eq(projectRepositories.projectId, task.projectId),
            inArray(projectRepositories.id, wanted),
          ),
        )
    : [];
  const allowed = valid.map((v) => v.id);

  const existing = await db
    .select({ id: taskRepoBindings.id, repoId: taskRepoBindings.repoId })
    .from(taskRepoBindings)
    .where(scopedToTenant(taskRepoBindings, tenantId, eq(taskRepoBindings.taskId, taskId)));
  const have = new Set(existing.map((e) => e.repoId));

  const toAdd = allowed.filter((id) => !have.has(id));
  const toRemove = existing.filter((e) => !allowed.includes(e.repoId)).map((e) => e.id);

  if (toAdd.length) {
    await db
      .insert(taskRepoBindings)
      // tenant_id/segment_id are derived by the 0956 trigger; passing tenantId
      // keeps the INSERT statically tenant-scoped for check-tenant-scope.mjs.
      .values(toAdd.map((repoId) => ({ tenantId, taskId, repoId })))
      .onConflictDoNothing();
  }
  if (toRemove.length) {
    await db
      .delete(taskRepoBindings)
      .where(scopedToTenant(taskRepoBindings, tenantId, inArray(taskRepoBindings.id, toRemove)));
  }
  return { ok: true, bound: allowed };
}

// ---------------------------------------------------------------------------
// The write router
// ---------------------------------------------------------------------------

export interface TaskRepoRouter {
  /** The task's primary repo — what the single-repo path has always resolved. */
  primary: TicketRepoContext | null;
  /** Why `primary` is null (empty when it resolved). */
  reason: string;
  /** Every writable repo in the set, primary first. Length ≤ 1 ⇒ single-repo,
   *  which is also exactly when `forPath` is a constant function. */
  all: TicketRepoContext[];
  /** Which repo should receive a write at `path`. Null only when nothing resolved. */
  forPath(path: string): TicketRepoContext | null;
}

/**
 * Resolve a task's repo router. `primary` may be supplied by a caller that has
 * already resolved it (the durable loop resolves once per run) so the common
 * single-repo path costs ONE extra indexed read and never re-decrypts a token.
 */
export async function resolveTaskRepoRouter(
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
  primary?: { ctx: TicketRepoContext | null; reason: string },
): Promise<TaskRepoRouter> {
  const resolvedPrimary = primary
    ? primary
    : await resolveTicketRepoContext(db, secret, tenantId, taskId).then((r) =>
        r.ok ? { ctx: r.ctx, reason: '' } : { ctx: null, reason: r.reason },
      );
  const primaryCtx = resolvedPrimary.ctx;

  const bindings = await listTaskRepoBindings(db, tenantId, taskId).catch(() => [] as TaskRepoBinding[]);
  // The set SPANS only when it names a repo other than the primary. A task with no
  // bindings, or bound only to the repo it already resolves to (which is what the
  // write recorder creates for every ordinary single-repo run), is the single-repo
  // case byte-for-byte: one branch, one PR, `forPath` always the primary.
  const extras = bindings.filter((b) => b.repoId !== primaryCtx?.repoId);
  if (extras.length === 0 || !primaryCtx) {
    return {
      primary: primaryCtx,
      reason: resolvedPrimary.reason,
      all: primaryCtx ? [primaryCtx] : [],
      forPath: () => primaryCtx,
    };
  }

  const extraCtxs: TicketRepoContext[] = [];
  const hintsByRepoId = new Map<string, string | null>();
  for (const b of bindings) hintsByRepoId.set(b.repoId, b.matchHints);
  for (const b of extras) {
    const ctx = await buildBindingContext(db, secret, tenantId, taskId, b);
    if (ctx) extraCtxs.push(ctx);
  }

  const all = [primaryCtx, ...extraCtxs];
  if (extraCtxs.length === 0) {
    // Bound, but none of the extras has a usable credential — behave as single-repo
    // rather than dropping writes into a repo we cannot commit to.
    return { primary: primaryCtx, reason: resolvedPrimary.reason, all: [primaryCtx], forPath: () => primaryCtx };
  }

  const candidates: RepoSetCandidate[] = all.map((c) => ({
    id: c.repoId,
    isPrimary: c.repoId === primaryCtx.repoId,
    matchHints: hintsByRepoId.get(c.repoId) ?? null,
  }));

  return {
    primary: primaryCtx,
    reason: resolvedPrimary.reason,
    all,
    forPath(path: string) {
      const decided = routeWritePathToRepo(path, candidates);
      return all.find((c) => c.repoId === decided?.repoId) ?? primaryCtx;
    },
  };
}

/** A bound repo's commit context: its own credential, the shared ticket branch. */
async function buildBindingContext(
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
  binding: TaskRepoBinding,
): Promise<TicketRepoContext | null> {
  const resolved = await resolveRepoCredential(db, secret, tenantId, binding.repoId);
  if (isResolveError(resolved)) return null;
  return {
    provider: resolved.repo.provider,
    host: resolved.repo.host,
    owner: resolved.repo.owner,
    repo: resolved.repo.repo,
    token: resolved.token,
    branch: binding.branch?.trim() || ticketBranchName(taskId),
    base: (resolved.repo.defaultBranch ?? 'main').trim(),
    repoId: resolved.repo.id,
    segmentId: resolved.repo.segmentId,
    projectId: resolved.repo.projectId,
  };
}

/**
 * Record that `repoId` received a file write for this task. This is the fact
 * finalize reads to decide whether a repo earns a PR, so it is written at the
 * moment of the commit — never inferred afterwards from a path list.
 *
 * Upserts the binding, so a write routed to a repo that was bound implicitly
 * (e.g. the primary on a single-repo task, which has no binding row) still
 * records a countable write without the caller special-casing it.
 */
export async function recordRepoWrite(
  db: Db,
  tenantId: number,
  taskId: number,
  ctx: TicketRepoContext,
): Promise<void> {
  const now = new Date();
  await db
    .insert(taskRepoBindings)
    .values({
      tenantId,
      taskId,
      repoId: ctx.repoId,
      branch: ctx.branch,
      baseBranch: ctx.base,
      writesCount: 1,
      lastWriteAt: now,
    })
    .onConflictDoUpdate({
      target: [taskRepoBindings.taskId, taskRepoBindings.repoId],
      set: {
        writesCount: sql`${taskRepoBindings.writesCount} + 1`,
        branch: ctx.branch,
        baseBranch: ctx.base,
        lastWriteAt: now,
        updatedAt: now,
      },
    });
}

/** Stamp the PR a repo's branch produced onto its binding row. */
export async function recordBindingPullRequest(
  db: Db,
  tenantId: number,
  taskId: number,
  repoId: string,
  pr: { url: string; number: number; status: string },
): Promise<void> {
  await db
    .update(taskRepoBindings)
    .set({ prUrl: pr.url, prNumber: pr.number, prStatus: pr.status, updatedAt: new Date() })
    .where(
      scopedToTenant(
        taskRepoBindings,
        tenantId,
        eq(taskRepoBindings.taskId, taskId),
        eq(taskRepoBindings.repoId, repoId),
      ),
    );
}

/**
 * The repos in a task's set that received writes and are NOT the primary — i.e.
 * exactly the repos finalize must open an extra PR for. Empty for every
 * single-repo task, which is what keeps the common finalize path unchanged.
 */
export async function listSpanningRepoWrites(
  db: Db,
  tenantId: number,
  taskId: number,
  primaryRepoId: string | null,
): Promise<TaskRepoBinding[]> {
  const bindings = await listTaskRepoBindings(db, tenantId, taskId);
  return bindings.filter((b) => b.writesCount > 0 && b.repoId !== primaryRepoId && !b.prUrl);
}

/** Newest recorded binding row per repo for a task, for the PR-set read model. */
export async function listTaskRepoPullRequests(
  db: Db,
  tenantId: number,
  taskId: number,
): Promise<Array<{ repoId: string; slug: string; branch: string | null; prUrl: string | null; prNumber: number | null; prStatus: string | null; writesCount: number }>> {
  const bindings = await listTaskRepoBindings(db, tenantId, taskId);
  return bindings
    .slice()
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    .map((b) => ({
      repoId: b.repoId,
      slug: `${b.owner}/${b.repo}`,
      branch: b.branch,
      prUrl: b.prUrl,
      prNumber: b.prNumber,
      prStatus: b.prStatus,
      writesCount: b.writesCount,
    }));
}
