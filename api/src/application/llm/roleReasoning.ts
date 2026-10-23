/**
 * ROLE → REASONING EFFORT (cost PRD D4, lever `d4_role_reasoning`).
 *
 * Reasoning tokens are billed as output, and most calls do not need them: a file
 * search, a mechanical edit or a verifier yes/no gains nothing from a long think, while
 * a plan does. The role a call already declares (`body.role`, the same field that orders
 * the seed) is therefore the effort default — expressed as an `AgentThinkLevel` so it
 * feeds `reasoningParamsForModel`, the ONE vendor mapping, with no second translation
 * table.
 *
 * Precedence is fixed: an explicit level (persona `thinkLevel`, the client's
 * `reasoning: { level }`) ALWAYS wins; the role default applies only when nothing
 * explicit was asked for. Pure data + two pure helpers.
 */

import { isModelRole, type AgentExecParams, type AgentThinkLevel, type ModelRole } from '@builderforce/agent-tools';

/**
 * THE table. `minimal` rather than `off` for explore/utility on purpose: on an OpenAI
 * reasoning model "off" means "send nothing", which takes the vendor default (medium) —
 * the opposite of what a cheap role wants. `minimal` maps to that family's lowest level
 * and to no thinking at all on Anthropic.
 */
export const ROLE_REASONING_EFFORT: Readonly<Record<ModelRole, AgentThinkLevel>> = Object.freeze({
  explore: 'minimal',
  utility: 'minimal',
  verify: 'low',
  chat: 'low',
  code: 'medium',
  plan: 'high',
});

/** The think-level ladder, lowest first — what `escalate` climbs. */
const THINK_LADDER: readonly AgentThinkLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

/** One level up the ladder (the D1 verifier cascade's retry); `xhigh` stays `xhigh`. PURE. */
export function escalateThinkLevel(level: AgentThinkLevel): AgentThinkLevel {
  const i = THINK_LADDER.indexOf(level);
  return THINK_LADDER[Math.min(THINK_LADDER.length - 1, Math.max(0, i) + 1)]!;
}

/** The role's default exec levers, or `undefined` for an absent/unknown role. PURE. */
export function roleReasoningExecParams(role: unknown): AgentExecParams | undefined {
  if (!isModelRole(role)) return undefined;
  return { thinkLevel: ROLE_REASONING_EFFORT[role] };
}

/**
 * Explicit wins, else the role default when the lever is on. `explicit` counts only when
 * it actually names a level or switches reasoning on — a persona that set just a
 * temperature has not chosen an effort. PURE: the lever decision is the caller's.
 */
export function effectiveReasoningExecParams(
  explicit: AgentExecParams | undefined,
  role: unknown,
  roleLeverOn: boolean,
): AgentExecParams | undefined {
  const chose = !!explicit && (explicit.thinkLevel != null || explicit.reasoningLevel != null);
  if (chose || !roleLeverOn) return explicit;
  const byRole = roleReasoningExecParams(role);
  return byRole ? { ...explicit, ...byRole } : explicit;
}
