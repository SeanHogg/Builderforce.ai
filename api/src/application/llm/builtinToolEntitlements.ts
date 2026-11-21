/**
 * Built-in tools a workspace only SEES when it holds a feature (PRD 33 §8 S4c:
 * "REPLAY_TOOLS … advertised ONLY when the tenant holds sessionReplay") or is the
 * platform operator (platform-internal tools such as `deploy.status`).
 *
 * The built-in catalog is static metadata (`listBuiltinTools`); this is the one
 * registry of which of its rows are gated, and the one filter the gateway applies
 * per tenant before advertising. A gated tool's own `run` re-checks its gate, so
 * a model naming a tool it was not shown is refused rather than served.
 */

import type { Env } from '../../env';
import type { PlanFeature } from '../../domain/tenant/planFeatures';
import { tenantHasFeature } from '../tenant/featureEntitlements';
import { isPlatformOperator } from '../tenant/platformOperator';
import { REPLAY_TOOL_IDS } from './replayToolCatalog';
import { PLATFORM_OPERATOR_TOOL_IDS } from './platformOperatorTools';

export interface BuiltinToolFeatureGate {
  feature: PlanFeature;
  tools: readonly string[];
}

/** Every feature-gated built-in tool, by the feature that unlocks it. */
export const BUILTIN_TOOL_FEATURE_GATES: readonly BuiltinToolFeatureGate[] = [
  { feature: 'sessionReplay', tools: REPLAY_TOOL_IDS },
];

/** Every built-in tool shown only to the platform operator (`isPlatformOperator`). */
export const BUILTIN_TOOL_PLATFORM_OPERATOR_TOOLS: readonly string[] = PLATFORM_OPERATOR_TOOL_IDS;

/** The tools this workspace may be shown: ungated ones, plus each gate it holds. */
export async function entitledBuiltinTools<T extends { tool: string }>(
  env: Env,
  tenantId: number,
  userId: string | null | undefined,
  tools: readonly T[],
): Promise<T[]> {
  const present = BUILTIN_TOOL_FEATURE_GATES.filter((gate) => tools.some((t) => gate.tools.includes(t.tool)));
  const operatorToolsPresent = tools.some((t) => BUILTIN_TOOL_PLATFORM_OPERATOR_TOOLS.includes(t.tool));
  if (present.length === 0 && !operatorToolsPresent) return [...tools];
  const [held, operator] = await Promise.all([
    Promise.all(present.map((gate) => tenantHasFeature(env, tenantId, userId ?? null, gate.feature))),
    operatorToolsPresent ? isPlatformOperator(env, tenantId, userId) : Promise.resolve(true),
  ]);
  const hidden = new Set(present.filter((_, i) => !held[i]).flatMap((gate) => gate.tools));
  if (!operator) for (const tool of BUILTIN_TOOL_PLATFORM_OPERATOR_TOOLS) hidden.add(tool);
  return tools.filter((t) => !hidden.has(t.tool));
}
