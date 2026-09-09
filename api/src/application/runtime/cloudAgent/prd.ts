/**
 * The cloud run's PRD and workspace surface — what an agent READS about its
 * ticket, and how what it writes lands in the repo.
 *
 * Split out of `cloudAgentEngine.ts` alongside `agent.ts` and `routing.ts` — see
 * `agent.ts` for why the 4,117-line original was broken up.
 *
 * Two halves that belong together because one is the input to the other:
 *
 *  • {@link loadWorkspaceContext} is what the run is TOLD — the ticket's PRD, the
 *    repo file listing and the branch diff, resolved once and cached, so a
 *    multi-step loop does not re-read the same tree on every tick.
 *  • {@link buildPrdCapability} is what the run may WRITE back, and the
 *    commit/append path underneath it ({@link ensureTaskPrd},
 *    {@link recordPrdDirective}, `writeTaskPrdRevision`, `landPrdChange`) is what
 *    makes that write a real, reviewable repo change rather than a database blob.
 */
import { integrationCredentialSecret } from '../../integrations/integrationCredentialSecret';
import { and, eq } from 'drizzle-orm';
import { SYSTEM_ACTOR, recordActivity } from '../../activity/activityLog';
import { CODING_BACKSTOP_MODELS } from '../../llm/LlmProxyService';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import {
  appendTaskPrdRevision, editTaskPrdSection, ensureTaskPrdRecord, findTaskPrimarySpec,
} from '../../prd/taskPrd';
import { resolveTicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { commitPrdAsPendingChange, taskPrdRepoPath } from '../../repos/commitPrdToRepo';
import { listBranchDiff, listRepoFiles } from '../../repos/readRepoContents';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { notifyExecutionSubscribers } from '../executionEvents';
import { getOrSetCached } from '../../../infrastructure/cache/readThroughCache';
import { taskFileChanges, tasks } from '../../../infrastructure/database/schema';
import type { PrdUpdateResult, PrdWriteCapability } from '@builderforce/agent-tools';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';

export async function recordTaskFileChange(
  db: Db,
  tenantId: number,
  taskId: number,
  executionId: number,
  path: string,
  change: 'created' | 'modified' | 'deleted',
  agent: string,
): Promise<void> {
  try {
    await db.insert(taskFileChanges).values({ tenantId, taskId, executionId, path, change, agent });
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgent/prd.ts", operation: "recordTaskFileChange", context: { logMessage: '[cloud-run] task file-change persistence failed', details: { tenantId, taskId, executionId, path, change, error } } });
  }
}

/**
 * The repo the agent will actually run against, surfaced up-front so a WRONG or
 * EMPTY binding is visible BEFORE the model spends a single LLM call. Bundles:
 *   • the bound repo's identity (or why none is bound),
 *   • a compact top-level listing of the base branch + total file count — the
 *     "is this the right repo?" signal (exec #54 returned a conceptual non-answer
 *     because the agent was never shown the repo only contained `agent-runtime`),
 *   • what a PRIOR pass committed to this task's branch (so a re-run reconciles
 *     and cleans up dead files rather than blindly appending).
 *
 * Resolves the ticket repo ONCE (was a separate call per concern). The base-branch
 * tree is slow-changing and re-read on every re-run of the same task, so it is
 * served through the read-through cache keyed by repo+base. Best-effort: any miss
 * yields an empty workspace (never throws — context prep must not fail on this).
 */
export interface WorkspaceContext {
  /** Bound repo identity, or null when no usable repo is bound. */
  repo: { owner: string; repo: string; provider: string; base: string } | null;
  /** Why no repo (when `repo` is null) — surfaced to the agent + the timeline. */
  reason?: string;
  /** Top-level entries (dirs as `name/`, root files as `name`) on the base branch. */
  topLevel: string[];
  /** Total blob count on the base branch (capped by the tree lister). */
  fileCount: number;
  truncated: boolean;
  /** Files a prior pass already committed to this task's branch. */
  priorChanges: Array<{ path: string; status: string }>;
}

export async function loadWorkspaceContext(
  env: Env,
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
): Promise<WorkspaceContext> {
  const empty: WorkspaceContext = { repo: null, topLevel: [], fileCount: 0, truncated: false, priorChanges: [] };
  try {
    const resolved = await resolveTicketRepoContext(db, secret, tenantId, taskId);
    if (!resolved.ok) return { ...empty, reason: resolved.reason };
    const { ctx } = resolved;
    const readCtx = { provider: ctx.provider, host: ctx.host, owner: ctx.owner, repo: ctx.repo, token: ctx.token, ref: ctx.base };

    const [listing, diff] = await Promise.all([
      getOrSetCached(
        env,
        `repo-tree:${ctx.repoId}:${ctx.base}`,
        () => listRepoFiles(readCtx),
        { kvTtlSeconds: 120, l1TtlMs: 30_000 },
      ),
      listBranchDiff({ ...readCtx, ref: ctx.branch }, ctx.base, ctx.branch),
    ]);

    let topLevel: string[] = [];
    let fileCount = 0;
    let truncated = false;
    if (listing.ok) {
      fileCount = listing.paths.length;
      truncated = listing.truncated;
      topLevel = [...new Set(listing.paths.map((p) => {
        const i = p.indexOf('/');
        return i === -1 ? p : `${p.slice(0, i)}/`;
      }))].sort().slice(0, 40);
    }

    return {
      repo: { owner: ctx.owner, repo: ctx.repo, provider: ctx.provider, base: ctx.base },
      topLevel,
      fileCount,
      truncated,
      priorChanges: diff.ok ? diff.files : [],
    };
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgent/prd.ts", operation: "loadWorkspaceContext", context: { logMessage: '[cloud-context] repository snapshot load failed', details: { error } } });
    return empty;
  }
}

/**
 * Task-scoped PRD. Each TASK has its own PRD (via the `task_specs` link), drafted
 * with an attribution header naming the authoring agent (downstream agents append
 * their own attributed updates). The PRD is:
 *   • persisted to its task-scoped spec (PRD tab),
 *   • recorded as an agent-attributed `PRD.md` change (Changes tab),
 *   • committed to the ticket's git branch as a pending change (branch + PR),
 *     via the provider API so it works even on the cloud (no-runtime) path.
 */
/**
 * Resolve the PRD a run works against.
 *
 * Exported for its `readOnly` invariant, which is load-bearing for rehearsal and
 * otherwise untestable: the write path here is the single biggest escaping effect in
 * run PREP (it commits to a real branch), and it runs above the seam the shadow
 * provider decorates. A test pins that `readOnly` never reaches it.
 */
export async function ensureTaskPrd(
  env: Env,
  db: Db,
  executionId: number,
  taskRow: { title: string; description: string | null },
  tenantId: number,
  projectId: number,
  taskId: number,
  agentLabel: string,
  model: string | undefined,
  /**
   * REHEARSAL: read an existing PRD, never create one.
   *
   * Without this a rehearsal would draft a PRD (paid LLM call), persist a `specs`
   * row, COMMIT `PRD.md` to the real ticket branch, record a `task_file_changes`
   * row and notify the execution stream — four escaping effects, before the shadow
   * provider has intercepted anything. The shadow decorator wraps the LOOP; prep runs
   * before it, so the read-only decision has to be made here.
   */
  readOnly = false,
): Promise<string> {
  if (readOnly) {
    const existing = await findTaskPrimarySpec(db, taskId).catch(() => null);
    return existing?.prd?.trim() ?? '';
  }
  // Shared generate→persist→link core (reused by the on-demand endpoint + swimlane gate).
  const ensured = await ensureTaskPrdRecord(db, env, { taskId, tenantId, projectId, title: taskRow.title, description: taskRow.description, agentLabel, model });
  if (!ensured) return '';
  const { prd, status } = ensured;
  if (status === 'reused') return prd; // already had a PRD — no new commit/notification

  await landPrdChange(env, db, {
    executionId, tenantId, taskId, taskTitle: taskRow.title, prd, agentLabel,
    isUpdate: status === 'updated',
    message: (branch) => branch
      ? `📝 ${agentLabel} drafted the PRD and committed it to branch \`${branch}\` (pending change — included in this task's single PR). See the PRD tab + Changes.`
      : `📝 ${agentLabel} drafted the PRD (saved to the PRD tab).`,
  });
  return prd;
}

/**
 * Land a PRD body change as a pending change on the ticket branch: record the
 * attributed task-scoped PRD file change, commit it to the SAME branch the agent's code
 * commits to (single run PR covers it), surface the branch on the ticket, and
 * notify the execution stream. The single PRD-commit path — shared by the
 * first-draft ({@link ensureTaskPrd}) and per-run directive ({@link recordPrdDirective})
 * write-backs so commit/record/notify is never duplicated. Best-effort throughout.
 *
 * Returns the ticket branch the PRD landed on, or null when the repo commit did not
 * happen (no repo bound, or a failed commit that was recorded as a divergence) — the
 * agent-facing `update_prd` tool reports it so the model knows whether its change is on
 * the branch or only in the PRD tab.
 */
async function landPrdChange(
  env: Env,
  db: Db,
  args: {
    executionId: number;
    tenantId: number;
    taskId: number;
    taskTitle: string;
    prd: string;
    agentLabel: string;
    isUpdate: boolean;
    message: (branch: string | null) => string;
  },
): Promise<string | null> {
  const fileChange = args.isUpdate ? 'modified' : 'created';
  const prdPath = taskPrdRepoPath(args.taskId);
  await recordTaskFileChange(db, args.tenantId, args.taskId, args.executionId, prdPath, fileChange, args.agentLabel);

  const committed = await commitPrdAsPendingChange(db, integrationCredentialSecret(env), args.tenantId, args.taskId, args.taskTitle, args.prd, args.agentLabel);
  if (committed.ok) {
    await db.update(tasks)
      .set({ gitBranch: committed.branch, updatedAt: new Date() })
      .where(eq(tasks.id, args.taskId))
      .catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgent/prd.ts", operation: "landPrdChange", context: { logMessage: '[cloud-prd] task branch update failed', details: { tenantId: args.tenantId, taskId: args.taskId, executionId: args.executionId, error } } }));
  } else {
    // The DB PRD copy (specs.prd) stands but the repo task brief commit failed — the copies
    // have DIVERGED. Surface it on the audit trail (a reconcile signal) instead of silently
    // dropping it (PRD §5.7), so an operator/agent can re-land the repo copy.
    await recordActivity(env, db, {
      tenantId: args.tenantId, projectId: null, actor: SYSTEM_ACTOR,
      verb: 'ticket.prd.reconcile_needed',
      targetType: 'task', targetId: String(args.taskId), targetLabel: `#${args.taskId}`,
      summary: `PRD repo commit failed (${committed.reason ?? 'unknown'}) — the DB PRD and repo ${prdPath} have diverged; re-land needed`.slice(0, 300),
      metadata: { reason: committed.reason ?? null, executionId: args.executionId, path: prdPath },
    }).catch((error) => reportCaughtError(error, { source: "application/runtime/cloudAgent/prd.ts", operation: "landPrdChange", context: { logMessage: '[cloud-prd] divergence activity append failed', details: { tenantId: args.tenantId, taskId: args.taskId, executionId: args.executionId, error } } }));
  }

  notifyExecutionSubscribers(args.executionId, {
    type: 'file_change', executionId: args.executionId, path: prdPath, change: fileChange, ts: new Date().toISOString(),
  });
  notifyExecutionSubscribers(args.executionId, {
    type: 'message', executionId: args.executionId, role: 'assistant',
    text: args.message(committed.ok ? committed.branch : null),
    ts: new Date().toISOString(),
  });
  return committed.ok ? committed.branch : null;
}

/**
 * Per-run PRD write-back: record a user directive (a steer to a running run, or a
 * follow-up that starts a new run) as a dated, signed revision on the task's PRD,
 * then land it on the ticket branch. This is what makes the PRD "update per run"
 * instead of being frozen at first draft. Best-effort — never blocks the steer/run.
 */
export async function recordPrdDirective(
  env: Env,
  db: Db,
  args: { executionId: number; tenantId: number; projectId: number; taskId: number; taskTitle: string; agentLabel: string; directive: string },
): Promise<void> {
  await writeTaskPrdRevision(env, db, {
    ...args, mode: 'append', content: args.directive,
    message: (branch) => branch
      ? `📝 ${args.agentLabel} recorded your direction in the PRD and committed the revision to branch \`${branch}\`. See the PRD tab + Changes.`
      : `📝 ${args.agentLabel} recorded your direction as a PRD revision (saved to the PRD tab).`,
  });
}

/**
 * THE ONE PRD write-back a RUN performs — used by the human-steer directive above and
 * by the agent's own `update_prd` tool ({@link buildPrdCapability}).
 *
 * Both are the same two steps: persist through the shared `specs` writer in
 * `application/prd/taskPrd` (append a signed revision, or rewrite one `##` section),
 * then land the new body on the ticket branch through {@link landPrdChange} — the
 * single commit/record/notify path the first draft also uses. Only the timeline
 * message differs, so that is the parameter; there is no second PRD writer anywhere.
 */
async function writeTaskPrdRevision(
  env: Env,
  db: Db,
  args: {
    executionId: number; tenantId: number; projectId: number; taskId: number; taskTitle: string;
    agentLabel: string;
    /** 'append' adds a signed revision block; 'section' rewrites one `## ` section. */
    mode: 'append' | 'section';
    /** The note (append) or the section's complete new body (section). */
    content: string;
    /** Required for 'section': the heading to replace. */
    heading?: string;
    message?: (branch: string | null) => string;
  },
): Promise<PrdUpdateResult> {
  const content = args.content.trim();
  if (!content) return { ok: false, error: 'content is required' };
  const isoTimestamp = new Date().toISOString();

  let prd: string;
  let section: string | undefined;
  if (args.mode === 'section') {
    const heading = (args.heading ?? '').trim();
    if (!heading) return { ok: false, error: 'section is required when mode is "section"' };
    const edited = await editTaskPrdSection(db, {
      taskId: args.taskId, tenantId: args.tenantId, agentLabel: args.agentLabel,
      heading, body: content, isoTimestamp,
    });
    if (!edited.ok) {
      if (edited.reason === 'section_not_found') {
        return {
          ok: false, mode: 'section', sections: edited.sections ?? [],
          error: `this PRD has no section "${heading}". Retry with one of the headings listed in \`sections\`, or use mode "append".`,
        };
      }
      return {
        ok: false, mode: 'section',
        error: edited.reason === 'no_prd'
          ? 'this ticket has no PRD yet, so there is no section to correct — use mode "append" to record the note instead.'
          : 'the PRD could not be saved; try again, or record the note in your finish summary.',
      };
    }
    prd = edited.prd;
    section = edited.section;
  } else {
    const revised = await appendTaskPrdRevision(db, {
      taskId: args.taskId, tenantId: args.tenantId, projectId: args.projectId,
      agentLabel: args.agentLabel, directive: content, executionId: args.executionId, isoTimestamp,
    });
    if (!revised) return { ok: false, mode: 'append', error: 'the PRD revision could not be saved' };
    prd = revised.prd;
  }

  const branch = await landPrdChange(env, db, {
    executionId: args.executionId, tenantId: args.tenantId, taskId: args.taskId, taskTitle: args.taskTitle,
    prd, agentLabel: args.agentLabel, isUpdate: true,
    message: args.message ?? ((b) => (b
      ? `📝 ${args.agentLabel} updated the ticket PRD (${section ? `section "${section}"` : 'new note'}) and committed it to branch \`${b}\`. See the PRD tab + Changes.`
      : `📝 ${args.agentLabel} updated the ticket PRD (${section ? `section "${section}"` : 'new note'}) — saved to the PRD tab.`)),
  });

  return {
    ok: true,
    mode: args.mode === 'section' ? 'section' : 'append',
    ...(section ? { section } : {}),
    ...(branch ? { branch } : {}),
    note: args.mode === 'section'
      ? `Section "${section}" rewritten and signed. Every later run on this ticket now reads your version.`
      : 'Recorded as a dated, signed revision on the ticket PRD. Every later run on this ticket reads it.',
  };
}

/**
 * The `prd.write` backing for a run — one factory, so the durable loop's provider and
 * the container/Actions relay op are the SAME code path rather than two that agree
 * today. Never throws: a PRD write must not be able to kill a run.
 */
export function buildPrdCapability(
  env: Env,
  db: Db,
  ctx: { executionId: number; tenantId: number; projectId: number; taskId: number; taskTitle: string; agentLabel: string },
): PrdWriteCapability {
  const write = async (mode: 'append' | 'section', content: string, heading?: string): Promise<PrdUpdateResult> => {
    try {
      return await writeTaskPrdRevision(env, db, { ...ctx, mode, content, ...(heading ? { heading } : {}) });
    } catch (error) {
      reportCaughtError(error, { source: 'application/runtime/cloudAgent/prd.ts', operation: 'buildPrdCapability', context: { details: { tenantId: ctx.tenantId, executionId: ctx.executionId, mode, error } } });
      return { ok: false, mode, error: error instanceof Error ? error.message : String(error) };
    }
  };
  return {
    append: (note) => write('append', note),
    editSection: (heading, body) => write('section', body, heading),
  };
}

/** The commit subject a run's own write lands under, so a repo history says which
 *  ticket and which agent produced the change. */
export function agentCommitMessage(verb: string, path: string, taskId: number, agentLabel: string, suffix = ''): string {
  return `${verb} ${path} — task #${taskId} (${agentLabel})${suffix}`;
}

/**
 * True when a CLOUD CODING turn was served by a model that is NOT a curated coding
 * model (i.e. it fell through the CODING_MODEL_POOL → CODING_BACKSTOP_MODELS tail,
 * landing on a generalist like the gemini guaranteed backstop). That degradation
 * is invisible in usage rows, so it's the signal a coding run silently ran on a
 * non-coder. `default` / empty means the gateway never reported a resolved model —
 * not a known degradation, so it is not flagged. Pure — unit-testable in isolation.
 */
