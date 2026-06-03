/**
 * Concrete implementations of the domain port interfaces (builderforce/ports.ts).
 *
 * These adapters live in the infra layer and are injected into AgentOrchestrator
 * at gateway startup. The domain layer never imports this file — the gateway
 * (server-startup.ts) wires everything together.
 */

import type {
  IAgentMemoryService,
  ILocalResultBroker,
  ITelemetryService,
} from "../builderforce/ports.js";
import { awaitLocalSubagentResult } from "./local-result-broker.js";
import { getSsmMemoryService } from "./ssm-memory-service.js";
import {
  emitTaskEnd,
  emitTaskStart,
  emitWorkflowEnd,
  emitWorkflowStart,
  initTelemetry,
} from "./workflow-telemetry.js";

// ── Telemetry adapter ─────────────────────────────────────────────────────────

export class WorkflowTelemetryAdapter implements ITelemetryService {
  init(opts: {
    projectRoot: string;
    agentNodeId?: string | null;
    linkApiUrl?: string | null;
    linkApiKey?: string | null;
  }): void {
    initTelemetry(opts);
  }

  emitWorkflowStart(workflowId: string, description?: string): void {
    emitWorkflowStart(workflowId, description);
  }

  emitWorkflowEnd(workflowId: string, failed: boolean): void {
    emitWorkflowEnd(workflowId, failed);
  }

  emitTaskStart(workflowId: string, taskId: string, agentRole: string, description: string): void {
    emitTaskStart(workflowId, taskId, agentRole, description);
  }

  emitTaskEnd(
    workflowId: string,
    taskId: string,
    agentRole: string,
    startedAt: Date,
    error?: string,
    metrics?: {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      estimatedCostUsd?: number;
    },
  ): void {
    emitTaskEnd(workflowId, taskId, agentRole, startedAt, error, metrics);
  }
}

// ── Memory adapter ────────────────────────────────────────────────────────────

export class SsmMemoryAdapter implements IAgentMemoryService {
  async buildTeamMemoryContext(): Promise<string> {
    return getSsmMemoryService()?.buildTeamMemoryContext() ?? Promise.resolve("");
  }

  async recallSimilar(
    query: string,
    limit: number,
  ): Promise<Array<{ key: string; content: string }>> {
    return getSsmMemoryService()?.recallSimilar(query, limit) ?? Promise.resolve([]);
  }

  /** Persist a memory entry — backs builder `memory:write` nodes. */
  async store(key: string, content: string): Promise<void> {
    await getSsmMemoryService()?.remember(key, content);
  }

  /**
   * Ingest source text into the knowledge base — backs builder
   * `knowledge:ingest` nodes. Splits on blank lines so each chunk is a
   * separately-recallable entry, persists each via `remember`, and feeds the
   * whole source to the adaptation loop via `learn`. Returns the chunk count.
   */
  async ingest(source: string, namespace?: string): Promise<number> {
    const svc = getSsmMemoryService();
    if (!svc) return 0;
    const ns = namespace?.trim() || "kb";
    const chunks = source
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const effective = chunks.length > 0 ? chunks : [source.trim()].filter(Boolean);
    let i = 0;
    for (const chunk of effective) {
      await svc.remember(`${ns}:${i}`, chunk, { tags: [ns, "knowledge"] });
      i += 1;
    }
    // Best-effort adaptation on the full source; no-ops when GPU is unavailable.
    await svc.learn(source);
    return effective.length;
  }

  /**
   * Fine-tune/distil the hippocampus on `dataset` for `epochs` passes and persist
   * the adapted weights — backs builder `train` nodes. Delegates to the SSM
   * service's distillation loop (which saves a checkpoint). No-op without a GPU.
   */
  async train(opts: { model: string; dataset: string; epochs: number }): Promise<string> {
    const svc = getSsmMemoryService();
    if (!svc) return `[train] SSM memory service unavailable — "${opts.model}" not trained`;
    const epochs = Number.isFinite(opts.epochs) && opts.epochs > 0 ? Math.floor(opts.epochs) : 1;
    const batch = Array.from({ length: epochs }, () => opts.dataset);
    await svc.distillAndSave(batch);
    return `[train] adapted "${opts.model}" over ${epochs} epoch(s) on the supplied dataset and saved a checkpoint`;
  }
}

// ── Local result broker adapter ───────────────────────────────────────────────

export class LocalResultBrokerAdapter implements ILocalResultBroker {
  async awaitResult(runId: string, childSessionKey: string, timeoutMs: number): Promise<string> {
    return awaitLocalSubagentResult(runId, childSessionKey, timeoutMs);
  }
}
