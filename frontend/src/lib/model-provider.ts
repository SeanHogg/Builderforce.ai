/**
 * Model Abstraction Layer — BuilderForce.ai
 *
 * Defines the pluggable ModelProvider interface so that CoderClaw agents
 * can switch between Mamba (on-device WebGPU) and external LLMs without
 * changing agent logic.
 *
 * Supported backends:
 *   - MambaModelProvider  — on-device WebGPU inference via mambacode.js
 *   - ExternalLLMProvider — cloud inference via Workers AI / OpenRouter
 */

import type { MambaModel, MambaTrainer, BPETokenizer } from 'mambacode.js';
import { sendAIMessage } from './api';

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
// MambaModelProvider — on-device WebGPU inference via mambacode.js
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
   * Initialise the Mamba backend.
   * Dynamically imports mambacode.js so the bundle is not broken in
   * environments where the package is absent or WebGPU is unavailable.
   * Skips silently when the browser has no WebGPU OR the tokenizer
   * asset files aren't deployed — both are expected states today.
   */
  async init(): Promise<void> {
    if (this._ready) return;

    // WebGPU gate — no point loading tokenizer assets if the device
    // doesn't support WebGPU in the first place.
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      this._ready = false;
      return;
    }

    // Asset gate — avoid the noisy /vocab.json 404 in deployments that
    // haven't shipped tokenizer assets. HEAD is cheap and cached.
    const assetsPresent = await Promise.all([
      fetch(this.config.vocabUrl, { method: 'HEAD' }).then((r) => r.ok).catch(() => false),
      fetch(this.config.mergesUrl, { method: 'HEAD' }).then((r) => r.ok).catch(() => false),
    ]);
    if (!assetsPresent[0] || !assetsPresent[1]) {
      this._ready = false;
      return;
    }

    try {
      // Dynamic import — mambacode.js is a pure-ESM browser library
      const mamba = await import('mambacode.js');

      const { device } = await mamba.initWebGPU();

      const tokenizer = new mamba.BPETokenizer();
      await tokenizer.load(this.config.vocabUrl, this.config.mergesUrl);
      this.tokenizer = tokenizer;

      this.model = new mamba.MambaModel(device, {
        vocabSize: this.config.vocabSize,
        dModel: this.config.dModel,
        numLayers: this.config.numLayers,
        dState: this.config.dState,
        dConv: this.config.dConv,
        expand: this.config.expand,
      });

      this.trainer = new mamba.MambaTrainer(this.model, this.tokenizer);
      this._ready = true;
    } catch (err) {
      console.warn('[MambaModelProvider] Initialisation failed:', err);
      this._ready = false;
    }
  }

  isReady(): boolean {
    return this._ready;
  }

  async generate(input: string, context?: ModelContext): Promise<string> {
    if (!this._ready || !this.model || !this.tokenizer) {
      return '[Mamba provider not ready — WebGPU may be unavailable]';
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
    // mambacode.js does not expose a streaming API yet — simulate per-word
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
    if (!this._ready || !this.trainer) {
      throw new Error('[MambaModelProvider] Provider not ready — call init() first');
    }
    return this.trainer.train(codeText, {
      learningRate: options?.learningRate ?? 1e-4,
      epochs: options?.epochs ?? 3,
      wsla: options?.wsla ?? this.config.wsla,
      onEpochEnd: options?.onEpochEnd,
    });
  }

  dispose(): void {
    this.model = null;
    this.tokenizer = null;
    this.trainer = null;
    this._ready = false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
    let result = '';
    await sendAIMessage(this.config.projectId, messages, (chunk) => {
      result += chunk;
    });
    return result;
  }

  async stream(
    input: string,
    context?: ModelContext,
    onToken?: (token: string) => void
  ): Promise<string> {
    const messages = this.buildMessages(input, context);
    let result = '';
    await sendAIMessage(this.config.projectId, messages, (chunk) => {
      result += chunk;
      onToken?.(chunk);
    });
    return result;
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
// Provider registry
// ---------------------------------------------------------------------------

const _registry = new Map<string, ModelProvider>();

/** Register a ModelProvider by its id. Replaces any existing registration. */
export function registerProvider(provider: ModelProvider): void {
  _registry.set(provider.id, provider);
}

/** Retrieve a provider by id. Returns undefined if not registered. */
export function getProvider(id: string): ModelProvider | undefined {
  return _registry.get(id);
}

/** Return all registered providers as an array. */
export function listProviders(): ModelProvider[] {
  return Array.from(_registry.values());
}

/** Unregister a provider by id. */
export function unregisterProvider(id: string): void {
  _registry.delete(id);
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create and initialise a MambaModelProvider.
 * Returns the provider regardless of whether init succeeded so callers can
 * check `isReady()` and fall back gracefully.
 */
export async function createMambaProvider(
  config?: MambaProviderConfig
): Promise<MambaModelProvider> {
  const provider = new MambaModelProvider(config);
  await provider.init();
  return provider;
}

/**
 * Create an ExternalLLMProvider backed by the BuilderForce worker API.
 */
export function createExternalLLMProvider(
  config: ExternalLLMConfig
): ExternalLLMProvider {
  return new ExternalLLMProvider(config);
}
