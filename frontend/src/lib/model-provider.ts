/**
 * Model Abstraction Layer — BuilderForce.ai
 *
 * Defines the pluggable ModelProvider interface so that BuilderForce Agents agents
 * can switch between Mamba (on-device WebGPU) and external LLMs without
 * changing agent logic.
 *
 * Supported backends:
 *   - MambaModelProvider  — on-device WebGPU inference via @seanhogg/builderforce-memory-engine
 *   - ExternalLLMProvider — cloud inference via Workers AI / OpenRouter
 */

import type { MambaModel, MambaTrainer, BPETokenizer } from '@seanhogg/builderforce-memory-engine';
import { sendAIMessage } from './api';
import { hasWebGPU, withSemanticResponseCache } from './semantic-cache';

/** The dynamically-imported engine module + the device type it hands back. */
type MambaEngineModule = typeof import('@seanhogg/builderforce-memory-engine');
type MambaDevice = Awaited<ReturnType<MambaEngineModule['initWebGPU']>>['device'];

/** BPE merges to learn when training a tokenizer on-device from the corpus, since
 *  the static /vocab.json + /merges.txt are optional and usually not shipped —
 *  enough vocab for a code-corpus training run. */
const MAMBA_CORPUS_NUM_MERGES = 2000;

/** A stable text key for a message list — what determines the answer, so semantically
 *  equal prompts (same context, paraphrased) can share a cached response. */
function cacheQuery(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
}

/** Emit a fixed string word-by-word through `onToken` (used only for the
 *  not-ready fallback path, where there is no real model to stream from). */
async function wordStream(text: string, onToken: (token: string) => void): Promise<void> {
  for (const word of text.split(' ')) {
    onToken(word + ' ');
    await new Promise<void>((r) => setTimeout(r, 8));
  }
}

// ---------------------------------------------------------------------------
// Core interfaces
// ---------------------------------------------------------------------------

export interface ModelContext {
  /** Optional system-level instruction */
  systemPrompt?: string;
  /** Full message history (overrides bare `input` when provided) */
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Sampling temperature (0–2) */
  temperature?: number;
  /** Injected Mamba memory context string */
  memoryContext?: string;
  /** Active file content for code assistance */
  fileContext?: string;
}

export interface ModelProvider {
  /** Unique identifier for this provider (e.g. 'mamba', 'workers-ai') */
  readonly id: string;
  /** Human-readable display name */
  readonly name: string;
  /** True when the provider runs entirely on-device (no network calls) */
  readonly isLocal: boolean;

  /** Generate a response given a prompt and optional context */
  generate(input: string, context?: ModelContext): Promise<string>;

  /**
   * Stream generated tokens via a callback.
   * Returns the full accumulated response when complete.
   */
  stream(
    input: string,
    context?: ModelContext,
    onToken?: (token: string) => void
  ): Promise<string>;

  /** Returns true if the provider is ready to accept requests */
  isReady(): boolean;

  /** Initialise the provider (load model weights, request GPU device, etc.) */
  init?(): Promise<void>;

  /** Release any held resources */
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export interface MambaProviderConfig {
  /** Vocabulary size — default 151936 (Qwen3.5-Coder) */
  vocabSize?: number;
  /** Model dimensionality */
  dModel?: number;
  /** Number of Mamba blocks */
  numLayers?: number;
  /** SSM state dimension */
  dState?: number;
  /** Causal convolution kernel size */
  dConv?: number;
  /** Inner expansion factor */
  expand?: number;
  /** Path to BPE vocab.json served from the browser */
  vocabUrl?: string;
  /** Path to BPE merges.txt served from the browser */
  mergesUrl?: string;
  /** Use WSLA mode — fine-tunes only B and C matrices */
  wsla?: boolean;
}

export interface ExternalLLMConfig {
  /** Project / workspace ID used to route requests through the worker */
  projectId: string | number;
  /** Optional provider label shown in the UI */
  label?: string;
}

// ---------------------------------------------------------------------------
// MambaModelProvider — on-device WebGPU inference via @seanhogg/builderforce-memory-engine
// ---------------------------------------------------------------------------

export class MambaModelProvider implements ModelProvider {
  readonly id = 'mamba';
  readonly name = 'Mamba (On-Device WebGPU)';
  readonly isLocal = true;

  private config: Required<
    Pick<MambaProviderConfig, 'vocabSize' | 'dModel' | 'numLayers' | 'dState' | 'dConv' | 'expand' | 'vocabUrl' | 'mergesUrl' | 'wsla'>
  >;
  private _ready = false;

  // Typed loosely so the file compiles without the package being in scope at type-check time
  private model: MambaModel | null = null;
  private tokenizer: BPETokenizer | null = null;
  private trainer: MambaTrainer | null = null;
  private device: MambaDevice | null = null;
  private engine: MambaEngineModule | null = null;
  /** Why init() did not become ready — surfaced to the UI so a failure isn't
   *  always (mis)blamed on WebGPU. null when ready or not yet initialised. */
  private _failureReason: string | null = null;

  constructor(config: MambaProviderConfig = {}) {
    this.config = {
      vocabSize: config.vocabSize ?? 151936,
      dModel: config.dModel ?? 512,
      numLayers: config.numLayers ?? 8,
      dState: config.dState ?? 16,
      dConv: config.dConv ?? 4,
      expand: config.expand ?? 2,
      vocabUrl: config.vocabUrl ?? '/vocab.json',
      mergesUrl: config.mergesUrl ?? '/merges.txt',
      wsla: config.wsla ?? false,
    };
  }

  /**
   * Initialise the Mamba backend: acquire the WebGPU device. The tokenizer + model
   * are built lazily in {@link train} from the training corpus (on-device BPE over
   * your own code) — the static /vocab.json + /merges.txt are an OPTIONAL fast path,
   * so a deployment that doesn't ship them still trains. "Ready" means the WebGPU
   * device is up; a failure records {@link failureReason} (WebGPU vs. a real init
   * error) instead of silently blaming WebGPU.
   */
  async init(): Promise<void> {
    if (this._ready) return;
    this._failureReason = null;

    // WebGPU gate — the ONLY hard requirement. `hasWebGPU()` is a feature check;
    // `initWebGPU()` below does the real adapter/device request, whose failure
    // (present but no adapter) is captured with its actual message.
    if (!hasWebGPU()) {
      this._failureReason = 'WebGPU is not available in this browser';
      this._ready = false;
      return;
    }

    try {
      // Dynamic import — @seanhogg/builderforce-memory-engine is a pure-ESM browser library.
      const mamba = await import('@seanhogg/builderforce-memory-engine');
      this.engine = mamba;

      const { device } = await mamba.initWebGPU();
      this.device = device;

      // GPUDevice.lost recovery — a discrete-GPU reset, tab suspension, or driver
      // crash silently invalidates every buffer/pipeline. Subscribe once so the
      // NEXT generate()/train() re-initialises instead of failing on dead handles.
      // (The article calls this out; without it, on-device inference just breaks.)
      this.watchDeviceLoss(device);

      // Fast path: if pre-built tokenizer assets ARE deployed, load them + build the
      // model up-front. Otherwise the tokenizer is trained from the corpus in train().
      const assetsPresent = await Promise.all([
        fetch(this.config.vocabUrl, { method: 'HEAD' }).then((r) => r.ok).catch(() => false),
        fetch(this.config.mergesUrl, { method: 'HEAD' }).then((r) => r.ok).catch(() => false),
      ]);
      if (assetsPresent[0] && assetsPresent[1]) {
        const tokenizer = new mamba.BPETokenizer();
        await tokenizer.load(this.config.vocabUrl, this.config.mergesUrl);
        this.buildModel(tokenizer);
      }

      // The device is up — ready to train (tokenizer/model built lazily from the
      // corpus when the assets weren't preloaded above).
      this._ready = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[MambaModelProvider] Initialisation failed:', err);
      this._failureReason = message || 'WebGPU device initialisation failed';
      this._ready = false;
    }
  }

  isReady(): boolean {
    return this._ready;
  }

  /** Why init() did not become ready — for accurate UI diagnostics (so a WebGPU-OK
   *  browser doesn't see "WebGPU unavailable" when the real cause was different). */
  failureReason(): string | null {
    return this._failureReason;
  }

  async generate(input: string, context?: ModelContext): Promise<string> {
    if (!this._ready || !this.model || !this.tokenizer) {
      return this.notReadyMessage();
    }
    return this.runGeneration(input, context);
  }

  async stream(
    input: string,
    context?: ModelContext,
    onToken?: (token: string) => void
  ): Promise<string> {
    if (!this._ready || !this.model || !this.tokenizer) {
      const msg = this.notReadyMessage();
      // Preserve the word-streamed fallback so a consumer wired only to onToken
      // still surfaces the reason (and callers can rely on ≥1 token being emitted).
      if (onToken) await wordStream(msg, onToken);
      return msg;
    }
    return this.runGeneration(input, context, onToken);
  }

  /**
   * REAL token-by-token generation. The engine recomputes the forward pass over
   * the full sequence each decode step (no KV cache), so decoding one token at a
   * time here costs exactly the same as the engine's internal `generate` loop —
   * but lets us surface each token the instant it is produced (true streaming,
   * dominating TTFT/perceived latency) instead of faking it after the fact.
   *
   * The returned string is `decode(prompt + completion)` — unchanged from the
   * prior contract — and the concatenation of streamed deltas equals it exactly.
   */
  private async runGeneration(
    input: string,
    context?: ModelContext,
    onToken?: (token: string) => void,
  ): Promise<string> {
    const model = this.model!;
    const tokenizer = this.tokenizer!;
    const prompt = this.buildPrompt(input, context);
    const maxTokens = context?.maxTokens ?? 200;
    const temperature = context?.temperature ?? 0.8;

    let ids: number[] = tokenizer.encode(prompt);
    let emitted = '';
    if (onToken) {
      // Surface the (instantly available) prompt echo first so streamed deltas
      // stay consistent with the full returned string.
      emitted = tokenizer.decode(ids);
      if (emitted) onToken(emitted);
    }

    for (let i = 0; i < maxTokens; i++) {
      const next = await model.generate(ids, 1, { temperature });
      if (next.length <= ids.length) break; // no new token → EOS reached
      ids = next;
      if (onToken) {
        const full = tokenizer.decode(ids);
        const delta = full.slice(emitted.length);
        if (delta) {
          onToken(delta);
          emitted = full;
        }
      }
    }

    return onToken ? emitted : tokenizer.decode(ids);
  }

  private notReadyMessage(): string {
    return `[Mamba provider not ready${this._failureReason ? `: ${this._failureReason}` : ' — train the model first'}]`;
  }

  /**
   * Wire GPUDevice.lost so a lost device tears down the model and flips the
   * provider back to "not ready" — a subsequent init() re-acquires cleanly.
   * WebGPU only ever resolves `device.lost` once, so this is attached once.
   */
  private watchDeviceLoss(device: MambaDevice): void {
    const lost = (device as unknown as { lost?: Promise<{ reason?: string; message?: string }> }).lost;
    if (!lost || typeof lost.then !== 'function') return;
    void lost.then((info) => {
      // `reason === 'destroyed'` is our own dispose() — not an error worth surfacing.
      if (info?.reason === 'destroyed') return;
      console.warn('[MambaModelProvider] WebGPU device lost — will re-initialise on next use:', info);
      this._failureReason = `WebGPU device lost${info?.message ? `: ${info.message}` : ''}`;
      this._ready = false;
      this.model = null;
      this.tokenizer = null;
      this.trainer = null;
      this.device = null;
    });
  }

  /**
   * Fine-tune the model on a local code string using the Mamba trainer.
   * Optionally restrict updates to B and C matrices only (WSLA mode).
   */
  async train(
    codeText: string,
    options?: {
      learningRate?: number;
      epochs?: number;
      wsla?: boolean;
      onEpochEnd?: (epoch: number, loss: number) => void;
    }
  ): Promise<number[]> {
    if (!this._ready) {
      throw new Error(
        this._failureReason
          ? `[MambaModelProvider] not ready: ${this._failureReason}`
          : '[MambaModelProvider] Provider not ready — call init() first',
      );
    }
    // Build the tokenizer (from this corpus) + model on first train when the static
    // assets weren't preloaded in init().
    this.ensureModelForCorpus(codeText);
    if (!this.trainer) throw new Error('[MambaModelProvider] tokenizer/model build failed');
    return this.trainer.train(codeText, {
      learningRate: options?.learningRate ?? 1e-4,
      epochs: options?.epochs ?? 3,
      wsla: options?.wsla ?? this.config.wsla,
      onEpochEnd: options?.onEpochEnd,
    });
  }

  /**
   * Serialise the REAL trained model weights to an ArrayBuffer (MBJS binary
   * format) so they can be persisted (e.g. uploaded to R2 as a training
   * artifact). These are the actual gradient-updated parameters produced by
   * the real MambaTrainer — not a placeholder.
   *
   * @param opts.fp16 emit a v3 (half-precision) checkpoint (~half the bytes).
   */
  async exportTrainedWeights(opts?: { fp16?: boolean }): Promise<ArrayBuffer> {
    if (!this._ready || !this.model) {
      throw new Error('[MambaModelProvider] Provider not ready — call init() first');
    }
    return this.model.exportWeights(opts);
  }

  dispose(): void {
    this.model = null;
    this.tokenizer = null;
    this.trainer = null;
    this.device = null;
    this.engine = null;
    this._failureReason = null;
    this._ready = false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Build the Mamba model + trainer from a ready tokenizer, sized to its vocab. */
  private buildModel(tokenizer: BPETokenizer): void {
    if (!this.engine || !this.device) return;
    this.tokenizer = tokenizer;
    this.model = new this.engine.MambaModel(this.device, {
      vocabSize: tokenizer.vocabSize,
      dModel: this.config.dModel,
      numLayers: this.config.numLayers,
      dState: this.config.dState,
      dConv: this.config.dConv,
      expand: this.config.expand,
    });
    this.trainer = new this.engine.MambaTrainer(this.model, tokenizer);
  }

  /** Ensure a tokenizer + model exist, training a BPE over the corpus on first use
   *  when no static /vocab.json + /merges.txt were preloaded. No-op once built. */
  private ensureModelForCorpus(corpus: string): void {
    if (this.model && this.tokenizer && this.trainer) return;
    if (!this.engine) throw new Error('[MambaModelProvider] engine not initialised — call init() first');
    const tokenizer = new this.engine.BPETokenizer();
    tokenizer.train(corpus, { numMerges: MAMBA_CORPUS_NUM_MERGES });
    this.buildModel(tokenizer);
  }

  private buildPrompt(input: string, context?: ModelContext): string {
    const parts: string[] = [];
    if (context?.systemPrompt) parts.push(context.systemPrompt);
    if (context?.memoryContext) parts.push(`[Memory: ${context.memoryContext}]`);
    if (context?.fileContext) parts.push(`[File context]\n${context.fileContext}`);
    parts.push(input);
    return parts.join('\n\n');
  }
}

// ---------------------------------------------------------------------------
// ExternalLLMProvider — cloud inference via Workers AI / OpenRouter
// ---------------------------------------------------------------------------

export class ExternalLLMProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal = false;

  private config: ExternalLLMConfig;

  constructor(config: ExternalLLMConfig) {
    this.config = config;
    this.id = 'external-llm';
    this.name = config.label ?? 'External LLM (Workers AI)';
  }

  isReady(): boolean {
    return true;
  }

  async generate(input: string, context?: ModelContext): Promise<string> {
    const messages = this.buildMessages(input, context);
    const { response } = await withSemanticResponseCache(cacheQuery(messages), async () => {
      let result = '';
      await sendAIMessage(this.config.projectId, messages, (chunk) => {
        result += chunk;
      });
      return result;
    });
    return response;
  }

  async stream(
    input: string,
    context?: ModelContext,
    onToken?: (token: string) => void
  ): Promise<string> {
    const messages = this.buildMessages(input, context);
    const { response, cached } = await withSemanticResponseCache(cacheQuery(messages), async () => {
      let result = '';
      await sendAIMessage(this.config.projectId, messages, (chunk) => {
        result += chunk;
        onToken?.(chunk);
      });
      return result;
    });
    // On a cache hit the generator never ran, so nothing streamed — emit the cached
    // answer as a single chunk so the consumer still receives it.
    if (cached) onToken?.(response);
    return response;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildMessages(
    input: string,
    context?: ModelContext
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

    const sysParts: string[] = [];
    if (context?.systemPrompt) sysParts.push(context.systemPrompt);
    if (context?.memoryContext) sysParts.push(`Agent memory: ${context.memoryContext}`);
    if (context?.fileContext) {
      sysParts.push(`Active file:\n\`\`\`\n${context.fileContext}\n\`\`\``);
    }
    if (sysParts.length > 0) {
      messages.push({ role: 'system', content: sysParts.join('\n\n') });
    }

    if (context?.messages?.length) {
      messages.push(...context.messages);
    } else {
      messages.push({ role: 'user', content: input });
    }

    return messages;
  }
}

// ---------------------------------------------------------------------------
// PromptApiModelProvider — Chrome's built-in Gemini Nano via the Prompt API
// ---------------------------------------------------------------------------
//
// Tier-1 local backend: zero download for the app (the model ships with the
// browser), no VRAM budget to manage, and real token streaming. Feature-detected
// so it silently no-ops where unavailable (every non-Chrome browser today).

/** Minimal structural typing for the Chrome Prompt API (`window.LanguageModel`,
 *  Chrome 138+). Kept local so we don't depend on ambient DOM-lib updates. */
interface PromptApiSession {
  prompt(input: string, opts?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming(input: string, opts?: { signal?: AbortSignal }): ReadableStream<string>;
  clone(): Promise<PromptApiSession>;
  destroy(): void;
  readonly inputUsage?: number;
  readonly inputQuota?: number;
  /** Legacy (pre-138) token accounting; guarded because newer builds drop it. */
  countPromptTokens?(input: string): Promise<number>;
}
interface PromptApiFactory {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts?: {
    temperature?: number;
    topK?: number;
    initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    signal?: AbortSignal;
    monitor?: (m: EventTarget) => void;
  }): Promise<PromptApiSession>;
}

/** Resolve the Prompt API factory across the current global (`LanguageModel`) and
 *  the legacy `self.ai.languageModel` surface, or null when the browser lacks it. */
function promptApiFactory(): PromptApiFactory | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    LanguageModel?: PromptApiFactory;
    ai?: { languageModel?: PromptApiFactory };
  };
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}

/** True when this browser exposes the built-in Prompt API surface at all.
 *  (Actual model availability is async — see {@link PromptApiModelProvider.init}.) */
export function hasPromptApi(): boolean {
  return promptApiFactory() !== null;
}

export interface PromptApiProviderConfig {
  /** System instruction applied to every session (the article's "You are a concise…"). */
  systemPrompt?: string;
  temperature?: number;
  topK?: number;
}

export class PromptApiModelProvider implements ModelProvider {
  readonly id = 'prompt-api';
  readonly name = 'Chrome Built-in (Gemini Nano)';
  readonly isLocal = true;

  private session: PromptApiSession | null = null;
  private _ready = false;
  private _failureReason: string | null = null;
  private readonly config: PromptApiProviderConfig;

  constructor(config: PromptApiProviderConfig = {}) {
    this.config = config;
  }

  async init(): Promise<void> {
    if (this._ready) return;
    this._failureReason = null;

    const factory = promptApiFactory();
    if (!factory) {
      this._failureReason = 'Chrome Prompt API (built-in AI) is not available in this browser';
      return;
    }
    try {
      const status = await factory.availability();
      if (status === 'unavailable') {
        this._failureReason = 'Built-in model is unavailable on this device';
        return;
      }
      // 'downloadable'/'downloading' still let create() proceed — the browser
      // fetches/awaits the model, surfacing progress via the monitor.
      const initialPrompts = this.config.systemPrompt
        ? [{ role: 'system' as const, content: this.config.systemPrompt }]
        : undefined;
      this.session = await factory.create({
        temperature: this.config.temperature,
        topK: this.config.topK,
        initialPrompts,
      });
      this._ready = true;
    } catch (err) {
      this._failureReason = err instanceof Error ? err.message : String(err);
      this._ready = false;
    }
  }

  isReady(): boolean {
    return this._ready && this.session !== null;
  }

  failureReason(): string | null {
    return this._failureReason;
  }

  /** Best-effort remaining context budget, so callers can proactively trim
   *  history before the session's fixed token quota is exhausted. */
  tokenBudget(): { used: number; quota: number } | null {
    const s = this.session;
    if (!s || s.inputUsage === undefined || s.inputQuota === undefined) return null;
    return { used: s.inputUsage, quota: s.inputQuota };
  }

  async generate(input: string, context?: ModelContext): Promise<string> {
    if (!this.session) return `[Prompt API not ready${this._failureReason ? `: ${this._failureReason}` : ''}]`;
    return this.session.prompt(this.buildInput(input, context));
  }

  async stream(
    input: string,
    context?: ModelContext,
    onToken?: (token: string) => void,
  ): Promise<string> {
    if (!this.session) {
      const msg = `[Prompt API not ready${this._failureReason ? `: ${this._failureReason}` : ''}]`;
      if (onToken) await wordStream(msg, onToken);
      return msg;
    }
    const stream = this.session.promptStreaming(this.buildInput(input, context));
    const reader = stream.getReader();
    let full = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (typeof value !== 'string') continue;
        // Chrome ≥138 yields incremental deltas; older builds yielded the full
        // cumulative string. Normalise to a delta so onToken never double-counts.
        const delta = value.startsWith(full) ? value.slice(full.length) : value;
        full = value.startsWith(full) ? value : full + value;
        if (delta) onToken?.(delta);
      }
    } finally {
      reader.releaseLock();
    }
    return full;
  }

  dispose(): void {
    this.session?.destroy();
    this.session = null;
    this._ready = false;
    this._failureReason = null;
  }

  private buildInput(input: string, context?: ModelContext): string {
    const parts: string[] = [];
    // The system prompt is applied at session creation; here we fold in the
    // per-turn memory/file context the same way the other providers do.
    if (context?.memoryContext) parts.push(`[Memory: ${context.memoryContext}]`);
    if (context?.fileContext) parts.push(`[File context]\n${context.fileContext}`);
    parts.push(input);
    return parts.join('\n\n');
  }
}

// ---------------------------------------------------------------------------
// CascadingModelProvider — the article's progressive-enhancement chain
// ---------------------------------------------------------------------------
//
// Wraps an ordered list of backends behind ONE ModelProvider. init() picks the
// highest-priority backend that becomes ready; generate()/stream() route to it
// and transparently fall through to the next ready backend on failure. This is
// the single place the "which backend?" decision lives (DRY) — consumers just
// talk to a ModelProvider and never branch on availability themselves.

export class CascadingModelProvider implements ModelProvider {
  readonly id = 'cascade';
  readonly name = 'Local-first cascade';

  private readonly tiers: ModelProvider[];
  private _initialised = false;

  constructor(tiers: ModelProvider[]) {
    if (tiers.length === 0) throw new Error('CascadingModelProvider requires at least one tier');
    this.tiers = tiers;
  }

  get isLocal(): boolean {
    return this.pick().isLocal;
  }

  async init(): Promise<void> {
    if (this._initialised) return;
    this._initialised = true;
    // Initialise every tier that exposes init(); a tier that fails to become
    // ready simply won't be picked. Run sequentially so a cheap high-priority
    // tier (Prompt API) settles before we spin up an expensive one.
    for (const tier of this.tiers) {
      try {
        await tier.init?.();
      } catch {
        // A tier's init failure is non-fatal — the cascade falls to the next.
      }
    }
  }

  isReady(): boolean {
    return this.tiers.some((t) => t.isReady());
  }

  /** The active backend: highest-priority ready tier, else the last tier
   *  (by construction the cloud fallback, which is always ready). */
  active(): ModelProvider {
    return this.pick();
  }

  private pick(): ModelProvider {
    return this.tiers.find((t) => t.isReady()) ?? this.tiers[this.tiers.length - 1]!;
  }

  /** Ready tiers in priority order, starting at `from` — the fallthrough set. */
  private readyFrom(from: ModelProvider): ModelProvider[] {
    const start = this.tiers.indexOf(from);
    const rest = this.tiers.slice(start).filter((t) => t.isReady());
    // Always keep the last tier (cloud) as a terminal fallback even if a local
    // tier reports ready but then throws.
    const last = this.tiers[this.tiers.length - 1]!;
    if (!rest.includes(last)) rest.push(last);
    return rest;
  }

  async generate(input: string, context?: ModelContext): Promise<string> {
    let lastErr: unknown;
    for (const tier of this.readyFrom(this.pick())) {
      try {
        return await tier.generate(input, context);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error('No inference backend available');
  }

  async stream(
    input: string,
    context?: ModelContext,
    onToken?: (token: string) => void,
  ): Promise<string> {
    let lastErr: unknown;
    for (const tier of this.readyFrom(this.pick())) {
      try {
        return await tier.stream(input, context, onToken);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error('No inference backend available');
  }

  dispose(): void {
    for (const tier of this.tiers) tier.dispose?.();
  }
}

export interface InferenceCascadeConfig {
  /** Project/workspace id used by the cloud fallback tier. */
  projectId: string | number;
  /** System instruction handed to local backends that support one. */
  systemPrompt?: string;
  /**
   * An already-configured on-device model to slot in as a mid-tier — typically a
   * trained {@link MambaModelProvider} (or its worker-backed variant). Omitted
   * when the app has no user-trained local model, in which case the cascade is
   * simply Prompt API → cloud.
   */
  local?: ModelProvider;
  /** Cloud provider label surfaced in the UI. */
  cloudLabel?: string;
}

/**
 * Build the local-first inference cascade: Chrome Prompt API (Tier 1, when the
 * browser exposes it) → optional on-device trained model (Tier 2) → cloud LLM
 * (Tier 3, always available). Returns a single ModelProvider; call `init()` once
 * and then `generate`/`stream` — routing and fallback are handled internally.
 */
export function createInferenceProvider(config: InferenceCascadeConfig): CascadingModelProvider {
  const tiers: ModelProvider[] = [];
  if (hasPromptApi()) {
    tiers.push(new PromptApiModelProvider({ systemPrompt: config.systemPrompt }));
  }
  if (config.local) {
    tiers.push(config.local);
  }
  tiers.push(new ExternalLLMProvider({ projectId: config.projectId, label: config.cloudLabel }));
  return new CascadingModelProvider(tiers);
}

