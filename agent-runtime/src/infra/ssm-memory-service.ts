/**
 * SsmMemoryService – loads/manages the @seanhogg/builderforce-memory runtime and SSMAgent
 * for BuilderForceAgents's local hippocampus memory layer.
 *
 * GPU initialisation is optional: if @webgpu/node is unavailable or the GPU
 * fails to initialise the service still starts and serves memory-only
 * operations.  SSM inference is disabled in that case.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { logDebug } from "../logger.js";
import { buildTeamMemoryContext as bridgeBuildTeamMemoryContext } from "./memory-bridge.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SsmMemoryServiceOptions {
  /**
   * Path to the model checkpoint binary on disk.
   * Resolution order: this option → env `BUILDERFORCE_AGENTS_SSM_CHECKPOINT` → '.builderforce/model.bin'.
   * The path is also where adapted weights are persisted (see saveCheckpoint).
   */
  checkpointPath?: string;
  /** Anthropic API key forwarded to an optional bridge (unused in memory-only mode). */
  anthropicApiKey?: string;
  /**
   * MambaKit model size preset.
   * Default: 'small'
   */
  modelSize?: "nano" | "small" | "medium" | "large";
  /**
   * Persist adapted weights back to disk after this many learn() calls.
   * Lower = more durable but more (large) disk writes. Default: 20.
   * A final flush() on shutdown always persists any pending adaptation.
   */
  saveEveryLearns?: number;
  /**
   * When no checkpoint exists on first start, write the freshly-initialised
   * weights to disk so subsequent runs load identical (reproducible) weights
   * instead of re-randomising. Default: true.
   */
  seedCheckpointIfMissing?: boolean;
  /**
   * Deterministic seed for first-run weight initialisation. A fixed seed makes
   * the cold-start model byte-identical across machines. Default: DEFAULT_SEED.
   */
  seed?: number;
  /**
   * Optional URL to a hosted checkpoint .bin. When no local checkpoint exists,
   * it is fetched once and cached to `checkpointPath`. Resolution order:
   * this option → env `BUILDERFORCE_AGENTS_SSM_CHECKPOINT_URL` → none.
   */
  checkpointUrl?: string;
  /**
   * BuilderForce.ai gateway base URL for the shared (L2) semantic response
   * cache. Resolution: this option → env `BUILDERFORCE_GATEWAY_URL`. When set
   * (with `apiKey`), a paraphrased answer cached by the web app or another agent
   * can be reused here. Absent → the semantic cache runs L1-only (on-device).
   */
  gatewayUrl?: string;
  /** Tenant API key for the gateway L2 cache. Resolution: this option → env `BUILDERFORCE_API_KEY`. */
  apiKey?: string;
  /** Optional partition for the shared cache (e.g. per model). Resolution: this option → env `BUILDERFORCE_SEMCACHE_NAMESPACE`. */
  semanticCacheNamespace?: string;
}

/** Default on-disk checkpoint path, relative to cwd. */
const DEFAULT_CHECKPOINT_PATH = path.join(".builderForceAgents", "model.bin");
/** Default number of learn() calls between automatic checkpoint persists. */
const DEFAULT_SAVE_EVERY_LEARNS = 20;
/**
 * Fixed default init seed. Constant (not random) so every fresh agentNode starts
 * from byte-identical weights — reproducible cold start across machines.
 */
const DEFAULT_SEED = 0x0c0de5ee;

/**
 * Resolves the on-disk checkpoint path from explicit option, environment, or default.
 * Exported for testability.
 */
export function resolveCheckpointPath(explicit?: string): string {
  return explicit ?? process.env["BUILDERFORCE_AGENTS_SSM_CHECKPOINT"] ?? DEFAULT_CHECKPOINT_PATH;
}

/**
 * Resolves an optional hosted checkpoint URL from explicit option or environment.
 * Exported for testability.
 */
export function resolveCheckpointUrl(explicit?: string): string | undefined {
  return explicit ?? process.env["BUILDERFORCE_AGENTS_SSM_CHECKPOINT_URL"] ?? undefined;
}

/**
 * Fetches a hosted checkpoint and caches it to `destPath`. Returns the bytes,
 * or null on any failure (the caller then falls back to seeded init).
 */
async function fetchCheckpointToDisk(url: string, destPath: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      logDebug(`[ssm-memory] checkpoint fetch ${url} → HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, buf);
    logDebug(`[ssm-memory] fetched checkpoint ${url} → cached at ${destPath} (${buf.byteLength} bytes)`);
    return buf;
  } catch (err) {
    logDebug(`[ssm-memory] checkpoint fetch failed (${url}): ${String(err)}`);
    return null;
  }
}

// ── Lazy module imports ───────────────────────────────────────────────────────
// We import @seanhogg/builderforce-memory types dynamically so that a missing package does not prevent
// the rest of the gateway from starting.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SSMRuntime = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SSMAgent = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoryStore = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SemanticCache = any;

// ── SsmMemoryService ──────────────────────────────────────────────────────────

export class SsmMemoryService {
  readonly runtime: SSMRuntime;
  readonly agent: SSMAgent;
  readonly memory: MemoryStore;
  /**
   * Embedding-keyed read-through cache for cortex completions: L1 = on-device
   * SSM embeddings (free), L2 = the BuilderForce.ai gateway (shared with the web
   * app). `null` when the GPU/embedder is unavailable. Consumed by the cortex
   * path to reuse paraphrased answers instead of re-billing the frontier model
   * (see `getCachedOrGenerate`).
   */
  readonly semanticCache: SemanticCache | null;
  readonly gpuAvailable: boolean;
  /** Absolute-or-cwd-relative path the checkpoint is loaded from and saved to. */
  readonly checkpointPath: string;

  private readonly saveEveryLearns: number;
  /** learn() calls since the last successful checkpoint persist. */
  private learnsSinceSave = 0;

  private constructor(
    runtime: SSMRuntime,
    agent: SSMAgent,
    memory: MemoryStore,
    semanticCache: SemanticCache | null,
    gpuAvailable: boolean,
    checkpointPath: string,
    saveEveryLearns: number,
  ) {
    this.runtime = runtime;
    this.agent = agent;
    this.memory = memory;
    this.semanticCache = semanticCache;
    this.gpuAvailable = gpuAvailable;
    this.checkpointPath = checkpointPath;
    this.saveEveryLearns = saveEveryLearns;
  }

  /**
   * Creates and initialises a new SsmMemoryService.
   *
   * GPU init is attempted first; if it fails (no @webgpu/node or no GPU),
   * the service falls back to memory-only operation (gpuAvailable = false).
   * Never throws — returns null if the @seanhogg/builderforce-memory package itself is missing.
   */
  static async create(opts: SsmMemoryServiceOptions = {}): Promise<SsmMemoryService | null> {
    const checkpointPath = resolveCheckpointPath(opts.checkpointPath);
    const checkpointUrl = resolveCheckpointUrl(opts.checkpointUrl);
    const modelSize = opts.modelSize ?? "small";
    const saveEveryLearns = opts.saveEveryLearns ?? DEFAULT_SAVE_EVERY_LEARNS;
    const seedIfMissing = opts.seedCheckpointIfMissing ?? true;
    const seed = opts.seed ?? DEFAULT_SEED;

    // Use indirect import to prevent TypeScript from resolving optional peer packages
    // that may not be installed. All three packages are optional runtime dependencies.
    const _import = (m: string): Promise<unknown> =>
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      new Function("m", "return import(m)")(m) as Promise<unknown>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let memoryMod: any;
    try {
      // Dynamic import so a missing package is a runtime no-op
      memoryMod = await _import("@seanhogg/builderforce-memory");
    } catch {
      logDebug("[ssm-memory] @seanhogg/builderforce-memory not available — skipping SSM memory layer");
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const { SSMRuntime, MemoryStore, SSMAgent, SemanticCache, FetchSemanticCacheBackend } =
      memoryMod as Record<string, any>;

    // IDBFactory — always available via fake-indexeddb
    let idbFactory: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeIdb = (await _import("fake-indexeddb")) as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      idbFactory = new fakeIdb.IDBFactory();
    } catch {
      logDebug("[ssm-memory] fake-indexeddb not available — IndexedDB will use global");
    }

    // GPU adapter — optional
    let gpuAdapter: unknown;
    let gpuAvailable = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const webgpuNode = (await _import("@webgpu/node")) as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      gpuAdapter = await webgpuNode
        .create()
        .requestAdapter({ powerPreference: "high-performance" });
      gpuAvailable = gpuAdapter != null;
    } catch {
      logDebug("[ssm-memory] @webgpu/node unavailable — SSM inference disabled");
    }

    // Build session options. A fixed seed makes the first-run (no-checkpoint)
    // weights byte-identical across machines.
    const sessionOpts: Record<string, unknown> = {
      modelSize,
      idbFactory,
      seed,
    };
    if (gpuAdapter) {
      sessionOpts["gpuAdapter"] = gpuAdapter;
    } else {
      sessionOpts["allowCpuFallback"] = true;
    }

    // Resolve the checkpoint from disk into a buffer. fetch() cannot read local
    // file paths in Node, so we read the bytes ourselves and pass them directly.
    // A missing checkpoint is NOT fatal — the model initialises fresh weights and
    // the memory layer still comes up (previously a failed fetch disabled it).
    let hadCheckpoint = false;
    let bytes: Buffer | null = null;
    try {
      bytes = await fs.readFile(checkpointPath);
    } catch {
      // No local checkpoint. If a hosted URL is configured, fetch it once and
      // cache to disk so future starts are offline and fast.
      if (checkpointUrl) {
        bytes = await fetchCheckpointToDisk(checkpointUrl, checkpointPath);
      }
    }
    if (bytes) {
      // Pass a tightly-sliced ArrayBuffer (Buffer may be a view into a larger pool).
      sessionOpts["checkpointBuffer"] = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      hadCheckpoint = true;
      logDebug(`[ssm-memory] loading checkpoint from ${checkpointPath} (${bytes.byteLength} bytes)`);
    } else {
      logDebug(
        `[ssm-memory] no checkpoint at ${checkpointPath} — initialising fresh seeded weights ` +
          `(seed=${seed}; generation quality will be poor until the model is trained or adapted)`,
      );
    }

    // Create runtime. If a checkpoint was found but is invalid/incompatible, retry
    // once without it rather than disabling the whole layer.
    let runtime: SSMRuntime;
    try {
      runtime = await SSMRuntime.create({ session: sessionOpts });
      logDebug(`[ssm-memory] SSMRuntime created (gpu=${gpuAvailable}, checkpoint=${hadCheckpoint})`);
    } catch (err) {
      if (hadCheckpoint) {
        logDebug(
          `[ssm-memory] checkpoint at ${checkpointPath} failed to load (${String(err)}) — ` +
            `retrying with fresh weights`,
        );
        delete sessionOpts["checkpointBuffer"];
        hadCheckpoint = false;
        try {
          runtime = await SSMRuntime.create({ session: sessionOpts });
        } catch (err2) {
          logDebug(`[ssm-memory] SSMRuntime.create() failed: ${String(err2)}`);
          return null;
        }
      } else {
        logDebug(`[ssm-memory] SSMRuntime.create() failed: ${String(err)}`);
        return null;
      }
    }

    // Memory store. Weight persistence is handled on disk via the checkpoint
    // path (below), not through the store's IndexedDB weight slot — in Node the
    // IndexedDB is in-memory (fake-indexeddb) and would not survive a restart.
    const memory = new MemoryStore({ idbFactory });

    // Agent
    const agent = new SSMAgent({ runtime, memory, persistHistory: true });
    try {
      await agent.init();
    } catch {
      // init() failure is non-fatal (no persisted history yet)
    }

    // Semantic response cache: L1 = on-device SSM embeddings (only meaningful
    // when the GPU/embedder is live), L2 = the gateway when a URL + key are set.
    let semanticCache: unknown = null;
    if (gpuAvailable && typeof SemanticCache === "function") {
      try {
        const gatewayUrl = opts.gatewayUrl ?? process.env["BUILDERFORCE_GATEWAY_URL"];
        const apiKey = opts.apiKey ?? process.env["BUILDERFORCE_API_KEY"];
        const namespace = opts.semanticCacheNamespace ?? process.env["BUILDERFORCE_SEMCACHE_NAMESPACE"];
        const l2 =
          gatewayUrl && apiKey && typeof FetchSemanticCacheBackend === "function"
            ? new FetchSemanticCacheBackend({ baseUrl: gatewayUrl, apiKey, namespace })
            : undefined;
        semanticCache = new SemanticCache({
          embed: (text: string) => runtime.embed(text),
          ...(l2 ? { l2 } : {}),
        });
        logDebug(`[ssm-memory] semantic cache enabled (L2 ${l2 ? "gateway" : "off"})`);
      } catch (err) {
        logDebug(`[ssm-memory] semantic cache init failed: ${String(err)}`);
        semanticCache = null;
      }
    }

    const svc = new SsmMemoryService(
      runtime,
      agent,
      memory,
      semanticCache,
      gpuAvailable,
      checkpointPath,
      saveEveryLearns,
    );

    // First-run seeding: persist the freshly-initialised weights so that the next
    // start loads identical (reproducible) weights instead of re-randomising, and
    // so the adaptation loop has a real file to append to. Best-effort.
    if (!hadCheckpoint && seedIfMissing) {
      await svc.saveCheckpoint();
    }

    return svc;
  }

  // ── Delegates ─────────────────────────────────────────────────────────────

  /**
   * Stores a fact in memory.
   * Delegates to `agent.memory.remember()`.
   */
  async remember(
    key: string,
    content: string,
    opts?: { ttlMs?: number; tags?: string[]; importance?: number },
  ): Promise<void> {
    await this.memory.remember(key, content, opts);
  }

  /**
   * Read-through semantic cache for an expensive (cortex) completion. Embeds
   * `query`, returns a paraphrase-matched cached answer when one exists (L1
   * on-device, then L2 gateway), otherwise runs `generate()`, caches it in both
   * tiers, and returns it. When the cache is unavailable it simply calls
   * `generate()`. Errors degrade to a direct `generate()` so caching can never
   * break a cortex call.
   *
   * Intended consumer: the cortex path (`callExecutionLlm` in
   * builderforcellm-local-stream) — wrap the provider call with this to avoid
   * re-billing the frontier model for semantically-repeated prompts.
   */
  async getCachedOrGenerate(
    query: string,
    generate: () => Promise<string>,
    meta?: Record<string, unknown>,
  ): Promise<{ response: string; cached: boolean }> {
    if (!this.semanticCache) {
      return { response: await generate(), cached: false };
    }
    try {
      return await this.semanticCache.getOrGenerate(query, generate, meta);
    } catch {
      return { response: await generate(), cached: false };
    }
  }

  /**
   * Returns the top-K semantically similar entries to `query`.
   * Falls back to an empty array if the runtime is unavailable.
   */
  async recallSimilar(query: string, topK = 5): Promise<Array<{ key: string; content: string }>> {
    try {
      const entries = await this.memory.recallSimilar(query, topK, this.runtime);
      return entries as Array<{ key: string; content: string }>;
    } catch {
      return [];
    }
  }

  /**
   * Fine-tunes the SSM on `text` (WSLA adaptation), then persists the adapted
   * weights to the on-disk checkpoint every `saveEveryLearns` calls so the
   * learning loop survives process restarts. No-op when GPU is unavailable.
   */
  async learn(text: string): Promise<void> {
    if (!this.gpuAvailable || !text.trim()) {
      return;
    }
    try {
      await this.agent.learn(text);
      this.learnsSinceSave++;
      if (this.learnsSinceSave >= this.saveEveryLearns) {
        await this.saveCheckpoint();
      }
    } catch (err) {
      logDebug(`[ssm-memory] learn() failed: ${String(err)}`);
    }
  }

  /**
   * Exports the current SSM weights and writes them to the on-disk checkpoint
   * (`checkpointPath`). This is the durable store for the adaptation loop — the
   * MBJS buffer is the same format `MambaSession` loads on startup.
   * Best-effort: failures are logged, never thrown.
   */
  async saveCheckpoint(): Promise<void> {
    try {
      // runtime.internals → MambaSession internals → live HybridMambaModel
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      const model = (this.runtime as any).internals?.model;
      if (!model || typeof model.exportWeights !== "function") {
        logDebug("[ssm-memory] saveCheckpoint() skipped — model export unavailable");
        return;
      }
      // fp16 export halves the on-disk size (~155 MB → ~78 MB for 'small') with
      // negligible precision loss; MambaSession loads v2 (fp32) and v3 (fp16) alike.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const buffer: ArrayBuffer = await model.exportWeights({ fp16: true });
      await fs.mkdir(path.dirname(this.checkpointPath), { recursive: true });
      await fs.writeFile(this.checkpointPath, Buffer.from(buffer));
      this.learnsSinceSave = 0;
      logDebug(`[ssm-memory] checkpoint saved to ${this.checkpointPath} (${buffer.byteLength} bytes, fp16)`);
    } catch (err) {
      logDebug(`[ssm-memory] saveCheckpoint() failed: ${String(err)}`);
    }
  }

  /**
   * Persists any pending adaptation to disk if there have been learn() calls
   * since the last save. Call on shutdown to avoid losing in-flight learning.
   */
  async flush(): Promise<void> {
    if (this.learnsSinceSave > 0) {
      await this.saveCheckpoint();
    }
  }

  /**
   * Runs distillation on a batch of inputs (if available) and persists weights.
   */
  async distillAndSave(inputs: string[]): Promise<void> {
    if (!this.gpuAvailable || inputs.length === 0) {
      return;
    }
    try {
      for (const input of inputs) {
        await this.agent.learn(input);
      }
      await this.saveCheckpoint();
    } catch (err) {
      logDebug(`[ssm-memory] distillAndSave() failed: ${String(err)}`);
    }
  }

  /**
   * Returns the top-5 recent team memory entries formatted as a context block.
   * Delegates to the KnowledgeLoopService.pullTeamMemory() if available.
   * Returns an empty string when team memory is unavailable.
   * (P4-5)
   */
  async buildTeamMemoryContext(): Promise<string> {
    return bridgeBuildTeamMemoryContext();
  }

  /**
   * Destroys the SSM runtime and releases GPU resources.
   * Persists any pending adaptation to disk first.
   */
  async destroy(): Promise<void> {
    await this.flush();
    try {
      await this.agent.destroy();
    } catch {
      try {
        this.runtime.destroy();
      } catch {
        // ignore
      }
    }
  }
}

// ── Singleton registry ────────────────────────────────────────────────────────

/**
 * SsmMemoryRegistry encapsulates the process-wide SSM memory service instance.
 * Using a class rather than a module-level `let` variable makes the state
 * explicit and allows the instance to be replaced with a test double.
 */
export class SsmMemoryRegistry {
  private instance: SsmMemoryService | null = null;

  /** Returns the current SSM memory service instance, or null if not initialised. */
  get(): SsmMemoryService | null {
    return this.instance;
  }

  /** Called once at gateway startup to initialise the SSM memory service. */
  async init(opts?: SsmMemoryServiceOptions): Promise<SsmMemoryService | null> {
    try {
      this.instance = await SsmMemoryService.create(opts ?? {});
      if (this.instance) {
        logDebug(`[ssm-memory] initialised (gpu=${this.instance.gpuAvailable})`);
      }
    } catch (err) {
      logDebug(`[ssm-memory] init failed: ${String(err)}`);
      this.instance = null;
    }
    return this.instance;
  }
}

/** Process-wide singleton registry. */
export const ssmMemoryRegistry = new SsmMemoryRegistry();

// ── Module-level shims (backward-compatible API) ───────────────────────────────

/** Returns the gateway-level SSM memory service singleton, or null if not initialised. */
export function getSsmMemoryService(): SsmMemoryService | null {
  return ssmMemoryRegistry.get();
}

/** Called once at gateway startup to initialise the SSM memory service. */
export async function initSsmMemoryService(
  opts?: SsmMemoryServiceOptions,
): Promise<SsmMemoryService | null> {
  return ssmMemoryRegistry.init(opts);
}
