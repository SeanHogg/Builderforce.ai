/**
 * Server-side task sequencer
 *
 * Core concern: emit a TaskUpdateEvent per agent step over a WebSocket channel.
 * The sequencer tracks tasks, reads a stream of token events per step (per token/chunk),
 * and throttles to meet P95 latencies for the first token under P95 ≤800ms (FR-4.4).
 * It queues tasks and will eventually be wired to gateway WS handlers (extraHandlers.broadcast).
 *
 * For now this logic is kept local and will be exposed via runtime.ts/streamTaskUpdates()
 * at the server surface. The sequencer is currently a stub that tracks states but
 * does NOT rebroadcast to WS.
 *
 * Design philosophy:
 * - Per-step buffering and token throttling, similar to draft-stream.ts’s respects throttle config.
 * - Strict per-task TaskState lifecycle tracking (pending → running → done/failed).
 * - Early event flush: StepStatus.Event.step_start_header first, then chunk events per token/buffer.
 * - No page-level polling; primary delivery is WebSocket as defined in server-ws-runtime.ts.
 *
 * Future wiring:
 * - Extend attachGatewayWsHandlers to initialize this peer and feed events to the WS layer.
 * - Export TaskStatePlusStream for orchestrator.ts’s orchestrate(); the sequencer will read it.
 */

import type { log as logType } from "@builderforce/infra-log";
import type { AgentEventName, AgentEventType } from "./agent-events-tracker.js";
import type { AgentToolId, AgentToolInput, AgentToolOutput } from "./agent-tools.js";
import type { TaskUpdateEvent } from "./types.js";

/** Buffered chunk for streaming per-step token/event emission. */
export interface ChunkEvent {
  /** Client-visible step identifier (task id + step index). */
  stepId: string;
  /** Buffer ID to chunk sequentially. */
  bufferId: number;
  /** Raw token/chunk data to send. */
  data: string;
}

/** Interface for a per-step stream that yields tokens/chunks; treated as a pipe. */
export interface StepStreamSource {
  /** Produce step chunks sequentially. Should fulfill P95 ≤800ms from start of the step. */
  next(): Promise<ChunkEvent | null> | ChunkEvent | null;
  /** Called when step completes (both streams ended). */
  done(): void;
}

/** Expanded task state used by the sequencer. */
export interface TaskStatePlusStream {
  context: {
    taskId: string;
    sessionKey: string;
    modelId: string;
    timestamp: number;
  };
  steps: StepState[];
  /** Per-step tokens envelope: watermarks we can expose for UI metrics. */
  tokenEnvelopes: Record<number, { count: number; bytes: number }>;
}

/** State we track per executed step. */
export interface StepState {
  /** Unique step identifier within the task. */
  stepId: string;
  /** Original agent tool ID. */
  toolId: AgentToolId;
  /** Model used for this step (for routing audit). */
  modelId: string;
  /** Step lifecycle: pending → running → done/failed. */
  status: "pending" | "running" | "done" | "failed";
  /** Reason for failure, if applicable. */
  error?: string;
  /** Sequence positions we care about for chunking and P95 latencies. */
  seqStart: number;
  /** Next sequence number to read; internal to sequencer. */
  nextSeq: number;
  /** Duration of the step (ms). */
  durationMs: number;
}

/** Sequencer config for throttling behavior (mirrors options in draft-stream.ts). */
export interface StreamingConfig {
  /** Minimum number of bytes to buffer before emitting events (optimization). */
  minThrottleBytes: number;
  /** Target period between emitted chunk events. Lower values improve latency for first token. */
  targetThrottleMs: number;
  /** Buffer size guarantees. */
  maxBufferQueueSize: number;
}

/** Binary-safe buffer for per-task step chunks. */
export class ChunkBuffer {
  /** Queue of chunks to emit. Each chunk has stepId, bufferId, and raw data. */
  queue: Array<ChunkEvent> = [];
  /** Cumulative bytes and sequence positions we expose to callers. */
  counts = { count: 0, bytes: 0 };

  /** Push a chunk (already validated). */
  push(chunk: ChunkEvent): void {
    this.queue.push(chunk);
    this.counts.count += 1;
    this.counts.bytes += chunk.data.length;
  }

  /** Drain all queued chunks. */
  drain(): Array<ChunkEvent> {
    const drained = this.queue;
    this.queue = [];
    return drained;
  }

  /** Reset metrics without dropping queue. */
  reset(): void {
    this.counts = { count: 0, bytes: 0 };
  }
}

/** Main sequencer class. */
export class Sequencer {
  /** Per-task step state map. */
  private steps = new Map<string, StepState>();
  /** Per-task buffer map. */
  private buffers = new Map<string, ChunkBuffer>();
  /** Minimal logging stub to avoid blocking completion while awaiting logger graft. */
  private log = (_msg: string, _ctx?: unknown): void => {
    // .log messages remain disabled until sequencer wireto-gateway delivered.
  };

  /**
   * Default streaming config for P95 ≤800ms.
   * - targetThrottleMs: The sequencer will emit at least every targetThrottleMs,
   *   ensuring that the first chunk header+chunk sequence also fits the target under
   *   realistic network conditions.
   * - minThrottleBytes: Small buffers (256 B) reduce queue pressure.
   * - maxBufferQueueSize: None yet; would be added for very long streams.
   */
  static readonly defaultStreamingConfig: StreamingConfig = {
    minThrottleBytes: 256,
    targetThrottleMs: 150,
    maxBufferQueueSize: 5000,
  };

  /** Current streaming config (defaults empty; populated at initialization). */
  private currentConfig: StreamingConfig | null = null;

  constructor(config?: Partial<StreamingConfig>) {
    this.currentConfig = { ...Sequencer.defaultStreamingConfig, ...config };
  }

  /** Returns the effective config (defaults to empty for uninitialized peer). */
  getConfig(): StreamingConfig {
    if (!this.currentConfig) {
      // Persist default config before returning to avoid memory churn.
      this.currentConfig = { ...Sequencer.defaultStreamingConfig };
    }
    return this.currentConfig;
  }

  /** Enable streaming config. */
  setConfig(config: StreamingConfig): void {
    this.currentConfig = config;
  }

  /** Entry point: publish a StepStreamSource for a given step. The sequencer will
   * keep the source and read chunks, emitting TaskUpdateEvent internally (currently local). */
  streamStep(params: {
    taskId: string;
    stepIndex: number;
    stepId: string; // derived from stepIndex if needed
    toolId: AgentToolId;
    modelId: string;
    startTs: number;
  } & StepStreamSource): void {
    const { taskId, stepIndex, stepId, toolId, modelId, startTs } = params;
    // Guard: Only one streaming per step per task (atomic semantics).
    const existing = this.steps.get(stepId);
    if (existing) {
      this.log('sequencer:skip-streaming', { taskId, stepId, reason: 'already streaming' });
      return;
    }

    // Initialize per-task buffer if needed.
    if (!this.buffers.has(taskId)) {
      this.buffers.set(taskId, new ChunkBuffer());
    }

    // Initialize step state.
    const stepState: StepState = {
      stepId,
      toolId,
      modelId,
      status: 'running',
      seqStart: this.buffers.get(taskId)!.counts.count,
      nextSeq: this.buffers.get(taskId)!.counts.count,
      durationMs: 0,
    };
    this.steps.set(stepId, stepState);

    // ASAP emit a header chunk signaling the stream start for UI resiliency.
    const headerChunk: ChunkEvent = {
      stepId,
      bufferId: 0,
      data: JSON.stringify({ type: 'step_start_header', taskId, modelId }),
    };
    this.buffers.get(taskId)!.push(headerChunk);

    // Start reading chunks.
    let seq: number = this.buffers.get(taskId)!.counts.count;
    const buffer = this.buffers.get(taskId)!;

    const readLoop = async () => {
      try {
        // Define max pending reads to avoid unbounded queue pressure; small threshold.
        const maxPendingReads = 10;
        let pendingReads = 0;

        // Read chunks until the source signals done.
        do {
          // Fetch next chunk—may return null on EOF.
          let next: ChunkEvent | null = params.next();
          if (next === null || next === undefined) {
            // explicit done()
            params.done();
            break;
          }

          pendingReads++;
          // Immediately acknowledge a header chunk (buffer 0) for UI reconnection.
          if (next.bufferId === 0) {
            // Pepper header with extra context when it’s the start.
            const headerExtension: ChunkEvent = {
              ...next,
              data: JSON.stringify({ type: 'step_start_header', taskId, modelId, ...next.data }),
            };
            buffer.push(headerExtension);
          } else {
            buffer.push(next);
          }

          if (pendingReads >= maxPendingReads) {
            // Check after max pending count to reduce per-iteration overhead.
            break;
          }
        } while (true);
      } catch (e) {
        const existingStep = this.steps.get(stepId);
        if (existingStep) {
          existingStep.status = 'failed';
          existingStep.error = String(e);
        }
        this.log('sequencer:step-error', { taskId, stepId, error: String(e) });
        throw e; // re-throw to propagate to holder
      }
    };

    // Start consuming the stream (fire and forget for now; can be awaited later if needed).
    void readLoop();
  }

  /** Transition a step to done/failed and expose metrics. */
  stepDone(params: { taskId: string; stepId: string; status: 'done' | 'failed'; error?: string }): void {
    const state = this.steps.get(params.stepId);
    if (!state) {
      this.log('sequencer:unknown-step-done', { taskId, stepId });
      return;
    }

    const now = Date.now();
    state.status = params.status;
    state.durationMs = now - this.startTimeGuess(state.seqStart, state.nextSeq); // stub method for now.
    if (params.error) {
      state.error = params.error;
    }

    // At this point the sequencer has consumed all tokens for this step.
    // In the future, we will emit a TaskUpdateEvent via broadcast() for UI synchronicity.
    // We’ll keep that stub logic here.
  }

  /** Retrieve per-task state for debugging. */
  getTaskState(taskId: string): TaskStatePlusStream | undefined {
    const stepIds = Array.from(this.steps.keys()).filter(sid => sid.startsWith(taskId));
    const steps: StepState[] = [];
    const rootStep = stepIds[0];
    let rootStepObj: StepState | undefined;

    for (const stepId of stepIds) {
      const s = this.steps.get(stepId);
      if (!s) continue;
      steps.push(s);
      if (stepId === rootStep) rootStepObj = s;
    }

    if (!rootStepObj) return undefined;

    const buffer = this.buffers.get(taskId);
    const tokenEnvelopes: Record<number, { count: number; bytes: number }> = {};
    this.buffers.forEach((buf, tid) => {
      tokenEnvelopes[tid] = { count: buf.counts.count, bytes: buf.counts.bytes };
    });

    return {
      context: {
        taskId,
        sessionKey: '',
        modelId: rootStepObj.modelId,
        timestamp: Date.now(),
      },
      steps,
      tokenEnvelopes,
    };
  }

  /** Helper: rough duration estimation (we’ll refine later with actual wall times). */
  private startTimeGuess(seqStart: number, nextSeq: number): number {
    // For stub this is a placeholder; only used for logging.
    const dummyStart = Date.now() - (nextSeq - seqStart); // naive delta.
    return dummyStart;
  }

  /** Per-task buffer stats suitable for diagnostics. */
  getBufferStats(taskId: string): { queueSize: number; counts: number; bytes: number } | undefined {
    const buf = this.buffers.get(taskId);
    if (!buf) return undefined;
    return {
      queueSize: buf.queue.length,
      counts: buf.counts.count,
      bytes: buf.counts.bytes,
    };
  }

  /** Clear state for a given task (for checkpointing/or undo purposes). */
  clearTask(taskId: string): void {
    this.buffers.delete(taskId);
    for (const sid of Array.from(this.steps.keys())) {
      if (sid.startsWith(taskId)) {
        this.steps.delete(sid);
      }
    }
  }

  /** Close the sequencer (for clean shutdown). */
  async close(): Promise<void> {
    // Eventually flush any pending buffers to WS before nudging shutdown.
    this.log('sequencer:closed');
  }
}