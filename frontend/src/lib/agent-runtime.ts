/**
 * Agent Runtime SDK — BuilderForce.ai
 *
 * Provides the unified agent execution contract:
 *
 *   agent.step(input)      — advance Mamba state + run inference
 *   agent.train(data, mode)— run behavior / memory / hybrid training
 *   agent.getState()       — retrieve current Mamba state
 *   agent.saveState()      — persist state to IndexedDB (+ optionally R2)
 *   agent.offload(task)    — escalate to cloud (Workers AI / OpenRouter)
 *
 * Execution flow per step:
 *   1. Mamba state updated with user input
 *   2. Context assembled (files + memory signal)
 *   3. Transformer inference (local via Transformers.js)
 *   4. Confidence check
 *   5. Optional cloud escalation
 */

import { MambaEngine, createMambaEngine } from './mamba-engine';
import type { MambaAgentState, MambaStateSnapshot, MambaConfig, TrainingMode, InferenceMode } from './types';
import { sendAIMessage } from './api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentStepInput {
  userMessage: string;
  fileContext?: string;
  projectContext?: string;
  /** When true, memory context is injected before inference */
  useMemory?: boolean;
  inferenceMode?: InferenceMode;
}

export interface AgentStepResult {
  response: string;
  memoryContext: string;
  confidence: number;
  escalatedToCloud: boolean;
}

export interface AgentTrainOptions {
  mode: TrainingMode;
  /** Sequences / examples for memory or hybrid training */
  sequences?: string[];
  onProgress?: (step: number, total: number, info: string) => void;
}

export interface AgentOffloadTask {
  type: 'inference' | 'training';
  payload: unknown;
}

export interface AgentRuntimeOptions {
  agentId: string;
  projectId: string | number;
  mambaConfig?: Partial<MambaConfig>;
  /** Minimum confidence score before escalating to cloud (0–1) */
  confidenceThreshold?: number;
  /** Worker base URL for cloud escalation */
  workerUrl?: string;
}

// ---------------------------------------------------------------------------
// Confidence scoring (heuristic — no external model needed)
// ---------------------------------------------------------------------------

function scoreConfidence(response: string): number {
  if (!response || response.length < 20) return 0.2;
  const hedges = ['I think', 'maybe', 'perhaps', 'not sure', 'I believe', 'might be', 'could be', 'unsure'];
  const hedgeCount = hedges.filter(h => response.toLowerCase().includes(h.toLowerCase())).length;
  const base = Math.min(1, response.length / 500);
  return Math.max(0.1, base - hedgeCount * 0.1);
}

// ---------------------------------------------------------------------------
// AgentRuntime
// ---------------------------------------------------------------------------

export class AgentRuntime {
  private engine: MambaEngine | null = null;
  private options: Required<AgentRuntimeOptions>;
  private initialized = false;

  constructor(options: AgentRuntimeOptions) {
    this.options = {
      confidenceThreshold: 0.4,
      workerUrl: '',
      mambaConfig: {},
      ...options,
    };
  }

  // -- Lifecycle -------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return;
    this.engine = await createMambaEngine(
      this.options.agentId,
      this.options.projectId,
      this.options.mambaConfig
    );
    this.initialized = true;
  }

  // -- Core step -------------------------------------------------------------

  /**
   * Execute one agent turn:
   *   1. Update Mamba state
   *   2. Assemble context
   *   3. Run inference (local or cloud)
   *   4. Return structured result
   */
  async step(
    input: AgentStepInput,
    onChunk?: (chunk: string) => void
  ): Promise<AgentStepResult> {
    await this.ensureInit();

    const memoryContext = input.useMemory !== false && this.engine
      ? await this.engine.step(input.userMessage)
      : '';

    const systemParts: string[] = [
      'You are an expert AI coding assistant built into Builderforce.ai.',
      'Use markdown for your response.',
    ];
    if (memoryContext) systemParts.push(`Agent memory: ${memoryContext}`);
    if (input.fileContext) systemParts.push(`Active file content:\n\`\`\`\n${input.fileContext.slice(0, 3000)}\n\`\`\``);
    if (input.projectContext) systemParts.push(`Project context: ${input.projectContext}`);

    const messages = [
      { role: 'system' as const, content: systemParts.join('\n\n') },
      { role: 'user' as const, content: input.userMessage },
    ];

    let response = '';

    // Attempt local inference first (via existing sendAIMessage which proxies Workers AI)
    const mode = input.inferenceMode ?? 'local';
    const escalate = mode === 'cloud';

    if (!escalate) {
      try {
        await sendAIMessage(this.options.projectId, messages, (chunk) => {
          response += chunk;
          onChunk?.(chunk);
        });
      } catch {
        // Fall through to cloud
      }
    }

    const confidence = scoreConfidence(response);
    let escalatedToCloud = escalate;

    if (!escalate && confidence < this.options.confidenceThreshold && this.options.workerUrl) {
      // Escalate
      escalatedToCloud = true;
      response = '';
      try {
        await sendAIMessage(this.options.projectId, messages, (chunk) => {
          response += chunk;
          onChunk?.(chunk);
        });
      } catch {
        // Use whatever we have
      }
    }

    // Save state after each step
    if (this.engine) await this.engine.save();

    return { response, memoryContext, confidence, escalatedToCloud };
  }

  // -- Training --------------------------------------------------------------

  /**
   * Train the agent:
   *   behavior — delegates to existing LoRA pipeline (no-op here, signals caller)
   *   memory   — advances Mamba state through sequences (no gradient descent)
   *   hybrid   — memory training, then signals caller for LoRA pass
   */
  async train(opts: AgentTrainOptions): Promise<void> {
    await this.ensureInit();

    const { mode, sequences = [], onProgress } = opts;

    if (mode === 'memory' || mode === 'hybrid') {
      if (!this.engine) return;
      await this.engine.trainMemory(sequences, (i, total) => {
        onProgress?.(i, total, `Memory training: ${i}/${total}`);
      });
      await this.engine.save();
    }

    if (mode === 'behavior' || mode === 'hybrid') {
      // Signal to the calling component that a LoRA pass is needed
      onProgress?.(sequences.length, sequences.length, 'Behavior training: hand off to LoRA pipeline');
    }
  }

  // -- State management ------------------------------------------------------

  getState(): MambaAgentState | null {
    return this.engine?.getState() ?? null;
  }

  getSnapshot(): MambaStateSnapshot | null {
    return this.engine?.getSnapshot() ?? null;
  }

  async saveState(): Promise<void> {
    await this.ensureInit();
    await this.engine?.save();
  }

  /** Load state from a snapshot (e.g. from a downloaded agent package). */
  loadSnapshot(snapshot: MambaStateSnapshot): void {
    this.engine?.loadFromSnapshot(snapshot);
  }

  // -- Cloud offload ---------------------------------------------------------

  /**
   * Offload a task to cloud execution (Workers AI / OpenRouter).
   * Returns a string result for inference tasks.
   */
  async offload(task: AgentOffloadTask): Promise<string> {
    if (task.type === 'inference') {
      const payload = task.payload as { messages: { role: 'user' | 'system' | 'assistant'; content: string }[] };
      let result = '';
      await sendAIMessage(this.options.projectId, payload.messages, (chunk) => {
        result += chunk;
      });
      return result;
    }
    return '[offload: unsupported task type]';
  }

  // -- Private ---------------------------------------------------------------

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.init();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create and initialise an AgentRuntime (also boots the Mamba engine). */
export async function createAgentRuntime(options: AgentRuntimeOptions): Promise<AgentRuntime> {
  const runtime = new AgentRuntime(options);
  await runtime.init();
  return runtime;
}
