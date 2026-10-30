/**
 * Active cross-run memory for the on-prem agent — the `memory` capability behind the
 * shared `memory_recall` / `memory_remember` / `memory_forget` tools (`agent-tools`).
 *
 * It mounts the runtime's ONE memory store: the SSM memory service's `MemoryStore`,
 * ranked with its runtime, exactly as `@seanhogg/builderforce-memory-mcp`'s
 * `MemoryStoreBackend` does for any host. (This replaces `agents/sdk-memory-server.ts`,
 * which mounted the same backend as an MCP server for the Claude Agent SDK; the tools
 * are now defined once in `agent-tools` and every entry point backs them the same way.)
 *
 * Belief writes keep their semantics: a remembered fact goes through Evermind
 * Write-Through Cognition (`commitFact`), so a fact about the same key supersedes its
 * incumbent instead of piling up. Only an expiring (TTL) note is a raw keyed put.
 *
 * Self-gating: no memory service (not initialised) or no memory package ⇒ `undefined`,
 * and the provider simply does not advertise the capability — never a dead tool.
 */

import type { MemoryBackend, RememberInput } from "@seanhogg/builderforce-memory-mcp";
import type { MemoryCapability, MemoryEntry } from "@builderforce/agent-tools";
import { logDebug } from "../logger.js";
import { getSsmMemoryService, type SsmMemoryService } from "../infra/ssm-memory-service.js";

type MemoryMcpModule = typeof import("@seanhogg/builderforce-memory-mcp");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECALL_LIMIT = 5;

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

/** The shared `MemoryCapability` over a backend: the tools' contract, this host's store. */
export function memoryCapabilityOver(backend: MemoryBackend): MemoryCapability {
  return {
    async remember(key, content, opts) {
      if (!backend.remember) return { ok: false, error: "this memory store is read-only" };
      try {
        await backend.remember({
          key,
          content,
          ...(opts?.tags ? { tags: opts.tags } : {}),
          ...(opts?.importance !== undefined ? { importance: opts.importance } : {}),
          ...(opts?.ttlDays ? { ttlMs: opts.ttlDays * DAY_MS } : {}),
        });
        return { ok: true, key };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async recall(query, limit) {
      try {
        const hits = await backend.recall(query, limit ?? DEFAULT_RECALL_LIMIT);
        const entries: MemoryEntry[] = hits.map((hit) => ({ key: hit.key, content: hit.content, origin: "on-prem" }));
        return { ok: true, query, entries };
      } catch (err) {
        return { ok: false, query, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** The on-prem `memory` capability, or `undefined` when memory is unavailable. */
export async function buildNodeMemory(): Promise<MemoryCapability | undefined> {
  const svc = getSsmMemoryService();
  if (!svc) return undefined;
  try {
    const mod: MemoryMcpModule = await import("@seanhogg/builderforce-memory-mcp");
    return memoryCapabilityOver(ssmMemoryBackend(mod, svc));
  } catch (err) {
    logDebug(`[on-prem] memory tools unavailable: ${String(err)}`);
    return undefined;
  }
}
