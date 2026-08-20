/**
 * ContextReconciler wiring — assembled context routed through Evermind cognition.
 *
 * `runContextSource.ts` says WHAT a run is told. This module decides how much of it the
 * run still needs to HEAR, by putting every block through the published
 * `EvermindCognition.commit()` pipeline (Canonicalize → Recall incumbent → Evaluate
 * evidence → Reconcile → write-through) against a per-scope fact store.
 *
 * Two pieces:
 *   • {@link runContextFactStore} — a `CognitionFactStore` over `run_context_state`
 *     (0947). Narrow by design: `remember` / `recall` / `forget`, exactly the interface
 *     the cognition layer declares, so `EvermindCognition` takes it with no adapter.
 *   • {@link buildRunContext} — assemble → reconcile → hand back the delta.
 *
 * The reconciler itself is NOT reimplemented here; it lives in
 * `@builderforce/run-context` so the on-prem runner and the VS Code client consume the
 * same class over the same contract.
 *
 * Best-effort throughout: if cognition or its store is unavailable, the caller gets the
 * FULL context back. Losing the delta costs tokens; losing the context loses the run.
 */
import { EvermindCognition } from '@seanhogg/builderforce-memory';
import {
  ContextReconciler,
  deltaEnvelope,
  type RunContextEnvelope,
  type ReconciledRunContext,
} from '@builderforce/run-context';
import { and, eq } from 'drizzle-orm';
import { projects, runContextState, tasks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { assembleRunContext, runContextScope, type AssembleRunContextParams } from './runContextSource';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** The minimal write-through store the cognition layer needs, over `run_context_state`. */
export interface RunContextFactStore {
  remember(key: string, content: string, opts?: { tags?: string[]; importance?: number; ttlMs?: number }): Promise<void>;
  recall(key: string): Promise<{ content: string } | undefined>;
  forget(key: string): Promise<void>;
}

/**
 * A tenant + scope-bound fact store. Every statement is filtered on BOTH, so one run can
 * never read or clobber another's beliefs — the store is the tenant-scoping boundary for
 * this table (the row carries a scalar `tenant_id`, no FK, per the operational-database
 * convention this schema file follows).
 */
export function runContextFactStore(db: Db, tenantId: number, scope: string): RunContextFactStore {
  const where = (key: string) =>
    and(eq(runContextState.tenantId, tenantId), eq(runContextState.scope, scope), eq(runContextState.subjectKey, key));
  return {
    async remember(key, content, opts) {
      await db
        .insert(runContextState)
        .values({ tenantId, scope, subjectKey: key.slice(0, 512), content, importance: opts?.importance ?? 0.6 })
        .onConflictDoUpdate({
          target: [runContextState.tenantId, runContextState.scope, runContextState.subjectKey],
          set: { content, importance: opts?.importance ?? 0.6, updatedAt: new Date() },
        });
    },
    async recall(key) {
      const [row] = await db
        .select({ content: runContextState.content })
        .from(runContextState)
        .where(where(key.slice(0, 512)))
        .limit(1);
      return row ? { content: row.content } : undefined;
    },
    async forget(key) {
      await db.delete(runContextState).where(where(key.slice(0, 512)));
    },
  };
}

export interface BuildRunContextResult {
  /** What the surface should send THIS turn (the delta when reconciliation ran). */
  envelope: RunContextEnvelope;
  /** The full, unreconciled assembly — for observability and for `reconcile: false`. */
  full: RunContextEnvelope;
  /** Subjects elided because the run already holds them verbatim. */
  unchanged: string[];
  /** Present only when reconciliation actually ran. */
  reconciled?: ReconciledRunContext;
}

export interface BuildRunContextOptions extends AssembleRunContextParams {
  /**
   * false → skip reconciliation and return the whole assembly. The right choice for a
   * COLD start (a fresh conversation has been told nothing, so every block is a delta
   * anyway) and for a caller that deliberately wants the full picture.
   */
  reconcile?: boolean;
  /** Surface-LOCAL blocks (workspace, prior changes, directives, capabilities, tooling)
   *  the api cannot know. They reconcile through the same pipeline as the platform ones. */
  extraBlocks?: RunContextEnvelope['blocks'];
  /**
   * Drop blocks the scope already holds verbatim. Default FALSE here, deliberately: all
   * three of today's surfaces REBUILD their prompt every turn (a system prompt is
   * replaced, not accumulated), so a block elided from the assembly is a block the model
   * can no longer see. They still get the reconciliation that matters — one belief per
   * subject, and a CHANGE marked as a change. A surface that appends to a retained
   * conversation may opt in.
   */
  elideUnchanged?: boolean;
}

/**
 * Assemble the run's context and reconcile it against what the run already knows.
 *
 * The ONE entry point every surface reaches — `prepareCloudRun` in-process, the on-prem
 * runner and the VS Code client through `presentation/routes/runContextRoutes.ts`.
 */
export async function buildRunContext(
  env: Env,
  db: Db,
  opts: BuildRunContextOptions,
): Promise<BuildRunContextResult> {
  const assembled = await assembleRunContext(env, db, opts);
  const full: RunContextEnvelope = opts.extraBlocks?.length
    ? { ...assembled, blocks: [...assembled.blocks, ...opts.extraBlocks] }
    : assembled;

  if (opts.reconcile === false) return { envelope: full, full, unchanged: [] };

  try {
    const scope = runContextScope(opts);
    const cognition = new EvermindCognition({ store: runContextFactStore(db, opts.tenantId, scope) });
    const reconciled = await new ContextReconciler(cognition, { elideUnchanged: opts.elideUnchanged === true }).reconcile(full);
    return {
      envelope: deltaEnvelope(full, reconciled),
      full,
      unchanged: reconciled.unchanged,
      reconciled,
    };
  } catch (error) {
    // Reconciliation is an OPTIMISATION. A failure must cost tokens, never context.
    reportCaughtError(error, {
      source: 'application/runtime/runContextService.ts',
      operation: 'buildRunContext',
      level: 'warning',
      context: { logMessage: '[run-context] reconciliation failed — sending the full context', details: { tenantId: opts.tenantId, projectId: opts.projectId, taskId: opts.taskId, error } },
    });
    return { envelope: full, full, unchanged: [] };
  }
}

/**
 * Drop everything a scope was told. Called when a ticket's run history is reset, so the
 * next run starts from a cold context rather than a delta against a run that no longer
 * exists. Best-effort.
 */
export async function forgetRunContextScope(db: Db, tenantId: number, scope: string): Promise<void> {
  await db
    .delete(runContextState)
    .where(and(eq(runContextState.tenantId, tenantId), eq(runContextState.scope, scope)))
    .catch((error) => reportCaughtError(error, { source: 'application/runtime/runContextService.ts', operation: 'forgetRunContextScope', level: 'warning', context: { details: { tenantId, scope, error } } }));
}

/**
 * The CLIENT-surface entry point: verify the caller owns the project, resolve the ticket
 * it named, and build the run context.
 *
 * Lives here rather than in the route because a route may not query a table — and because
 * both doors (`/api/projects/...` for VS Code, `/api/agent/projects/...` for the on-prem
 * runner) need exactly these three steps. Returns `null` when the project does not exist
 * inside this tenant, which the route renders as a 404 (the IDOR guard).
 */
export async function resolveRunContextRequest(
  env: Env,
  db: Db,
  params: BuildRunContextOptions,
): Promise<BuildRunContextResult | null> {
  const { tenantId, projectId, taskId } = params;
  if (!Number.isInteger(projectId) || projectId <= 0) return null;

  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (!owned) return null;

  // The ticket is the run's GOAL, so a cross-tenant or cross-project id must yield
  // nothing rather than a row: filter on all three columns, not just the id.
  let task: { id: number; title: string; description: string | null } | undefined;
  if (taskId) {
    const [row] = await db
      .select({ id: tasks.id, title: tasks.title, description: tasks.description })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId), eq(tasks.projectId, projectId)))
      .limit(1);
    if (row) task = row;
  }

  return buildRunContext(env, db, { ...params, ...(task ? { task } : {}) });
}
