/**
 * Limbic system (agent-runtime barrel).
 *
 * The limbic compiler is now the single shared implementation in
 * `@builderforce/agent-tools` so every surface — on-prem (this runtime), the
 * cloud V3 engine (`api`), and the VS Code extension — runs the identical
 * affective brain. This file re-exports it under the original
 * `builderforce/limbic.js` path so existing imports keep working unchanged.
 *
 * See `packages/agent-tools/src/limbic.ts` for the implementation and the
 * "personality = setpoints, limbic = dynamics" design.
 */
export {
  LIMBIC_DIM_NAMES,
  LIMBIC_STATE_DIM,
  NEUTRAL_STATE,
  clamp,
  neutralState,
  applyDelta,
  stateToArray,
  arrayToState,
  deriveLimbicSetpoints,
  appraiseAmygdala,
  appraiseTask,
  homeostasis,
  thalamusGate,
  basalGangliaExploreBias,
  basalGangliaSelect,
  compileLimbicState,
  maxThink,
  mergeLimbicWithPsychometric,
  buildLimbicBlock,
} from "@builderforce/agent-tools";

export type {
  LimbicDimName,
  LimbicState,
  LimbicSetpoints,
  LimbicDelta,
  LimbicEvent,
  LimbicExecParams,
  CompiledLimbic,
} from "@builderforce/agent-tools";
