/**
 * The editor's embedder for the knowledge index (docs/design/deterministic-knowledge-index.md,
 * "Where it runs"): Synapse (`bfi-node`) → the Evermind CPU embed → a resident Ollama
 * embedding model, the first that is WARM — judged the way the PreFetch logprob port
 * judges its engine (a model is resident now), never by loading one on a request's path.
 * The order and the "never mix fingerprints" rule are the shared `resolveWarmEmbedder`'s.
 *
 *   - Synapse: a part of the editor that holds an embedding model OFFERS it here while it
 *     is resident (`offerWarmEmbedder`). The host `bfi` worker serves chat only today, so
 *     nothing offers one yet.
 *   - Evermind: the checkpoint the memory server embeds recall with
 *     (`BUILDERFORCE_MEMORY_MODEL`, memory-mcp's `MODEL_FILE_ENV`), only when that file is
 *     present — loaded on idle (`idleLoadedEmbedder`, its own scheduler), cold until then.
 *     Its fingerprint carries the checkpoint's save time: an adapted save re-embeds.
 *   - Ollama: only while `/api/ps` shows an EMBEDDING model resident (read in the
 *     background, `residentModelTracker`) on the configured endpoint, local models on.
 *
 * No `vscode` import: the local-model settings are handed in at activation.
 */

import { statSync } from "node:fs";
import type { EmbedderPort } from "@seanhogg/builderforce-memory/knowledge";
import {
  KNOWLEDGE_IDLE_MS,
  batchEmbedder,
  debouncedIdle,
  idleLoadedEmbedder,
  resolveWarmEmbedder,
  type IdleScheduler,
  type WarmEmbedderSource,
} from "@builderforce/agent-tools/knowledge-index";
import {
  ollamaEmbedderSource as sharedOllamaEmbedderSource,
  type FetchLike,
  type LocalEndpoint,
} from "@builderforce/local-inference";
import { globalFetch, type LocalModelsConfig } from "../../localModels";

/** memory-mcp's `MODEL_FILE_ENV` / `TOKENIZER_FILE_ENV` — the ONE place a local checkpoint is named. */
const EVERMIND_MODEL_ENV = "BUILDERFORCE_MEMORY_MODEL";
const EVERMIND_TOKENIZER_ENV = "BUILDERFORCE_MEMORY_TOKENIZER";


const offered = new Map<WarmEmbedderSource["id"], WarmEmbedderSource>();

/** Offer a resident embedder (Synapse). Returns the withdrawal. */
export function offerWarmEmbedder(source: WarmEmbedderSource): () => void {
  offered.set(source.id, source);
  return () => {
    if (offered.get(source.id) === source) offered.delete(source.id);
  };
}

/** The Evermind checkpoint on disk now, as `<path>@<save time>`; undefined when none. */
export function evermindCheckpointStamp(env: Record<string, string | undefined> = process.env): string | undefined {
  const file = env[EVERMIND_MODEL_ENV]?.trim();
  if (!file) return undefined;
  try {
    const stat = statSync(file);
    return stat.isFile() ? `${file}@${Math.floor(stat.mtimeMs)}` : undefined;
  } catch {
    return undefined;
  }
}

/** Load the stamped checkpoint through memory-mcp's ONE CPU loader; undefined ⇒ it cannot embed. */
async function loadEvermindEmbedder(stamp: string, env: Record<string, string | undefined>): Promise<EmbedderPort | undefined> {
  const at = stamp.lastIndexOf("@");
  const modelFile = stamp.slice(0, at);
  const { createEvermindEmbedder } = await import("@seanhogg/builderforce-memory-mcp");
  const embedder = await createEvermindEmbedder({ modelFile, tokenizerFile: env[EVERMIND_TOKENIZER_ENV] });
  if (!embedder || embedder.dimensions <= 0) return undefined;
  return batchEmbedder(embedder, `evermind-cpu:${embedder.fingerprint}@${stamp.slice(at + 1)}`, embedder.dimensions);
}

/** The Evermind CPU source: cold until an idle pass has loaded the checkpoint. */
export function evermindEmbedderSource(
  idle: IdleScheduler,
  env: Record<string, string | undefined> = process.env,
  load: (stamp: string) => Promise<EmbedderPort | undefined> = (stamp) => loadEvermindEmbedder(stamp, env),
): WarmEmbedderSource {
  return idleLoadedEmbedder({ id: "evermind", stamp: () => evermindCheckpointStamp(env), load, idle });
}

/** The Ollama source over one endpoint — the shared one (`@builderforce/local-inference`). */
export function ollamaEmbedderSource(endpoint: LocalEndpoint, fetchImpl: FetchLike = globalFetch): WarmEmbedderSource {
  return sharedOllamaEmbedderSource(fetchImpl, endpoint);
}

interface EditorEmbedderConfig {
  /** The on-device runtime settings, read per call; absent or off ⇒ no Ollama source. */
  localModels?: () => LocalModelsConfig | undefined;
}

let config: EditorEmbedderConfig = {};
let evermind: WarmEmbedderSource | undefined;
const ollamaSources = new Map<string, WarmEmbedderSource>();

/** Activation: the local-model settings the Ollama source reads. */
export function configureEditorEmbedder(next: EditorEmbedderConfig): void {
  config = next;
  ollamaSources.clear();
}

function ollamaSource(): WarmEmbedderSource | undefined {
  const settings = config.localModels?.();
  const endpoint = settings?.enabled ? settings.endpoints.ollama : undefined;
  if (!endpoint?.baseUrl.trim()) return undefined;
  let source = ollamaSources.get(endpoint.baseUrl);
  if (!source) {
    source = ollamaEmbedderSource(endpoint);
    ollamaSources.set(endpoint.baseUrl, source);
  }
  return source;
}

/** The warm embedder right now, Synapse first; undefined ⇒ exact + lexical only. */
export function editorEmbedder(): Promise<EmbedderPort | undefined> {
  // Its own idle scheduler: the index's coalescing one would drop a pending pass for it.
  evermind ??= evermindEmbedderSource(debouncedIdle(KNOWLEDGE_IDLE_MS));
  const ollama = ollamaSource();
  return resolveWarmEmbedder([...offered.values(), evermind, ...(ollama ? [ollama] : [])]);
}
