/**
 * The reflection step: turn a run that WORKED into a procedure the next run follows.
 *
 * The board already decides whether a run produced something real — a merged PR, a
 * green check, changes that survived review. A run that clears that bar has, by
 * definition, executed a procedure that works, and until now that procedure existed
 * only in a transcript nobody reads.
 *
 * It is split in two on purpose, because the two halves know different things at
 * different moments:
 *
 *  - {@link skillReflectionDirective} rides in the run's PROMPT. Only the agent knows
 *    which of the fifty things it did were the repeatable ones, and it knows that at
 *    the moment it is about to finish — not when the prompt was assembled.
 *  - {@link runEarnedReflection} runs at FINALIZE, where merge state and the outcome
 *    score are finally known, and answers the reviewer's question: did this run clear
 *    the bar? That is what makes "a qualifying run proposed nothing" a visible fact
 *    rather than a silence.
 *
 * Either way the agent only ever produces a DRAFT, and only a human makes one binding.
 *
 * E1 (lever `e1_skill_ranking`) closes the gap the prompt half leaves: a VERIFIED run —
 * merged, or committed with branch CI green — whose model never called `skill_propose`
 * gets a draft written for it from what it actually did ({@link draftSkillFromRun}: the
 * tool-call trace, the files touched, how it was verified). Still a draft; still only a
 * human approves it.
 */
import { and, asc, eq } from 'drizzle-orm';
import { isCostLeverOn } from '@builderforce/cost-levers';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { recordCloudToolEvent } from '../runtime/cloudToolEvents';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { proposeSkill, skillProposedByExecution, type ProposeSkillInput } from './tenantSkillService';

/** What the run achieved. Known at finalize, not at prompt-build time. */
export interface RunReflectionSignals {
  /** The run's work was merged. */
  merged?: boolean;
  /** A pull request was opened for it. */
  prOpened?: boolean;
  /** The run wrote something to the repository. */
  producedChanges?: boolean;
  /** Outcome score for the run, when one has been computed (0–1). */
  score?: number | null;
}

/** Score at or above which a run counts as proof rather than an attempt. */
export const REFLECTION_SCORE_FLOOR = 0.6;

/**
 * Whether this run earned the right to have proposed a skill.
 *
 * Merged work counts on its own. An unmerged run counts only with BOTH real changes
 * and a graded score above the floor — otherwise every run that touched a file would
 * be writing instructions for every other run, which is how a skill catalogue fills
 * with confident nonsense.
 */
export function runEarnedReflection(signals: RunReflectionSignals): boolean {
  if (signals.merged) return true;
  const graded = typeof signals.score === 'number' && signals.score >= REFLECTION_SCORE_FLOOR;
  return Boolean(graded && (signals.producedChanges || signals.prOpened));
}

/**
 * The reflection directive for a run's prompt. Empty when the run cannot propose a
 * skill at all, so the caller injects unconditionally.
 *
 * TWO conditions, and the caller ANDs them: a run with no repository has learned no
 * procedure about one, and a surface that does not advertise `skill_propose` must not
 * be told to call it — the container's image ends unknown tools in
 * `unknown tool '<name>'`, so a directive naming a tool that surface lacks is an
 * instruction to fail. The prompt names tools; the toolset decides which exist.
 *
 * The wording carries the bar as well as the invitation: most runs should propose
 * nothing, and a step that always fires is a step that always produces noise.
 */
export function skillReflectionDirective(canProposeSkills: boolean): string {
  if (!canProposeSkills) return '';
  return [
    '## Reflection — before you finish',
    '',
    'If this run reached a VERIFIED result (your change is merged, or it is committed and its checks pass), the sequence that got you there is evidence rather than a guess.',
    'In that case only: if you worked out a repeatable way to do something non-obvious in this codebase that a future run would otherwise rediscover, call `skill_propose` with the steps, the exact commands, and how to tell it worked. Call `skill_list` first, so you revise an existing draft instead of adding a near-duplicate.',
    '',
    'Do NOT propose a skill for a one-off fix, for something the repository already documents, or for anything you did not actually finish and verify. Proposing nothing is the right answer for most runs.',
    'A proposal is a draft for human review. It changes nothing on its own, and it never replaces doing the task.',
  ].join('\n');
}

// ── E1: the auto-drafted skill ────────────────────────────────────────────────

/** One call from the run's tool trail, as the draft reads it. */
export interface RunTraceStep {
  tool: string;
  args: Record<string, unknown> | null;
}

/** How a run's result was verified — what makes its procedure evidence. */
export type RunVerification = 'merged' | 'ci_green';

/** Calls that are the loop steering itself, not steps of the procedure. */
const NON_PROCEDURE_TOOLS: ReadonlySet<string> = new Set([
  'finish', 'ask_human', 'tool_search', 'update_task_state', 'skill_propose', 'skill_list',
  'claim_resource', 'release_resource', 'workspace_note', 'workspace_read',
]);

/** Steps quoted in a draft — a procedure, not a transcript. */
const MAX_DRAFT_STEPS = 15;

/** What a step was aimed at: its path, its query, its command. */
function stepTarget(args: Record<string, unknown> | null): string {
  if (!args) return '';
  for (const key of ['path', 'query', 'command', 'symbol', 'url', 'glob']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ').slice(0, 120);
  }
  return '';
}

/**
 * The procedure a verified run followed, as a skill DRAFT: when to use it (the task it
 * solved), the steps (its tool trail, telemetry and loop-control calls dropped, runs of
 * the same call on the same target folded into one), the files it touched and how the
 * result was verified. PURE.
 */
export function draftSkillFromRun(run: {
  taskId: number;
  taskTitle: string;
  executionId: number;
  agentLabel: string;
  projectId: number | null;
  trace: readonly RunTraceStep[];
  filesTouched: readonly string[];
  verification: RunVerification;
}): ProposeSkillInput {
  const steps: Array<{ tool: string; target: string; times: number }> = [];
  for (const s of run.trace) {
    // Timeline-only events (`finish.blocked`, `model.cascade`, …) carry a dot; tools never do.
    if (s.tool.includes('.') || NON_PROCEDURE_TOOLS.has(s.tool)) continue;
    const target = stepTarget(s.args);
    const last = steps[steps.length - 1];
    if (last && last.tool === s.tool && last.target === target) last.times += 1;
    else steps.push({ tool: s.tool, target, times: 1 });
  }
  const shown = steps.slice(0, MAX_DRAFT_STEPS);
  const verified = run.verification === 'merged' ? 'the change was merged' : 'it was committed and branch CI went green';
  const body = [
    `## When to use`,
    `A task like: "${run.taskTitle.trim()}" (task #${run.taskId}).`,
    '',
    '## Steps',
    ...shown.map((s, i) => `${i + 1}. \`${s.tool}\`${s.target ? ` — ${s.target}` : ''}${s.times > 1 ? ` (×${s.times})` : ''}`),
    ...(steps.length > shown.length ? [`… and ${steps.length - shown.length} more step(s) in run #${run.executionId}.`] : []),
    '',
    '## Files touched',
    ...(run.filesTouched.length ? run.filesTouched.slice(0, 30).map((f) => `- \`${f}\``) : ['- (none)']),
    '',
    '## Verification',
    `This procedure is evidence, not a guess: ${verified}. Confirm the same way before relying on it.`,
    '',
    `_Auto-drafted from run #${run.executionId} because the agent proposed no skill. Edit it into a real procedure before approving — or reject it._`,
  ].join('\n');
  return {
    slug: `auto-task-${run.taskId}`,
    name: `How to: ${run.taskTitle.trim()}`.slice(0, 255),
    description: `Auto-drafted from verified run #${run.executionId} (${run.verification === 'merged' ? 'merged' : 'CI green'}) of task #${run.taskId}. Needs human review.`,
    body,
    evidence: `execution ${run.executionId}: ${verified}; files: ${run.filesTouched.slice(0, 20).join(', ') || 'none'}`,
    projectId: run.projectId,
    originExecutionId: run.executionId,
    originTaskId: run.taskId,
    authorLabel: `${run.agentLabel} (auto-drafted)`,
  };
}

/** The run's tool trail, oldest first (the cloud timeline's `tool` rows). */
async function readRunToolTrace(db: Db, tenantId: number, executionId: number): Promise<RunTraceStep[]> {
  const rows = await runTelemetryDatabase(db)
    .select({ tool: toolAuditEvents.toolName, args: toolAuditEvents.args })
    .from(toolAuditEvents)
    .where(and(eq(toolAuditEvents.tenantId, tenantId), eq(toolAuditEvents.executionId, executionId), eq(toolAuditEvents.category, 'tool')))
    .orderBy(asc(toolAuditEvents.ts))
    .limit(300);
  return rows.map((r) => {
    let args: Record<string, unknown> | null = null;
    try {
      const parsed = r.args ? (JSON.parse(r.args) as unknown) : null;
      args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      args = null;
    }
    return { tool: r.tool, args };
  });
}

/**
 * Finalize's reflection step: record whether the run cleared the bar (a fact either
 * way), and — E1 — draft a skill for a VERIFIED run whose model proposed none. Never
 * throws: reflection is observability and learning, never the run's result.
 */
export async function recordRunReflection(env: Env, db: Db, run: {
  tenantId: number;
  cloudAgentRef?: string;
  executionId: number;
  taskRow: { id: number; title: string };
  agentLabel: string;
  projectId: number | null;
  merged: boolean;
  prOpened: boolean;
  ciVerified: boolean;
  writtenPaths: readonly string[];
}): Promise<void> {
  const producedChanges = run.writtenPaths.length > 0;
  const evt = { tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId: run.executionId };
  try {
    if (runEarnedReflection({ merged: run.merged, prOpened: run.prOpened, producedChanges })) {
      await recordCloudToolEvent(db, {
        ...evt, toolName: 'skill.reflection', category: 'lifecycle',
        detail: { merged: run.merged, prOpened: run.prOpened, producedChanges },
        result: 'run cleared the reflection bar',
      });
    }
    const verification: RunVerification | null = run.merged ? 'merged' : producedChanges && run.ciVerified ? 'ci_green' : null;
    if (!verification || !isCostLeverOn(env, 'e1_skill_ranking', run.tenantId)) return;
    if (await skillProposedByExecution(db, run.tenantId, run.executionId)) return;
    const draft = draftSkillFromRun({
      taskId: run.taskRow.id, taskTitle: run.taskRow.title, executionId: run.executionId, agentLabel: run.agentLabel,
      projectId: run.projectId, trace: await readRunToolTrace(db, run.tenantId, run.executionId),
      filesTouched: run.writtenPaths, verification,
    });
    const r = await proposeSkill(env, db, run.tenantId, draft);
    await recordCloudToolEvent(db, {
      ...evt, toolName: 'skill.auto_drafted', category: 'lifecycle',
      detail: { slug: r.slug ?? draft.slug, outcome: r.outcome ?? null, verification, ok: r.ok },
      result: r.ok ? `drafted skill "${r.slug}" for review (${verification})` : `skill draft refused: ${r.error ?? 'unknown'}`,
    });
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/skills/skillReflection.ts', operation: 'recordRunReflection', level: 'warning',
      context: { logMessage: '[cloud-finalize] reflection failed (the run is unaffected)', details: { tenantId: run.tenantId, executionId: run.executionId, error } },
    });
  }
}