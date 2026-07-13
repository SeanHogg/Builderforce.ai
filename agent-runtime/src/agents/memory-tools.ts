/**
 * Active cross-run memory tools for the on-prem (Node) loop — the production caller of
 * `registryToAgentTools` for the `memory` capability, the disk/SSM twin of the same
 * shared `@builderforce/agent-tools` `memory_recall`/`memory_remember` definitions any
 * surface can offer. Where the converged file tools back `repo.*` with disk, this backs
 * `memory` with the in-process SSM memory service (`getSsmMemoryService`) — so the agent
 * can ACTIVELY recall a stored fact (instead of only the passive `recallSimilar`
 * injection the orchestrator already does) and remember new ones mid-run.
 *
 * Self-gating: when the SSM memory layer is unavailable (the optional
 * `@seanhogg/builderforce-memory` package absent, or the service not yet initialised)
 * this returns `[]`, so the loop simply runs without memory tools — never a dead tool.
 */

import {
  memoryRecallTool,
  memoryRememberTool,
  ToolRegistry,
  type Capability,
  type CapabilityProvider,
  type MemoryRecallResult,
  type MemoryRememberResult,
} from "@builderforce/agent-tools";
import { registryToAgentTools } from "../builderforce/agent-loop/tool-adapter.js";
import { getSsmMemoryService, type SsmMemoryService } from "../infra/ssm-memory-service.js";
import type { AnyAgentTool } from "./coding-tools.types.js";

/** The single capability this provider backs. */
const MEMORY_CAPS: ReadonlySet<Capability> = new Set<Capability>(["memory"]);

/** Workspace-independent (the defs are static), so the registry is built once. */
const MEMORY_REGISTRY = new ToolRegistry([memoryRecallTool, memoryRememberTool]);

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A {@link CapabilityProvider} that backs `memory` with the SSM memory service. */
export function buildMemoryCapabilityProvider(svc: SsmMemoryService): CapabilityProvider {
  return {
    capabilities: MEMORY_CAPS,
    memory: {
      async remember(key, content, opts): Promise<MemoryRememberResult> {
        try {
          // Route belief writes through Evermind Write-Through Cognition: a fact
          // about the same subject (key) supersedes its incumbent instead of
          // accumulating. Activity-event logging (KnowledgeLoop) still uses the
          // raw keyed remember — events accumulate, beliefs replace.
          await svc.commitFact(key, content, opts);
          return { ok: true, key };
        } catch (e) {
          return { ok: false, error: errMessage(e) };
        }
      },
      async recall(query, limit): Promise<MemoryRecallResult> {
        try {
          const entries = await svc.recallSimilar(query, limit ?? 5);
          return { ok: true, query, entries };
        } catch (e) {
          return { ok: false, error: errMessage(e) };
        }
      },
    },
  };
}

/**
 * Build the active memory tools for a session. Returns `[]` when the SSM memory service
 * is unavailable (graceful — the run proceeds without them).
 */
export function buildMemoryTools(): AnyAgentTool[] {
  const svc = getSsmMemoryService();
  if (!svc) return [];
  return registryToAgentTools(MEMORY_REGISTRY, buildMemoryCapabilityProvider(svc));
}
