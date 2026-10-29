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

// The in-process steering queue as a `SteeringSource` port — what a surface that keeps
// its composer queue in memory hands the agent (`queueRunSteering` posts to it).
export { queueRunSteering, runSteeringSource } from "./policy/steering/index.js";
