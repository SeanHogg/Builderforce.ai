/**
 * @builderforce/agent-run — THE one agent (PRD 35 §3.2).
 *
 * The policy-bearing core every BuilderForce entry point drives. An adapter supplies
 * PORTS (model, capabilities, store, events, human, steering, context) and nothing
 * else — no loop, no branch on behaviour, no policy. This package owns the run
 * contract (`contract.ts`), the prompt assembly and the twelve policy hooks
 * (`policy/*`), and it is the ONE importer of the kernel (`@builderforce/agent-loop`).
 *
 * Worker-, browser- and Node-safe: no `node:*` imports, no DOM.
 *
 * A workstream lands its behaviour by replacing ONE folder under `policy/` — never by
 * editing this barrel or `runAgent.ts`. See `policy/index.ts` for the composition.
 */

// The run contract — every type an adapter and the agent exchange.
export * from "./contract.js";

// The one agent. `RunAgentInput` is the single entry point.
export { runAgent, type RunAgentInput } from "./runAgent.js";

// The §8.2 outcome row (WS6): the builder, the per-run tally, and the trace fold an
// adapter uses to persist base counts for a run that died before it settled.
export * from "./telemetry/index.js";

// The policy composition — the twelve modules and how they are bound. Exported so a
// test can assert a module is a no-op, and so an adapter that overrides ONE module
// (its own compaction, say) can do it without a second composition.
export {
  composePolicyHooks,
  defaultPolicyModules,
  type PolicyModules,
  type PolicyHooks,
  type PolicyContext,
  type PolicyToolCall,
  type CompactionHook,
  type CompactionResult,
  type StallHook,
  type StallDecision,
  type SteeringHook,
  type AskHook,
  type SubagentsHook,
  type FinishHook,
  type GuardsHook,
  type GuardControl,
  type GuardDecision,
  type VerifyHook,
  type VerifyResult,
  type MemoryHook,
  type ContextHook,
  type ToolsHook,
  type ModelHook,
  type ModelDecision,
} from "./policy/index.js";

// The ENGINE ports an adapter binds a module with (`composePolicyHooks({ finish: createFinishHook(ports) })`):
// the module stays the policy's; the adapter only hands it the couplings its surface has.
export { createFinishHook, type FinishPorts } from "./policy/finish/index.js";
export { createGuardsHook, type GuardPorts } from "./policy/guards/index.js";
export { createVerifyHook, type VerifyPorts } from "./policy/verify/index.js";
// The verify phase's PURE functions, for the surfaces that run it outside a hook (a cloud run's tail, an @-reply): one
// definition, not a copy per surface. The DB-bound halves (the audit rows, the memory write) stay with the surface.
export { applyVerifyPhase, describeVerifyOutcome, runVerifyPhase, type RunVerifyInput, type RunVerifySurface } from "./policy/verify/runEndMemory.js";
export { inRunVerifyOutcome, planInRunVerify, type InRunVerifyOutcome, type InRunVerifySurface } from "./policy/verify/inRunVerify.js";
export { runSandboxVerify, type SandboxVerifyResult, type VerifySandbox, type VerifyShell } from "./policy/verify/sandboxVerify.js";
// The finish gates and the model hand-off, for the surfaces whose own modules compose them with their dependencies.
export {
  evaluateFinishGates,
  finishGateSnapshot,
  initialFinishGateState,
  isInconclusiveFinishBlock,
  matchesRequiredReviewSignoff,
  missingReviewVerdictMessage,
  type FinishBlockReason,
  type FinishGateArgs,
  type FinishGatePorts,
  type FinishGateSnapshot,
  type FinishGateVerdict,
  type RequiredReviewSignoff,
} from "./policy/finish/gates.js";
export { assertsUnrunVerification, hasNoCodeDeliverable } from "./policy/finish/finishTools.js";
export {
  cascadeReason,
  initialModelRunState,
  policyRole,
  recordSuccess,
  requestForTurn,
  resumeModelRunState,
  retryOutcome,
  routeAroundFailure,
  stallStep,
  turnRequestFields,
  turnRole,
  type ModelRunState,
  type PolicyTurnRequest,
} from "./policy/model/index.js";
export { asksForSubagents } from "./policy/subagents/delegationRequest.js";
export { ROLE_CORE_TOOLS, selectCatalog, deferredToolRole, coreToolNames } from "./policy/tools/catalog.js";
export { runToolSearch, promptNamedTools } from "./policy/tools/searchHelpers.js";
export { withVolatileTail } from "./turnContext.js";
export {
  UPDATE_TASK_STATE_SCHEMA,
  UPDATE_TASK_STATE_TOOL,
  TASK_STATE_MAX_TOKENS,
  applyTaskStateUpdate,
  renderTaskState,
  type TaskState,
} from "./policy/tools/taskState.js";
export { openingRows, systemPrompt } from "./turnContext.js";
export { RUN_CANCELLED_NOTICE } from "./policy/steering/index.js";
export { createCompactionHook, type CompactionHookOptions } from "./policy/compaction/index.js";
// The compaction primitives a surface sizes its own budgets with (the cost-loop session, the gateway summarizer).
export {
  OBSERVATION_MASK_TURNS,
  compactMessages,
  compactionBudget,
  compactionSummaryRequest,
  elideToFit,
  maskOldObservations,
  toolsTokensOf,
  CLOUD_COMPACT_DEFAULTS,
  type CompactOptions,
  type CompactionSummarizer,
} from "./policy/compaction/compact.js";

// The in-process steering queue as a `SteeringSource` port — what a surface that keeps
// its composer queue in memory hands the agent (`queueRunSteering` posts to it).
export { queueRunSteering, runSteeringSource } from "./policy/steering/index.js";
