/**
 * Active cross-run memory for the V2 (Claude Agent SDK) runner — the SDK twin of
 * `memory-tools.ts`, which gives the V1 loop the same capability. The SDK takes tools
 * as MCP servers, so this mounts the package's in-process memory server
 * (`createMemoryMcpServer` from `@seanhogg/builderforce-memory-mcp`) over the runtime's
 * ONE memory store: the SSM memory service's `MemoryStore`, ranked with its runtime,
 * exactly as the package's `MemoryStoreBackend` does for any host.
 *
 * Belief writes keep V1's semantics: a remembered fact goes through Evermind
 * Write-Through Cognition (`commitFact`), so a fact about the same key supersedes its
 * incumbent instead of piling up. Only an expiring (TTL) note is a raw keyed put.
 *
 * Self-gating: no memory service (the optional package absent, or not initialised) or
 * no MCP package ⇒ `null`, and the runner simply mounts nothing — never a dead tool.
 */

import type { MemoryBackend, RememberInput, SdkMcpServerConfig } from "@seanhogg/builderforce-memory-mcp";
import { logDebug } from "../logger.js";
import { getSsmMemoryService, type SsmMemoryService } from "../infra/ssm-memory-service.js";

/** The MCP server name — the middle segment of every `mcp__<name>__<tool>` tool id. */
export const SDK_MEMORY_SERVER = "builderforce_memory";

/** The `allowedTools` entry that admits every tool of {@link SDK_MEMORY_SERVER}. */
export const SDK_MEMORY_TOOLS = `mcp__${SDK_MEMORY_SERVER}__*`;

type MemoryMcpModule = typeof import("@seanhogg/builderforce-memory-mcp");

/** The package's store backend, with belief writes routed through cognition. */
export function ssmMemoryBackend(mod: Pick<MemoryMcpModule, "MemoryStoreBackend">, svc: SsmMemoryService): MemoryBackend {
  class SsmMemoryBackend extends mod.MemoryStoreBackend {
    override async remember(input: RememberInput): Promise<void> {
      if (input.ttlMs) return super.remember(input);
      await svc.commitFact(input.key, input.content, { tags: input.tags, importance: input.importance });
    }
  }
  return new SsmMemoryBackend(svc.memory, svc.runtime);
}

/** The memory MCP server for one SDK run, or `null` when memory is unavailable. */
export async function buildSdkMemoryServer(): Promise<SdkMcpServerConfig | null> {
  const svc = getSsmMemoryService();
  if (!svc) return null;
  try {
    const mod: MemoryMcpModule = await import("@seanhogg/builderforce-memory-mcp");
    return await mod.createMemoryMcpServer(ssmMemoryBackend(mod, svc), { name: SDK_MEMORY_SERVER });
  } catch (err) {
    logDebug(`[v2-runner] memory tools unavailable: ${String(err)}`);
    return null;
  }
}
