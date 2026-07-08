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
      return `[Mamba provider not ready${this._failureReason ? `: ${this._failureReason}` : ' — train the model first'}]`;
    }
    const prompt = this.buildPrompt(input, context);
    const promptIds: number[] = this.tokenizer.encode(prompt);
    const outputIds: number[] = await this.model.generate(
      promptIds,
      context?.maxTokens ?? 200,
      { temperature: context?.temperature ?? 0.8 }
    );
    return this.tokenizer.decode(outputIds);
  }

  async stream(
    input: string,
    context?: ModelContext,
    onToken?: (token: string) => void
  ): Promise<string> {
    const result = await this.generate(input, context);
    // @seanhogg/builderforce-memory-engine does not expose a streaming API yet — simulate per-word
    if (onToken) {
      const words = result.split(' ');
      for (const word of words) {
        onToken(word + ' ');
        await new Promise<void>((r) => setTimeout(r, 8));
      }
    }
    return result;
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

