/**
 * ContextSource — the ONE assembler for the platform context an agent run receives.
 *
 * Until this module existed, "what is an agent told?" had three different answers, and
 * only one of them was any good:
 *
 *   • cloud   — `prepareCloudRun` assembled PRD + governance + workspace + prior changes
 *               + ticket + capabilities + project memory + Evermind lessons, inline.
 *   • on-prem — `buildEmbeddedSystemPrompt` assembled workspace dir + skills + persona +
 *               bootstrap files. No PRD. No governance. No memory. No strategy.
 *   • VS Code — `buildSystemMessages` assembled the IDE persona + a workspace map + the
 *               editor selection + the limbic block. Same omissions.
 *
 * The api OWNS the data, so the assembler lives here and every surface consumes the same
 * {@link RunContextEnvelope}: the cloud engine in-process, the on-prem runner and the
 * VS Code client over `/api/projects/:id/run-context` (see
 * `presentation/routes/runContextRoutes.ts`). The SHAPE of a block, the renderer, and the
 * reconciler are in `@builderforce/run-context` so no surface has to import api
 * infrastructure to use them.
 *
 * NEW to every surface (cloud included): the STRATEGY block. Objectives + key results are
 * what the work is FOR, and no prompt-assembly path carried them — the agent was told to
 * call `builtin_objectives_update` without ever being shown an objective.
 *
 * Caching: strategy + governance are slow-changing per-project reads on a per-RUN path,
 * so both serve through the canonical read-through cache. Strategy folds in
 * {@link pmoVersionKey} (every OKR write bumps it) and governance folds in the project
 * governance token below, so a write is visible on the next assembly rather than after a
 * TTL. The ticket-scoped blocks (PRD, task) are NOT cached: a PRD is rewritten by the run
 * itself, and serving a stale one would make an agent work from its own superseded draft.
 */
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  RUN_CONTEXT_CONTRACT_VERSION,
  type RunContextBlock,
  type RunContextEnvelope,
} from '@builderforce/run-context';
import {
  keyResults,
  objectiveLinks,
  objectives,
  projectAgents,
  projects,
  specs,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { pmoVersionKey } from '../pmo/pmoCacheKeys';
import { trustNotice } from '../../domain/trust/contentTrust';
import { findTaskPrimarySpec } from '../prd/taskPrd';
import { buildProjectFactsBlock } from '../llm/projectFacts';
import { buildEvermindLessonsBlock } from '../llm/projectEvermind';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** Render order (ascending) — the cloud prompt's existing order, with strategy added. */
export const RUN_CONTEXT_ORDER = {
  role: 10,
  review: 20,
  incident: 30,
  remediation: 40,
  followUp: 50,
  strategy: 55,
  prd: 60,
  governance: 70,
  workspace: 80,
  priorChanges: 90,
  task: 100,
  // System channel.
  coreTooling: 10,
  platformTooling: 20,
  capabilities: 30,
  memory: 40,
  lessons: 50,
} as const;

/**
 * The governance version token, scoped to the TENANT rather than the project.
 *
 * Deliberately coarse: a `project_agents` row with a NULL `project_id` is the agent's
 * identity-level policy and binds it on EVERY project, so a per-project token would leave
 * every other project serving the superseded rules until its own TTL lapsed. One token per
 * tenant makes a governance edit invalidate exactly what it can affect, and governance is
 * edited rarely enough that the extra recomputation is free.
 */
export function projectGovernanceVersionKey(tenantId: number): string {
  return `project-governance:${tenantId}`;
}

/**
 * Invalidate the cached governance block for a project.
 *
 * Called by every route that edits a rule an agent run must honor —
 * `projects.governance` and `project_agents.governance` — so a rules change binds the
 * VERY NEXT run rather than the next run after a TTL. (An architecture-spec edit is
 * bounded by the TTL below instead: `specs` is written from a dozen places, and a token
 * only one of them bumps would be worse than an honest 60s ceiling.)
 */
export async function invalidateProjectGovernance(env: Env, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, projectGovernanceVersionKey(tenantId)).catch((error) =>
    reportCaughtError(error, { source: 'application/runtime/runContextSource.ts', operation: 'invalidateProjectGovernance', level: 'warning', context: { details: { tenantId, error } } }));
}

const GOVERNANCE_TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };
const STRATEGY_TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };
/** Enough to steer a run; more than this is noise in every prompt on the project. */
const MAX_OBJECTIVES = 6;
const MAX_KEY_RESULTS_PER_OBJECTIVE = 4;

/**
 * The project's governance rules + architecture spec + this agent's own rules — the
 * non-PRD context the deliverable must honor.
 *
 * Moved here VERBATIM from `cloudAgentEngine.loadGovernanceContext` (which no longer has
 * its own copy) and given the cache the per-run path always needed. Best-effort: '' on
 * any miss — context assembly must never fail a run.
 */
export async function loadGovernanceContext(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  agentRef?: string,
): Promise<string> {
  const version = await getCacheVersion(env, projectGovernanceVersionKey(tenantId)).catch(() => '0');
  return getOrSetCached(
    env,
    `run-context:governance:${tenantId}:${projectId}:${agentRef ?? '-'}:${version}`,
    async () => {
      const parts: string[] = [];
      try {
        const [spec] = await db
          .select({ archSpec: specs.archSpec })
          .from(specs)
          .where(and(eq(specs.tenantId, tenantId), eq(specs.projectId, projectId)))
          .orderBy(desc(specs.updatedAt))
          .limit(1);
        if (spec?.archSpec?.trim()) parts.push(`## Architecture Spec\n\n${spec.archSpec.trim()}`);
      } catch (error) {
        reportCaughtError(error, { source: 'application/runtime/runContextSource.ts', operation: 'loadGovernanceContext', context: { logMessage: '[run-context] architecture spec load failed', details: { tenantId, projectId, error } } });
      }
      try {
        const [proj] = await db
          .select({ governance: projects.governance })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
          .limit(1);
        if (proj?.governance?.trim()) parts.push(`## Project Rules / Governance (must be followed)\n\n${proj.governance.trim()}`);
      } catch (error) {
        reportCaughtError(error, { source: 'application/runtime/runContextSource.ts', operation: 'loadGovernanceContext', context: { logMessage: '[run-context] project governance load failed', details: { tenantId, projectId, error } } });
      }
      // Per-agent governance (project_agents.governance) — the rules configured for THIS
      // agent specifically. Prefer the project-specific attachment, else the canonical
      // project-less row.
      if (agentRef) {
        try {
          const rows = await db
            .select({ governance: projectAgents.governance, projectId: projectAgents.projectId })
            .from(projectAgents)
            .where(and(
              eq(projectAgents.tenantId, tenantId),
              eq(projectAgents.agentRef, agentRef),
              or(isNull(projectAgents.projectId), eq(projectAgents.projectId, projectId)),
            ));
          const chosen = rows.find((r) => r.projectId === projectId) ?? rows.find((r) => r.projectId == null);
          if (chosen?.governance?.trim()) {
            parts.push(`## Agent Rules / Governance (specific to you — must be followed)\n\n${chosen.governance.trim()}`);
          }
        } catch (error) {
          reportCaughtError(error, { source: 'application/runtime/runContextSource.ts', operation: 'loadGovernanceContext', context: { logMessage: '[run-context] agent governance load failed', details: { tenantId, projectId, agentRef, error } } });
        }
      }
      return parts.join('\n\n');
    },
    GOVERNANCE_TTL,
  ).catch(() => '');
}

/**
 * STRATEGY — the objectives and key results this work advances.
 *
 * The active objectives scoped directly to the project (`objectives.project_id`, 0268)
 * PLUS any objective linked to THIS ticket through `objective_links`, each with its key
 * results and their current measured position. This is the block no surface had: agents
 * were told to update OKR progress with `builtin_objectives_update` while being shown no
 * objective to update.
 *
 * Best-effort: '' on any miss.
 */
export async function loadStrategyContext(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  taskId?: number,
): Promise<string> {
  const version = await getCacheVersion(env, pmoVersionKey(tenantId)).catch(() => '0');
  return getOrSetCached(
    env,
    `run-context:strategy:${tenantId}:${projectId}:${taskId ?? '-'}:${version}`,
    async () => {
      try {
        const linkedIds = taskId
          ? (await db
              .select({ objectiveId: objectiveLinks.objectiveId })
              .from(objectiveLinks)
              .where(and(eq(objectiveLinks.tenantId, tenantId), eq(objectiveLinks.taskId, taskId))))
              .map((r) => r.objectiveId)
          : [];

        const scopeFilter = linkedIds.length
          ? or(eq(objectives.projectId, projectId), inArray(objectives.id, linkedIds))
          : eq(objectives.projectId, projectId);

        const rows = await db
          .select({
            id: objectives.id,
            title: objectives.title,
            description: objectives.description,
            status: objectives.status,
            period: objectives.period,
          })
          .from(objectives)
          .where(and(eq(objectives.tenantId, tenantId), eq(objectives.status, 'active'), scopeFilter))
          .orderBy(desc(objectives.updatedAt))
          .limit(MAX_OBJECTIVES);
        if (rows.length === 0) return '';

        // ONE query for every key result across the selected objectives — never N+1.
        const krs = await db
          .select({
            objectiveId: keyResults.objectiveId,
            title: keyResults.title,
            currentValue: keyResults.currentValue,
            targetValue: keyResults.targetValue,
            unit: keyResults.unit,
            status: keyResults.status,
          })
          .from(keyResults)
          .where(and(eq(keyResults.tenantId, tenantId), inArray(keyResults.objectiveId, rows.map((r) => r.id))));

        const byObjective = new Map<string, typeof krs>();
        for (const kr of krs) {
          const list = byObjective.get(kr.objectiveId) ?? [];
          if (list.length < MAX_KEY_RESULTS_PER_OBJECTIVE) list.push(kr);
          byObjective.set(kr.objectiveId, list);
        }

        const linked = new Set(linkedIds);
        const lines: string[] = [];
        for (const o of rows) {
          const marker = linked.has(o.id) ? ' — **linked to this ticket**' : '';
          lines.push(`### ${o.title}${o.period ? ` (${o.period})` : ''}${marker}`);
          if (o.description?.trim()) lines.push(o.description.trim());
          for (const kr of byObjective.get(o.id) ?? []) {
            const unit = kr.unit ? ` ${kr.unit}` : '';
            lines.push(`- KR: ${kr.title} — ${kr.currentValue}${unit} of ${kr.targetValue}${unit} (${kr.status})`);
          }
          lines.push('');
        }
        return `## Strategic objectives this work serves\n\n`
          + `These are the ACTIVE OKRs for this project. Keep your work aligned to them, and when what `
          + `you ship moves one, record it with the \`builtin_objectives_update\` / `
          + `\`builtin_key_results_update\` tools rather than leaving the goal stale.\n\n`
          + lines.join('\n').trimEnd();
      } catch (error) {
        reportCaughtError(error, { source: 'application/runtime/runContextSource.ts', operation: 'loadStrategyContext', context: { logMessage: '[run-context] strategy load failed', details: { tenantId, projectId, taskId, error } } });
        return '';
      }
    },
    STRATEGY_TTL,
  ).catch(() => '');
}

export interface AssembleRunContextParams {
  tenantId: number;
  projectId: number;
  taskId?: number;
  /** Continuity scope for the reconciler. Defaults to `task:<id>` / `project:<id>`. */
  scope?: string;
  /** Recall query for the memory + lessons blocks (the ticket text, or the user's turn). */
  query?: string;
  /** `ide_agents.id` this run executes as — selects per-agent governance. */
  agentRef?: string;
  /**
   * The ticket, when the caller already has it (the cloud engine does). Supplying it
   * avoids a re-read AND lets the cloud path keep its exact existing task block.
   */
  task?: { id: number; title: string; description: string | null };
  /**
   * The PRD the caller ALREADY ensured. The cloud path may CREATE a PRD (a paid draft
   * plus a real branch commit); every other surface must not, so when this is omitted the
   * assembler READS the ticket's stored PRD and never drafts one.
   *
   * A PROMISE is accepted so the cloud engine can hand over its in-flight
   * `ensureTaskPrd(...)` and keep the PRD draft overlapping the strategy / governance /
   * memory reads, exactly as it did when it owned the whole `Promise.all` itself.
   */
  prd?: string | null | PromiseLike<string | null>;
}

/** The scope string a set of params reconciles against. */
export function runContextScope(params: Pick<AssembleRunContextParams, 'scope' | 'taskId' | 'projectId'>): string {
  return params.scope ?? (params.taskId ? `task:${params.taskId}` : `project:${params.projectId}`);
}

/**
 * Assemble the PLATFORM half of a run's context: strategy, PRD, governance, ticket,
 * project memory and Evermind lessons. Every read runs in parallel and every one is
 * best-effort.
 *
 * Surface-LOCAL blocks (the bound repository, the files already on the branch, the
 * capability prompt, the executor's tool guidance, the headline directive) are added by
 * the surface that knows them — they are the same {@link RunContextBlock} shape, so they
 * render and reconcile through the same path.
 */
export async function assembleRunContext(
  env: Env,
  db: Db,
  params: AssembleRunContextParams,
): Promise<RunContextEnvelope> {
  const { tenantId, projectId, taskId, agentRef } = params;
  const query = (params.query ?? '').trim();

  const [strategy, governance, prd, task, factsBlock, lessonsBlock] = await Promise.all([
    loadStrategyContext(env, db, tenantId, projectId, taskId),
    loadGovernanceContext(env, db, tenantId, projectId, agentRef),
    // Best-effort like every other leg: a PRD we cannot read is a missing block, not a
    // failed run. (`findTaskPrimarySpec` already swallows its own errors; the catch also
    // covers a caller-supplied promise that rejects.)
    (params.prd !== undefined
      ? Promise.resolve(params.prd)
      : taskId
        ? findTaskPrimarySpec(db, taskId).then((row) => row?.prd ?? null)
        : Promise.resolve(null)
    ).catch(() => null),
    params.task ? Promise.resolve(params.task) : Promise.resolve(undefined),
    buildProjectFactsBlock(env, db, tenantId, projectId, query || undefined).catch(() => ''),
    buildEvermindLessonsBlock(env, db, tenantId, projectId, query).catch(() => ''),
  ]);

  const blocks: RunContextBlock[] = [];
  const push = (block: RunContextBlock): void => {
    if (block.body.trim()) blocks.push(block);
  };

  push({
    kind: 'strategy',
    subject: `strategy:${projectId}`,
    body: strategy,
    channel: 'user',
    order: RUN_CONTEXT_ORDER.strategy,
    trustTier: 'tenant',
    sourceRef: `project ${projectId}`,
  });
  push({
    kind: 'prd',
    subject: `prd:${taskId ?? projectId}`,
    body: prd ? `## Product Requirements Document (PRD)\n\n${trustNotice('tenant', 'ticket PRD')}\n\n${prd}` : '',
    channel: 'user',
    order: RUN_CONTEXT_ORDER.prd,
    trustTier: 'tenant',
    ...(taskId ? { sourceRef: `ticket ${taskId}` } : {}),
  });
  push({
    kind: 'governance',
    subject: `governance:${projectId}:${agentRef ?? '-'}`,
    body: governance,
    channel: 'user',
    order: RUN_CONTEXT_ORDER.governance,
    trustTier: 'tenant',
    sourceRef: `project ${projectId}`,
  });
  if (task) {
    push({
      kind: 'task',
      subject: `task:${task.id}`,
      body: `## Your Task\n\n${trustNotice('tenant', `ticket ${task.id}`)}\n\n${task.title}\n\n${task.description ?? ''}`.trim(),
      channel: 'user',
      order: RUN_CONTEXT_ORDER.task,
      trustTier: 'tenant',
      sourceRef: `ticket ${task.id}`,
      // The goal. Never elided, however many turns have already seen it.
      pinned: true,
    });
  }
  push({
    kind: 'memory',
    subject: `memory:${projectId}`,
    body: factsBlock,
    channel: 'system',
    order: RUN_CONTEXT_ORDER.memory,
    trustTier: 'tenant',
    sourceRef: `project ${projectId}`,
  });
  push({
    kind: 'lessons',
    subject: `lessons:${projectId}`,
    body: lessonsBlock,
    channel: 'system',
    order: RUN_CONTEXT_ORDER.lessons,
    trustTier: 'tenant',
    sourceRef: `project ${projectId}`,
  });

  return {
    contractVersion: RUN_CONTEXT_CONTRACT_VERSION,
    scope: runContextScope(params),
    projectId,
    ...(taskId ? { taskId } : {}),
    generatedAt: new Date().toISOString(),
    blocks,
  };
}
