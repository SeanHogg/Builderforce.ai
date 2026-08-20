/**
 * The Creation Canvas's `runTarget` select, translated into the run-target the
 * platform actually has.
 *
 * The canvas offers two proper nouns — "BuilderForce.AI" and "Campaign
 * Strategist" — while a workflow definition stores `run_target_runtime` plus
 * either an agentHost id or a cloud-agent ref. Nothing bridged the two, so the
 * select was authored, saved and dropped, and every canvas workflow compiled to
 * the same hard-coded `runtime: 'cloud'` with no agent.
 *
 * The mapping is deliberately NOT a third runtime. "Campaign Strategist" names an
 * AGENT, not a place to execute — it is the growth-owning built-in (`cmo`, whose
 * first skill is literally campaign-strategy) — so it resolves to a real
 * `ide_agents.id` on the cloud runtime. Inventing a `runtime: 'campaign'` would
 * have put a value in the column that no executor knows how to dispatch, which
 * fails at run time instead of here.
 *
 * Unresolvable is an ERROR, never a quiet downgrade to the generic cloud runtime.
 * `from-canvas` is all-or-nothing by design: handing back a definition that runs
 * green on a different agent than the card names is the same false completeness
 * the compile endpoint exists to end.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { ideAgents } from '../../infrastructure/database/schema';
import type { StoredRunTarget } from './definitionStore';
import type { Db } from '../../infrastructure/database/connection';

/** The values the canvas Workflow card's `runTarget` select can carry. */
export const CANVAS_RUN_TARGETS = ['builderforce', 'campaign-strategist'] as const;
export type CanvasRunTarget = (typeof CANVAS_RUN_TARGETS)[number];

/**
 * Which built-in agent each named canvas target means. `builderforce` names no
 * agent at all — it is the platform's own hosted runtime, which is exactly a
 * cloud target with no ref.
 */
const BUILTIN_KIND_FOR: Record<CanvasRunTarget, string | null> = {
  builderforce: null,
  'campaign-strategist': 'cmo',
};

export function isCanvasRunTarget(value: unknown): value is CanvasRunTarget {
  return typeof value === 'string' && (CANVAS_RUN_TARGETS as readonly string[]).includes(value);
}

export type CanvasRunTargetResolution =
  | { ok: true; target: StoredRunTarget }
  | { ok: false; error: string };

/**
 * Resolve one authored canvas run target into the stored columns.
 *
 * Only agents that can actually serve the cloud runtime are eligible — the same
 * predicate `GET /run-targets` uses — so a target that resolves here is one the
 * run endpoint can dispatch to.
 */
export async function resolveCanvasRunTarget(
  db: Db,
  tenantId: number,
  value: string,
): Promise<CanvasRunTargetResolution> {
  if (!isCanvasRunTarget(value)) {
    return { ok: false, error: `Unknown run target "${value}". Choose one of: ${CANVAS_RUN_TARGETS.join(', ')}.` };
  }

  const builtinKind = BUILTIN_KIND_FOR[value];
  if (!builtinKind) {
    return { ok: true, target: { runTargetRuntime: 'cloud', runTargetAgentHostId: null, runTargetCloudAgentRef: null } };
  }

  const [agent] = await db
    .select({ id: ideAgents.id })
    .from(ideAgents)
    .where(and(
      eq(ideAgents.tenantId, tenantId),
      eq(ideAgents.builtinKind, builtinKind),
      eq(ideAgents.status, 'active'),
      inArray(ideAgents.runtimeSupport, ['cloud', 'both']),
    ))
    .limit(1);

  if (!agent) {
    return {
      ok: false,
      error: `This workspace has no active cloud agent for "${value}". Hire or re-enable the ${builtinKind.toUpperCase()} agent, or run this workflow on BuilderForce.AI.`,
    };
  }
  return { ok: true, target: { runTargetRuntime: 'cloud', runTargetAgentHostId: null, runTargetCloudAgentRef: agent.id } };
}
