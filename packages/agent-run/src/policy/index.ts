/**
 * policy/index — THE composition of the agent's policy.
 *
 * The agent owns the policy; an adapter supplies only ports. This file is where the
 * twelve policy modules are composed into the one object the run drives, and where
 * each module's hook is bound.
 *
 * ── HOW A WORKSTREAM LANDS ITS MODULE ────────────────────────────────────────
 * Each WS2 workstream owns ONE folder — `policy/compaction`, `policy/stall`,
 * `policy/steering`, `policy/ask`, `policy/subagents`, `policy/finish`,
 * `policy/guards`, `policy/verify`, `policy/memory`, `policy/context`,
 * `policy/tools`, `policy/model` — and nothing else in this package. WS1 stood
 * every one of those folders up with a NO-OP hook so the agent could run before
 * any behaviour landed; a workstream then replaced the contents of ITS folder and
 * nothing else. This file imports the twelve folders, so the wiring was already in
 * place and no two workstreams ever touched the same file.
 *
 * That is the whole point of the split. The alternative — one file with twelve
 * behaviour blocks, or a registry the modules register into at import time — makes
 * every workstream edit a shared file, and the PRD's ownership rule is exclusive.
 * A module that cannot change the composition cannot change the agent's behaviour
 * by accident.
 *
 * As of the WS2 workstream (all twelve landed), each hook is a real module, not a
 * no-op. The doc above is kept because it records the ownership contract WS2 ran
 * under — future workstreams keep replacing ONE folder and never this file.
 */

import type {
  AskHook,
  CompactionHook,
  ContextHook,
  FinishHook,
  GuardsHook,
  MemoryHook,
  ModelHook,
  PolicyHooks,
  StallHook,
  SteeringHook,
  SubagentsHook,
  ToolsHook,
  VerifyHook,
} from "./hooks.js";

export * from "./hooks.js";

import { compactionHook } from "./compaction/index.js";
import { stallHook } from "./stall/index.js";
import { steeringHook } from "./steering/index.js";
import { askHook } from "./ask/index.js";
import { subagentsHook } from "./subagents/index.js";
import { finishHook } from "./finish/index.js";
import { guardsHook } from "./guards/index.js";
import { verifyHook } from "./verify/index.js";
import { memoryHook } from "./memory/index.js";
import { contextHook } from "./context/index.js";
import { toolsHook } from "./tools/index.js";
import { modelHook } from "./model/index.js";

/** The twelve modules, by the folder that owns them. */
export interface PolicyModules {
  compaction: CompactionHook;
  stall: StallHook;
  steering: SteeringHook;
  ask: AskHook;
  subagents: SubagentsHook;
  finish: FinishHook;
  guards: GuardsHook;
  verify: VerifyHook;
  memory: MemoryHook;
  context: ContextHook;
  tools: ToolsHook;
  model: ModelHook;
}

/**
 * The modules as they stand — the no-op set until each workstream lands.
 *
 * Exported so a test can assert that a module really is a no-op, and so an
 * adapter that wants to override ONE module (a surface with its own compaction,
 * say) can do it without a second composition.
 */
export function defaultPolicyModules(): PolicyModules {
  return {
    compaction: compactionHook,
    stall: stallHook,
    steering: steeringHook,
    ask: askHook,
    subagents: subagentsHook,
    finish: finishHook,
    guards: guardsHook,
    verify: verifyHook,
    memory: memoryHook,
    context: contextHook,
    tools: toolsHook,
    model: modelHook,
  };
}

/**
 * Compose the hooks the run drives. `overrides` replaces a module WHOLE — a
 * surface that brings its own compaction brings the whole hook, not half of one.
 */
export function composePolicyHooks(overrides: Partial<PolicyModules> = {}): PolicyHooks {
  const modules = { ...defaultPolicyModules(), ...overrides };
  return {
    compaction: modules.compaction,
    stall: modules.stall,
    steering: modules.steering,
    ask: modules.ask,
    subagents: modules.subagents,
    finish: modules.finish,
    guards: modules.guards,
    verify: modules.verify,
    memory: modules.memory,
    context: modules.context,
    tools: modules.tools,
    model: modules.model,
  };
}
