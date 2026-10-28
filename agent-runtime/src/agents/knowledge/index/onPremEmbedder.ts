/**
 * On-prem's embedder for the knowledge index (docs/design/deterministic-knowledge-index.md,
 * "Where it runs"), through the SHARED chain (`resolveWarmEmbedder`: Synapse → Evermind →
 * Ollama, the first warm one): the Evermind embed of the runtime's ONE SSM memory service
 * while it is warm (initialised, on its GPU) — never loaded for the index's sake — then a
 * resident Ollama embedding model on this machine (the shared `ollamaEmbedderSource` of
 * `@builderforce/local-inference`, over each loopback Ollama provider configured, else
 * Ollama's default local endpoint). There is no Synapse engine in this runtime. None warm
 * ⇒ the index serves exact + lexical. Each engine keeps its own fingerprint.
 *
 * The fingerprint names the checkpoint, its width and its on-disk save: the SSM adapts as
 * it learns and persists the adapted weights, and a vector from before a save is not
 * comparable with one after — a new save is a new fingerprint, and the index re-embeds
 * on idle rather than mixing them.
 */

import { statSync } from "node:fs";
import { basename } from "node:path";
import type { EmbedderPort } from "@seanhogg/builderforce-memory/knowledge";
import { batchEmbedder, resolveWarmEmbedder, type WarmEmbedderSource } from "@builderforce/agent-tools/knowledge-index.js";
import { ollamaEmbedderSource } from "@builderforce/local-inference";
import { getSsmMemoryService, type SsmMemoryService } from "../../../infra/ssm-memory-service.js";
import { loadConfig, type BuilderForceAgentsConfig } from "../../../config/config.js";
import { isLoopbackUrl } from "../../../gateway/net.js";
import { resolveOllamaApiBase } from "../../models-config.providers.js";

/** A fixed text whose embedding's length is the model's width. */
const DIMS_PROBE = "dimensions";

const dimsBySvc = new WeakMap<SsmMemoryService, Promise<number>>();

function dimsOf(svc: SsmMemoryService): Promise<number> {
  let dims = dimsBySvc.get(svc);
  if (!dims) {
    dims = svc.embed(DIMS_PROBE).then((v) => v?.length ?? 0, () => 0);
    dimsBySvc.set(svc, dims);
  }
  return dims;
}

function savedAt(file: string): number {
  try {
    return Math.floor(statSync(file).mtimeMs);
  } catch {
    return 0;
  }
}

/** The SSM memory service's embed, while it is warm. */
export function evermindEmbedderSource(service: () => SsmMemoryService | null = getSsmMemoryService): WarmEmbedderSource {
  return {
    id: "evermind",
    warm: () => service()?.gpuAvailable === true,
    async port() {
      const svc = service();
      if (!svc?.gpuAvailable) return undefined;
      const dims = await dimsOf(svc);
      if (dims <= 0) return undefined;
      return batchEmbedder(svc, `evermind-ssm:${basename(svc.checkpointPath)}@${savedAt(svc.checkpointPath)}`, dims);
    },
  };
}

/**
 * The Ollama endpoints on THIS machine: every configured `ollama` provider with a loopback
 * `baseUrl`, else Ollama's default local endpoint. A provider pointed off the machine is
 * never asked — the index embeds workspace text.
 */
export function onPremOllamaBases(config: BuilderForceAgentsConfig | undefined): string[] {
  const configured = Object.values(config?.models?.providers ?? {})
    .filter((p) => p?.api === "ollama" && isLoopbackUrl(p.baseUrl))
    .map((p) => resolveOllamaApiBase(p.baseUrl));
  return [...new Set(configured.length > 0 ? configured : [resolveOllamaApiBase()])];
}

const ollamaSources = new Map<string, WarmEmbedderSource>();

/** One shared Ollama source per local endpoint (its residency read is kept across runs). */
export function onPremOllamaSources(config: BuilderForceAgentsConfig | undefined = readConfig()): WarmEmbedderSource[] {
  return onPremOllamaBases(config).map((baseUrl) => {
    let source = ollamaSources.get(baseUrl);
    if (!source) {
      source = ollamaEmbedderSource((input, init) => fetch(input, init), { baseUrl });
      ollamaSources.set(baseUrl, source);
    }
    return source;
  });
}

function readConfig(): BuilderForceAgentsConfig | undefined {
  try {
    return loadConfig();
  } catch {
    return undefined; // No readable config: Ollama's default local endpoint only.
  }
}

/** The warm embedder right now, in the shared order; undefined ⇒ exact + lexical only. */
export function onPremEmbedder(
  sources: readonly WarmEmbedderSource[] = [evermindEmbedderSource(), ...onPremOllamaSources()],
): Promise<EmbedderPort | undefined> {
  return resolveWarmEmbedder(sources);
}
