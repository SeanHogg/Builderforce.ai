/**
 * Multi-agent orchestration engine for builderForceAgents
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SpawnSubagentContext } from "../agents/subagent-spawn.js";
import { logDebug } from "../logger.js";
import { findAgentRole } from "./agent-roles.js";
import { PRD_FILE } from "./project-dir.js";
import { isPrdTask, readPrdWip, writePrdWip } from "./prd-wip.js";
import { applyTransform, etlContext, evalPredicate } from "./node-eval.js";
import type {
  AgentTransportDispatchResult,
  IAgentTransport,
  IAgentMemoryService,
  ILimbicSystem,
  ILlmService,
  IMcpService,
  ITelemetryService,
} from "./ports.js";
import {
  saveWorkflowState,
  loadWorkflowState,
  listIncompleteWorkflowIds,
  type PersistedWorkflow,
  type PersistedTask,
} from "./project-context.js";
import type { IRelayService } from "./relay-service.js";
import {
  DEFAULT_ROUTING_RULES,
  parseRoutingRules,
  resolveRouting,
  type RoutingRule,
} from "./routing-rules.js";

export type { SpawnSubagentContext } from "../agents/subagent-spawn.js";

/**
 * Self-healing retry policy for failed tasks. A task is re-dispatched up to
 * `MAX_TASK_RETRIES` additional times (so `1 + MAX_TASK_RETRIES` total attempts)
 * with a small linear backoff between attempts before it — and the workflow —
 * is marked permanently `failed`.
 *
 * Overridable via env so operators can tune recovery aggressiveness without a
 * rebuild; malformed values fall back to the defaults.
 */
const DEFAULT_MAX_TASK_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 1_500;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const MAX_TASK_RETRIES = envInt("BUILDERFORCE_WORKFLOW_MAX_RETRIES", DEFAULT_MAX_TASK_RETRIES);
const RETRY_BACKOFF_MS = envInt("BUILDERFORCE_WORKFLOW_RETRY_BACKOFF_MS", DEFAULT_RETRY_BACKOFF_MS);

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** Valid status transitions for a Task. Encodes the domain invariant in one place. */
const VALID_TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["pending"], // allow retry
  cancelled: [],
};

/** Returns true when transitioning `current → next` is a valid domain state change. */
export function canTransitionTaskTo(current: TaskStatus, next: TaskStatus): boolean {
  return (VALID_TASK_TRANSITIONS[current] as readonly string[]).includes(next);
}

export type Task = {
  id: string;
  description: string;
  agentRole: string;
  status: TaskStatus;
  input: string;
  output?: string;
  error?: string;
  childSessionKey?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  dependencies: string[];
  dependents: string[];
  /** Number of dispatch attempts so far (1 = first try; incremented on each retry). */
  attempts?: number;
  /** Last error message observed across attempts. Kept on the task for diagnostics. */
  lastError?: string;
  /** Builder node kind (memory/knowledge/train/transform/…) when this task was
   *  compiled from a visual workflow definition. Drives the in-process node
   *  handler instead of agent dispatch. Undefined for plain agent tasks. */
  nodeType?: string;
  /** Per-node parameters carried from the builder definition. */
  config?: Record<string, unknown>;
};

export type WorkflowStep = {
  role: string;
  task: string;
  dependsOn?: string[];
  /** Builder node kind, when this step came from a visual workflow definition. */
  nodeType?: string;
  /** Per-node parameters (memory op, KB namespace, train dataset, …). */
  config?: Record<string, unknown>;
};

export type Workflow = {
  id: string;
  steps: WorkflowStep[];
  tasks: Map<string, Task>;
  status: TaskStatus;
  createdAt: Date;
};

/** Partial port injection bag — pass to `globalOrchestrator.configure()` at startup. */
export type OrchestratorConfig = {
  telemetry?: ITelemetryService;
  memoryService?: IAgentMemoryService | null;
  agentTransport?: IAgentTransport | null;
  relayService?: IRelayService;
  llmService?: ILlmService | null;
  mcpService?: IMcpService | null;
  limbicSystem?: ILimbicSystem | null;
};

/**
 * Orchestrator manages multi-agent workflows
 */
export class AgentOrchestrator {
  private workflows = new Map<string, Workflow>();
  private taskResults = new Map<string, string>();
  private projectRoot: string | null = null;
  /** Merged routing rules (defaults + user-defined from .builderforce/routing-rules.json). */
  private routingRules: RoutingRule[] = DEFAULT_ROUTING_RULES;
  /** Relay service reference for cross-agentNode context fetching (P4-2). */
  private relayService: IRelayService | null = null;
  /** Domain port: telemetry — injected by server-startup after credentials are known. */
  private telemetry: ITelemetryService | null = null;
  /** Domain port: memory recall — injected after SSM initialisation. */
  private memoryService: IAgentMemoryService | null = null;
  /** Domain port: LLM platform calls (builder `llm` nodes) via the gateway. */
  private llmService: ILlmService | null = null;
  /** Domain port: MCP / SaaS integration invocation (builder `mcp` nodes). */
  private mcpService: IMcpService | null = null;
  /** Domain port: the agent's limbic system (dynamic affective layer). */
  private limbicSystem: ILimbicSystem | null = null;
  /** Unified local/remote transport for task dispatch and agentNode discovery.
   *  Always wired by the gateway (local-only when no API key, composite when
   *  BUILDERFORCE_API_KEY is present). */
  private agentTransport: IAgentTransport | null = null;
  /** Per-task spawn context, exposed to local transports via `currentSpawnContext()`.
   *  Single-threaded by virtue of the orchestrator's serial executeTask loop. */
  private activeSpawnContext: SpawnSubagentContext | null = null;
  /** Guard so {@link resumeAllIncomplete} is idempotent (no double auto-resume). */
  private resumingInFlight = false;

  /** Enable disk persistence for workflows and workflow telemetry. Call at gateway startup. */
  setProjectRoot(
    root: string,
    agentNodeId?: string | null,
    linkApiUrl?: string | null,
    linkApiKey?: string | null,
  ): void {
    this.projectRoot = root;
    this.telemetry?.init({ projectRoot: root, agentNodeId, linkApiUrl, linkApiKey });
    // Load user-defined routing rules asynchronously — non-fatal if absent
    void this.loadRoutingRules(root);
  }

  /**
   * Load routing rules from `.builderforce/routing-rules.json` and merge with defaults.
   * User-defined rules are prepended (higher effective priority) over the built-in defaults.
   */
  private async loadRoutingRules(projectRoot: string): Promise<void> {
    const filePath = path.join(projectRoot, ".builderForceAgents", "routing-rules.json");
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = parseRoutingRules(JSON.parse(raw));
      if (parsed.length > 0) {
        // User rules come first (higher priority); then defaults as fallback
        this.routingRules = [...parsed, ...DEFAULT_ROUTING_RULES];
        logDebug(`[orchestrator] loaded ${parsed.length} routing rule(s) from ${filePath}`);
      }
    } catch {
      // File absent or invalid JSON — use defaults silently
    }
  }

  /**
   * Inject one or more domain ports in a single call.
   * Preferred over the individual setter shims below.
   * Any field left undefined is left unchanged.
   */
  configure(config: OrchestratorConfig): void {
    if (config.telemetry !== undefined) {
      this.telemetry = config.telemetry;
    }
    if (config.memoryService !== undefined) {
      this.memoryService = config.memoryService;
    }
    if (config.agentTransport !== undefined) {
      this.agentTransport = config.agentTransport;
    }
    if (config.relayService !== undefined) {
      this.relayService = config.relayService;
    }
    if (config.llmService !== undefined) {
      this.llmService = config.llmService;
    }
    if (config.mcpService !== undefined) {
      this.mcpService = config.mcpService;
    }
    if (config.limbicSystem !== undefined) {
      this.limbicSystem = config.limbicSystem;
    }
  }

  /** The configured limbic system, if any. Null when no affective layer is wired. */
  getLimbicSystem(): ILimbicSystem | null {
    return this.limbicSystem;
  }

  // ── Single-port shims (kept for backward compatibility) ──────────────────────

  /** @deprecated Use configure({ telemetry }) instead. */
  setTelemetryService(svc: ITelemetryService): void {
    this.telemetry = svc;
  }

  /** @deprecated Use configure({ memoryService }) instead. */
  setMemoryService(svc: IAgentMemoryService | null): void {
    this.memoryService = svc;
  }

  /** @deprecated Use configure({ agentTransport }) instead. */
  setAgentTransport(transport: IAgentTransport): void {
    this.agentTransport = transport;
  }

  /** Returns the currently-executing task's spawn context. Used by local
   *  transports (via a closure passed at construction time) so they can
   *  forward channel/session identifiers into spawned subagents. Returns
   *  an empty context when no task is in flight. */
  currentSpawnContext(): SpawnSubagentContext {
    return this.activeSpawnContext ?? {};
  }

  /** @deprecated Use configure({ relayService }) instead. */
  setRelayService(relay: IRelayService): void {
    this.relayService = relay;
  }

  /**
   * Create a new workflow
   */
  createWorkflow(steps: WorkflowStep[]): Workflow {
    const id = crypto.randomUUID();
    const workflow: Workflow = {
      id,
      steps,
      tasks: new Map(),
      status: "pending",
      createdAt: new Date(),
    };

    // Create tasks from steps
    for (const step of steps) {
      const taskId = crypto.randomUUID();
      const task: Task = {
        id: taskId,
        description: step.task,
        agentRole: step.role,
        status: "pending",
        input: step.task,
        dependencies: step.dependsOn || [],
        dependents: [],
        createdAt: new Date(),
        nodeType: step.nodeType,
        config: step.config,
      };
      workflow.tasks.set(taskId, task);
    }

    // Build dependent relationships
    const stepToTaskId = new Map<number, string>();
    let index = 0;
    for (const [taskId] of workflow.tasks) {
      stepToTaskId.set(index++, taskId);
    }

    index = 0;
    for (const step of steps) {
      const taskId = stepToTaskId.get(index++)!;
      const task = workflow.tasks.get(taskId);
      if (!task) {
        continue;
      }
      const resolvedDependencies: string[] = [];

      if (step.dependsOn) {
        for (const depStepId of step.dependsOn) {
          const depIndex = steps.findIndex((s) => s.task === depStepId);
          if (depIndex !== -1) {
            const depTaskId = stepToTaskId.get(depIndex);
            if (depTaskId) {
              resolvedDependencies.push(depTaskId);
              const depTask = workflow.tasks.get(depTaskId);
              if (depTask && !depTask.dependents.includes(taskId)) {
                depTask.dependents.push(taskId);
              }
            }
          }
        }
      }

      task.dependencies = resolvedDependencies;
    }

    this.workflows.set(id, workflow);
    this.persistWorkflow(workflow);
    return workflow;
  }

  /**
   * Build a workflow directly from already-instantiated tasks — used when a
   * agentHost claims a portal-authored workflow definition. Unlike
   * `createWorkflow`, dependencies are real task UUIDs (not task-text matches),
   * and each task carries its builder `nodeType`/`config` so the in-process node
   * handlers run. Agent tasks keep their human task text as `input`.
   */
  createWorkflowFromTasks(
    workflowId: string,
    specs: Array<{
      id: string;
      agentRole: string;
      description: string;
      input?: string | null;
      dependsOn: string[];
      nodeType?: string;
      config?: Record<string, unknown>;
    }>,
  ): Workflow {
    const tasks = new Map<string, Task>();
    for (const s of specs) {
      tasks.set(s.id, {
        id: s.id,
        description: s.description,
        agentRole: s.agentRole,
        status: "pending",
        input: s.input ?? s.description,
        dependencies: s.dependsOn,
        dependents: [],
        createdAt: new Date(),
        nodeType: s.nodeType,
        config: s.config,
      });
    }
    // Wire dependents from the declared dependencies.
    for (const task of tasks.values()) {
      for (const depId of task.dependencies) {
        const dep = tasks.get(depId);
        if (dep && !dep.dependents.includes(task.id)) dep.dependents.push(task.id);
      }
    }

    const workflow: Workflow = {
      id: workflowId,
      steps: specs.map((s) => ({ role: s.agentRole, task: s.description, dependsOn: s.dependsOn })),
      tasks,
      status: "pending",
      createdAt: new Date(),
    };
    this.workflows.set(workflowId, workflow);
    this.persistWorkflow(workflow);
    return workflow;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    context: SpawnSubagentContext,
  ): Promise<Map<string, string>> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.status = "running";
    this.telemetry?.emitWorkflowStart(workflowId);
    const results = new Map<string, string>();

    // Execute tasks in dependency order
    const executedTasks = new Set<string>();

    while (executedTasks.size < workflow.tasks.size) {
      const nextTasks = Array.from(workflow.tasks.values()).filter(
        (task) =>
          task.status === "pending" && task.dependencies.every((depId) => executedTasks.has(depId)),
      );

      if (nextTasks.length === 0) {
        // No more tasks can run - check if we're done or stuck
        const remainingTasks = Array.from(workflow.tasks.values()).filter(
          (task) => task.status !== "completed" && task.status !== "failed",
        );

        if (remainingTasks.length > 0) {
          workflow.status = "failed";
          throw new Error(`Workflow stuck - cannot execute remaining tasks`);
        }
        break;
      }

      // Execute tasks in parallel when possible. Each task is retried with a
      // bounded attempt budget + backoff before it is allowed to fail the run
      // (self-healing). `executedTasks` is only marked once a task reaches a
      // terminal state (completed or exhausted-failed) so the dependency-order
      // loop never spins on an in-flight retry.
      await Promise.all(
        nextTasks.map(async (task) => {
          const result = await this.executeTaskWithRetry(task, workflow, context);
          if (result !== null) {
            results.set(task.id, result);
          }
          executedTasks.add(task.id);
        }),
      );
    }

    // Check if all tasks completed successfully
    const failedTasks = Array.from(workflow.tasks.values()).filter(
      (task) => task.status === "failed",
    );

    if (failedTasks.length > 0) {
      workflow.status = "failed";
    } else {
      workflow.status = "completed";
    }
    this.telemetry?.emitWorkflowEnd(workflowId, workflow.status === "failed");
    this.persistWorkflow(workflow);

    return results;
  }

  /**
   * Execute a single task with a bounded, backed-off retry budget (self-healing).
   *
   * On success returns the task output. On exhausted failure leaves the task in
   * the `failed` state (with `attempts`/`lastError` recorded) and returns null —
   * the caller marks the workflow `failed` in its post-loop check. Already-failed
   * tasks restored from disk are honoured: a fresh attempt budget is applied so a
   * resumed workflow re-tries a previously-failed step rather than giving up.
   */
  private async executeTaskWithRetry(
    task: Task,
    workflow: Workflow,
    context: SpawnSubagentContext,
  ): Promise<string | null> {
    const maxAttempts = MAX_TASK_RETRIES + 1;
    for (let attempt = (task.attempts ?? 0) + 1; attempt <= maxAttempts; attempt++) {
      task.attempts = attempt;
      // executeTask() flips a failing task to "failed"; reset to "pending" so the
      // VALID_TASK_TRANSITIONS guard (failed → pending) is honoured before retry.
      if (task.status === "failed") {
        task.status = "pending";
      }
      try {
        return await this.executeTask(task, workflow, context);
      } catch (error) {
        task.lastError = error instanceof Error ? error.message : String(error);
        const isLastAttempt = attempt >= maxAttempts;
        logDebug(
          `[orchestrator] task ${task.id} (role=${task.agentRole}) failed on attempt ` +
            `${attempt}/${maxAttempts}: ${task.lastError}` +
            (isLastAttempt ? " — giving up" : " — retrying"),
        );
        if (isLastAttempt) {
          // executeTask already set status=failed + persisted; record the final
          // attempt bookkeeping and surface the accumulated error.
          task.status = "failed";
          task.error = task.lastError;
          this.persistWorkflow(workflow);
          return null;
        }
        // Linear backoff before the next attempt. Persist so the attempt count
        // survives a crash mid-retry (resume picks up where we left off).
        this.persistWorkflow(workflow);
        if (RETRY_BACKOFF_MS > 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * attempt));
        }
      }
    }
    return null;
  }

  /**
   * Build a structured context block for a task, replacing naive text concatenation.
   *
   * Each prior agent's output is labelled with its role and prefixed so the
   * receiving agent knows exactly who produced what.  The role's `outputFormat`
   * prefix (e.g. "REVIEW:" / "ARCH:") is used when available so downstream
   * agents can quickly scan for the section they care about.
   */
  private buildStructuredContext(task: Task, workflow: Workflow): string {
    // Per-dependency result truncation: prevents runaway context when a prior agent
    // produces an unexpectedly large output (e.g. a full codebase dump).
    const MAX_RESULT_CHARS = 8_000;

    const lines: string[] = [];

    lines.push(`## Your Task\n\n${task.input}`);

    if (task.dependencies.length > 0) {
      lines.push(`\n## Context from Prior Agents\n`);
      for (const depId of task.dependencies) {
        const depTask = workflow.tasks.get(depId);
        const result = this.taskResults.get(depId);
        if (depTask && result) {
          const roleConfig = findAgentRole(depTask.agentRole);
          const prefix = roleConfig?.outputFormat?.outputPrefix ?? depTask.agentRole.toUpperCase();
          const body =
            result.length > MAX_RESULT_CHARS
              ? `${result.slice(0, MAX_RESULT_CHARS)}\n…(truncated — ${result.length - MAX_RESULT_CHARS} chars omitted)`
              : result;
          lines.push(`### ${prefix} (${depTask.agentRole})\n\n${body}\n`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Prepends a [Memory Context] block to `prompt` using the SSM semantic memory
   * layer.  Also injects top-5 team memory entries if available (P4-5).
   * Silently returns the original prompt if the service is unavailable or if
   * recall fails.
   */
  private async injectMemoryContext(taskDescription: string, prompt: string): Promise<string> {
    let prefix = "";

    if (this.memoryService) {
      try {
        // Team memory context (P4-5)
        const teamMemCtx = await this.memoryService.buildTeamMemoryContext();
        if (teamMemCtx) {
          prefix += teamMemCtx;
        }
      } catch (err) {
        logDebug(`[orchestrator] team memory injection failed: ${String(err)}`);
      }

      try {
        const entries = await this.memoryService.recallSimilar(taskDescription, 5);
        if (entries.length > 0) {
          const lines = ["[Memory Context]"];
          for (const entry of entries) {
            lines.push(`- ${entry.key}: ${entry.content}`);
          }
          lines.push("[End Memory Context]", "");
          prefix += lines.join("\n");
        }
      } catch (err) {
        logDebug(`[orchestrator] memory injection failed: ${String(err)}`);
      }
    }

    return prefix ? prefix + prompt : prompt;
  }

  /**
   * Execute a single task
   */
  private async executeTask(
    task: Task,
    workflow: Workflow,
    context: SpawnSubagentContext,
  ): Promise<string> {
    task.status = "running";
    task.startedAt = new Date();
    this.persistWorkflow(workflow);
    this.telemetry?.emitTaskStart(workflow.id, task.id, task.agentRole, task.description);

    // LLM-logic & ETL nodes (memory / knowledge / train / transform / …) compiled
    // from a visual workflow definition run in-process via dedicated handlers
    // rather than being dispatched to an agent runtime. Reserved roles carry the
    // `node:` prefix; nodeType (when present) names the kind precisely.
    if (task.agentRole.startsWith("node:") || (task.nodeType && task.nodeType !== "agent")) {
      return await this.runNodeHandler(task, workflow);
    }

    // Build structured context block for this task
    let taskInput = this.buildStructuredContext(task, workflow);

    // Prepend the shared PRD working document so every downstream agent operates
    // off the same WIP file rather than a re-derived context blob. PRD-owning
    // tasks are skipped — they author the file, they don't read it back.
    if (this.projectRoot && !isPrdTask(task.agentRole, task.description)) {
      const prd = await readPrdWip(this.projectRoot);
      if (prd?.trim()) {
        taskInput =
          `## Shared PRD (working document — ${PRD_FILE})\n\n${prd}\n\n---\n\n${taskInput}`;
      }
    }

    // Prepend semantic memory context if the SSM memory layer is available
    taskInput = await this.injectMemoryContext(task.description, taskInput);

    // Resolve routing target for this task based on configured rules.
    // Routing only applies to local dispatch — remote roles bypass this.
    if (!task.agentRole.startsWith("remote:")) {
      const routingTarget = resolveRouting(task, this.routingRules);
      logDebug(
        `[orchestrator] routing task ${task.id} (role=${task.agentRole}) → ${JSON.stringify(routingTarget)}`,
      );
      // When routing points to a remote target, rewrite the agentRole so the
      // existing remote dispatch path below handles it.
      if (routingTarget.type === "remote") {
        const remoteId = routingTarget.agentNodeId ?? "auto";
        const caps = routingTarget.capabilities?.length
          ? `[${routingTarget.capabilities.join(",")}]`
          : "";
        task.agentRole = `remote:${remoteId}${caps}`;
      }
      // local/cloud routing is informational at this layer — the embedded runner
      // respects the model configured per-agent; a future enhancement can pass
      // the resolved provider directly to spawnSubagentDirect.
    }

    // Pre-dispatch: fetch remote-context bundle so the target agentNode sees this
    // agentNode's `.builderforce/` directory. Remote-only; skipped for auto-targets
    // (agentNode isn't selected yet) and for local dispatch.
    if (task.agentRole.startsWith("remote:")) {
      const targetAgentNodeId = task.agentRole.slice("remote:".length);
      const isAutoTarget = targetAgentNodeId === "auto" || targetAgentNodeId.startsWith("auto[");
      if (this.relayService && !isAutoTarget) {
        try {
          await this.relayService.fetchRemoteContext(targetAgentNodeId);
          const remoteCtxDir = this.projectRoot
            ? path.join(this.projectRoot, ".builderForceAgents", "remote-context", targetAgentNodeId)
            : null;
          if (remoteCtxDir) {
            const ctxFiles = await fs.readdir(remoteCtxDir, { recursive: true }).catch(() => []);
            if (ctxFiles.length > 0) {
              taskInput =
                `[Remote Context for agentNode ${targetAgentNodeId}]\n` +
                `Available context files: ${ctxFiles.slice(0, 20).join(", ")}\n` +
                `[End Remote Context]\n\n` +
                taskInput;
            }
          }
        } catch (err) {
          logDebug(`[orchestrator] fetchRemoteContext failed: ${String(err)}`);
        }
      }
    }

    // Unified dispatch: local + remote both flow through the configured
    // `agentTransport` (CompositeAgentTransport) which routes by prefix.
    if (!this.agentTransport) {
      task.status = "failed";
      task.error =
        "Agent transport not configured — orchestrator must be wired with at least a LocalAgentTransport.";
      task.completedAt = new Date();
      this.telemetry?.emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt, task.error);
      this.persistWorkflow(workflow);
      throw new Error(task.error);
    }

    const correlationId = crypto.randomUUID();
    this.activeSpawnContext = context;
    let result: AgentTransportDispatchResult;
    try {
      result = await this.agentTransport.dispatch({
        target: task.agentRole,
        input: taskInput,
        correlationId,
        timeoutMs: 600_000,
      });
    } finally {
      this.activeSpawnContext = null;
    }

    if (result.status !== "accepted") {
      task.status = "failed";
      task.error = result.error;
      task.completedAt = new Date();
      this.telemetry?.emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt, task.error);
      this.persistWorkflow(workflow);
      throw new Error(task.error);
    }

    if (result.childSessionKey) {
      task.childSessionKey = result.childSessionKey;
    }
    // `accepted` now guarantees the dispatch resolved a real result: the local
    // and remote transports return `failed` (handled above) when the result
    // await times out, so we never fabricate a "result pending" placeholder and
    // mark it completed. An empty string is a legitimate (if rare) agent result.
    const output = result.output ?? "";
    task.status = "completed";
    task.completedAt = new Date();
    task.output = output;
    this.taskResults.set(task.id, output);

    // PRD-owning tasks write the shared WIP file (and stage it as a pending
    // commit if a repo is configured) so subsequent agents share one document.
    if (this.projectRoot && output.trim() && isPrdTask(task.agentRole, task.description)) {
      await writePrdWip(this.projectRoot, output);
    }

    this.telemetry?.emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt);
    this.persistWorkflow(workflow);
    return output;
  }

  // ---------------------------------------------------------------------------
  // Workflow-builder node handlers (in-process, non-agent execution)
  // ---------------------------------------------------------------------------

  /** Execute a builder node compiled to a `node:*` task, mirroring executeTask's
   *  completion bookkeeping (status, telemetry end, persistence, result cache). */
  private async runNodeHandler(task: Task, workflow: Workflow): Promise<string> {
    const { kind, config } = this.resolveNodeParams(task);
    try {
      const output = await this.executeNode(kind, config, task, workflow);
      task.status = "completed";
      task.completedAt = new Date();
      task.output = output;
      this.taskResults.set(task.id, output);
      this.telemetry?.emitTaskEnd(workflow.id, task.id, task.agentRole, task.startedAt ?? new Date());
      this.persistWorkflow(workflow);
      return output;
    } catch (err) {
      task.status = "failed";
      task.error = err instanceof Error ? err.message : String(err);
      task.completedAt = new Date();
      this.telemetry?.emitTaskEnd(
        workflow.id,
        task.id,
        task.agentRole,
        task.startedAt ?? new Date(),
        task.error,
      );
      this.persistWorkflow(workflow);
      throw err;
    }
  }

  /** Resolve a node's kind + config, tolerating both the in-process shape
   *  (task.nodeType / task.config) and the portal shape (task.input = JSON
   *  `{kind, config}` written by the workflow-definition run endpoint). */
  private resolveNodeParams(task: Task): { kind: string; config: Record<string, unknown> } {
    let kind =
      task.nodeType ??
      (task.agentRole.startsWith("node:") ? task.agentRole.slice("node:".length) : "");
    let config: Record<string, unknown> = task.config ?? {};
    if ((!kind || Object.keys(config).length === 0) && task.input) {
      try {
        const parsed = JSON.parse(task.input) as {
          kind?: string;
          config?: Record<string, unknown>;
        };
        if (!kind && parsed.kind) kind = parsed.kind;
        if (Object.keys(config).length === 0 && parsed.config) config = parsed.config;
      } catch {
        /* input was plain task text, not a node blob — leave defaults */
      }
    }
    return { kind, config };
  }

  /** Dispatch one builder node to its handler. Upstream node outputs are exposed
   *  as the structured-context block so a node can consume them. */
  private async executeNode(
    kind: string,
    config: Record<string, unknown>,
    task: Task,
    workflow: Workflow,
  ): Promise<string> {
    const upstream = this.buildStructuredContext(task, workflow);
    switch (kind) {
      case "llm":
        return this.runLlmNode(config, upstream);
      case "mcp":
        return this.runMcpNode(config, upstream);
      case "memory":
        return this.runMemoryNode(config, upstream);
      case "knowledge":
        return this.runKnowledgeNode(config, upstream);
      case "train":
        return this.runTrainNode(config);
      case "trigger":
        return `[trigger:${String(config.triggerType ?? "manual")}] workflow started`;
      case "output":
        return upstream; // surface aggregated upstream results as the run output
      case "transform": {
        const ctx = etlContext(upstream, config);
        return applyTransform(String(config.expression ?? ""), ctx);
      }
      case "filter": {
        const ctx = etlContext(upstream, config);
        const pass = evalPredicate(String(config.predicate ?? ""), ctx);
        // Drop = empty payload (not a failure) so downstream sees nothing.
        return pass ? upstream : "[filter] dropped — predicate not satisfied";
      }
      case "branch": {
        const ctx = etlContext(upstream, config);
        const taken = evalPredicate(String(config.condition ?? ""), ctx);
        return `[branch:${taken ? "true" : "false"}]\n${upstream}`;
      }
      default:
        return `[node:${kind}] no handler — passing through`;
    }
  }

  /** LLM node — call a model platform via the gateway. `{{input}}` in the prompt
   *  is substituted with the upstream payload. No-ops (records intent) when no
   *  LLM service is wired. */
  private async runLlmNode(config: Record<string, unknown>, upstream: string): Promise<string> {
    const provider = config.provider ? String(config.provider) : undefined;
    if (!this.llmService) {
      return `[llm] no LLM service wired — recorded intent for ${provider ?? "default provider"}`;
    }
    const prompt = String(config.prompt ?? upstream).replace(/\{\{\s*input\s*\}\}/g, upstream);
    const temperature = config.temperature != null ? Number(config.temperature) : undefined;
    return this.llmService.complete({
      provider,
      model: config.model ? String(config.model) : undefined,
      system: config.system ? String(config.system) : undefined,
      prompt,
      temperature: Number.isFinite(temperature) ? temperature : undefined,
    });
  }

  /** MCP node — invoke an MCP-server / SaaS integration tool. `params` is parsed
   *  from the node's JSON config. No-ops (records intent) when no MCP service is
   *  wired. */
  private async runMcpNode(config: Record<string, unknown>, _upstream: string): Promise<string> {
    const integration = String(config.integration ?? config.source ?? "");
    const operation = String(config.operation ?? "");
    if (!this.mcpService) {
      return `[mcp:${integration || "tool"}] no MCP transport wired — recorded intent for "${operation}"`;
    }
    let params: Record<string, unknown> = {};
    if (config.params) {
      try {
        const parsed = JSON.parse(String(config.params)) as unknown;
        if (parsed && typeof parsed === "object") params = parsed as Record<string, unknown>;
      } catch {
        /* leave params empty on malformed JSON */
      }
    }
    return this.mcpService.invoke({ integration, operation, params });
  }

  /** Memory node — recall from, or write to, the SSM hippocampus memory layer. */
  private async runMemoryNode(config: Record<string, unknown>, upstream: string): Promise<string> {
    const op = String(config.op ?? "recall");
    if (op === "write") {
      const key = String(config.key ?? "memory");
      const content = String(config.content ?? upstream);
      if (this.memoryService?.store) {
        await this.memoryService.store(key, content);
        return `[memory:write] stored "${key}"`;
      }
      return `[memory:write] no store port available — recorded intent for "${key}"`;
    }
    if (!this.memoryService) return "[memory:recall] memory service unavailable";
    const query = String(config.query ?? upstream).slice(0, 2_000);
    const limit = Number(config.limit ?? 5);
    const entries = await this.memoryService.recallSimilar(query, Number.isFinite(limit) ? limit : 5);
    if (entries.length === 0) return "[memory:recall] no matches";
    return ["[Memory Recall]", ...entries.map((e) => `- ${e.key}: ${e.content}`)].join("\n");
  }

  /** Knowledge-base node — query the KB or ingest source text into it. */
  private async runKnowledgeNode(
    config: Record<string, unknown>,
    upstream: string,
  ): Promise<string> {
    const op = String(config.op ?? "query");
    if (op === "ingest") {
      const source = String(config.source ?? config.content ?? upstream);
      const namespace = config.namespace ? String(config.namespace) : undefined;
      if (this.memoryService?.ingest) {
        const n = await this.memoryService.ingest(source, namespace);
        return `[knowledge:ingest] ingested ${n} chunk(s)${namespace ? ` into "${namespace}"` : ""}`;
      }
      return "[knowledge:ingest] no ingest port available — recorded intent";
    }
    if (!this.memoryService) return "[knowledge:query] knowledge service unavailable";
    const query = String(config.query ?? upstream).slice(0, 2_000);
    const limit = Number(config.limit ?? 5);
    const entries = await this.memoryService.recallSimilar(query, Number.isFinite(limit) ? limit : 5);
    if (entries.length === 0) return "[knowledge:query] no matches";
    return ["[Knowledge Base]", ...entries.map((e) => `- ${e.key}: ${e.content}`)].join("\n");
  }

  /** Train node — fine-tunes/distils the SSM hippocampus on the node's dataset
   *  via the memory service's training port and persists a checkpoint. Falls back
   *  to recording intent when no training-capable memory service is wired. */
  private async runTrainNode(config: Record<string, unknown>): Promise<string> {
    const model = String(config.model ?? "model");
    const dataset = String(config.dataset ?? config.content ?? "");
    const epochs = Number(config.epochs ?? 1);
    if (this.memoryService?.train) {
      return this.memoryService.train({ model, dataset, epochs: Number.isFinite(epochs) ? epochs : 1 });
    }
    logDebug(`[orchestrator] train node "${model}" — no training port on the memory service`);
    return `[train] no training port available — recorded intent for "${model}"`;
  }

  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId: string): Workflow | null {
    return this.workflows.get(workflowId) || null;
  }

  getLatestWorkflow(params?: { activeOnly?: boolean }): Workflow | null {
    const activeOnly = params?.activeOnly ?? false;
    const workflows = Array.from(this.workflows.values());
    if (workflows.length === 0) {
      return null;
    }
    const filtered = activeOnly
      ? workflows.filter((wf) => wf.status === "pending" || wf.status === "running")
      : workflows;
    if (filtered.length === 0) {
      return null;
    }
    return filtered.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }

  getRunnableTasks(workflowId: string): Task[] {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return [];
    }
    const completed = new Set(
      Array.from(workflow.tasks.values())
        .filter((task) => task.status === "completed")
        .map((task) => task.id),
    );
    return Array.from(workflow.tasks.values()).filter(
      (task) =>
        task.status === "pending" && task.dependencies.every((depId) => completed.has(depId)),
    );
  }

  /**
   * Cancel a workflow
   */
  cancelWorkflow(workflowId: string): void {
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      workflow.status = "cancelled";
      for (const task of workflow.tasks.values()) {
        if (task.status === "pending" || task.status === "running") {
          task.status = "cancelled";
        }
      }
    }
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /**
   * Serialize and write a workflow to .builderforce/sessions/workflow-<id>.yaml.
   * No-op when projectRoot has not been set.
   */
  private persistWorkflow(workflow: Workflow): void {
    if (!this.projectRoot) {
      return;
    }
    const serialized: PersistedWorkflow = {
      id: workflow.id,
      status: workflow.status,
      createdAt: workflow.createdAt.toISOString(),
      steps: workflow.steps,
      tasks: Object.fromEntries(
        Array.from(workflow.tasks.entries()).map(([id, task]) => [
          id,
          {
            id: task.id,
            description: task.description,
            agentRole: task.agentRole,
            status: task.status,
            input: task.input,
            output: task.output,
            error: task.error,
            childSessionKey: task.childSessionKey,
            createdAt: task.createdAt.toISOString(),
            startedAt: task.startedAt?.toISOString(),
            completedAt: task.completedAt?.toISOString(),
            dependencies: task.dependencies,
            dependents: task.dependents,
            attempts: task.attempts,
            lastError: task.lastError,
          } satisfies PersistedTask,
        ]),
      ),
      taskResults: Object.fromEntries(this.taskResults.entries()),
    };
    // Fire-and-forget — persistence failures are logged, not thrown
    saveWorkflowState(this.projectRoot, serialized).catch((err) => {
      logDebug(`[orchestrator] failed to persist workflow ${workflow.id}: ${String(err)}`);
    });
  }

  /**
   * Deserialize a PersistedWorkflow back into a live Workflow, re-registering
   * it in the in-memory map. Any tasks that were "running" at crash time are
   * reset to "pending" so they can be retried via resumeWorkflow().
   */
  private hydrateWorkflow(persisted: PersistedWorkflow): Workflow {
    const tasks = new Map<string, Task>();
    for (const [id, pt] of Object.entries(persisted.tasks)) {
      tasks.set(id, {
        id: pt.id,
        description: pt.description,
        agentRole: pt.agentRole,
        // Tasks that were in-flight when the process died should be retried
        status: pt.status === "running" ? "pending" : (pt.status as TaskStatus),
        input: pt.input,
        output: pt.output,
        error: pt.error,
        childSessionKey: pt.childSessionKey,
        createdAt: new Date(pt.createdAt),
        startedAt: pt.startedAt ? new Date(pt.startedAt) : undefined,
        completedAt: pt.completedAt ? new Date(pt.completedAt) : undefined,
        dependencies: pt.dependencies,
        dependents: pt.dependents,
        attempts: pt.attempts,
        lastError: pt.lastError,
      });
    }

    const workflow: Workflow = {
      id: persisted.id,
      steps: persisted.steps,
      tasks,
      status: persisted.status === "running" ? "pending" : (persisted.status as TaskStatus),
      createdAt: new Date(persisted.createdAt),
    };

    // Restore task results so dependency chains work correctly on resume
    for (const [taskId, result] of Object.entries(persisted.taskResults ?? {})) {
      this.taskResults.set(taskId, result);
    }

    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  /**
   * Load all incomplete workflows from disk into the in-memory map.
   * Call once at gateway startup so agents can resume or inspect them.
   * Returns the IDs of any incomplete workflows found.
   */
  async loadPersistedWorkflows(): Promise<string[]> {
    if (!this.projectRoot) {
      return [];
    }
    try {
      const ids = await listIncompleteWorkflowIds(this.projectRoot);
      for (const id of ids) {
        if (this.workflows.has(id)) {
          continue; // already in memory
        }
        const persisted = await loadWorkflowState(this.projectRoot, id);
        if (persisted) {
          this.hydrateWorkflow(persisted);
          logDebug(`[orchestrator] restored incomplete workflow ${id}`);
        }
      }
      return ids;
    } catch (err) {
      logDebug(`[orchestrator] failed to load persisted workflows: ${String(err)}`);
      return [];
    }
  }

  /**
   * Resume an incomplete workflow that was previously persisted to disk.
   * Already-completed tasks are skipped; pending/reset tasks are re-executed.
   *
   * Tasks that exhausted their retry budget before the crash/restart are reset to
   * `pending` with a fresh attempt budget so the resumed run genuinely re-attempts
   * them (self-healing across restarts) rather than inheriting a terminal failure.
   */
  async resumeWorkflow(
    workflowId: string,
    context: SpawnSubagentContext,
  ): Promise<Map<string, string>> {
    // Ensure the workflow is in memory (hydrate from disk if needed)
    if (!this.workflows.has(workflowId) && this.projectRoot) {
      const persisted = await loadWorkflowState(this.projectRoot, workflowId);
      if (!persisted) {
        throw new Error(`Workflow ${workflowId} not found on disk`);
      }
      this.hydrateWorkflow(persisted);
    }
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      for (const task of workflow.tasks.values()) {
        if (task.status === "failed") {
          task.status = "pending";
          task.error = undefined;
          task.attempts = 0; // fresh retry budget for this resume
        }
      }
      // Re-open a terminally-failed workflow so executeWorkflow re-evaluates it.
      if (workflow.status === "failed" || workflow.status === "cancelled") {
        workflow.status = "pending";
      }
    }
    return this.executeWorkflow(workflowId, context);
  }

  /**
   * Auto-resume every non-terminal workflow currently in memory. Intended to be
   * called once at startup, after {@link loadPersistedWorkflows}, so in-flight
   * work continues after a process restart.
   *
   * Guarded against double-invocation (idempotent): a second call while resumes
   * are still running is a no-op. Each workflow resumes independently; a failure
   * in one never blocks the others. Returns the IDs that were (re)started.
   */
  async resumeAllIncomplete(context: SpawnSubagentContext): Promise<string[]> {
    if (this.resumingInFlight) {
      return [];
    }
    this.resumingInFlight = true;
    try {
      const toResume = Array.from(this.workflows.values()).filter(
        (wf) => wf.status === "pending" || wf.status === "running",
      );
      const resumed: string[] = [];
      for (const wf of toResume) {
        resumed.push(wf.id);
        // Fire each resume independently; do not await so one slow/blocked
        // workflow cannot stall startup or the other resumes.
        void this.resumeWorkflow(wf.id, context).catch((err) => {
          logDebug(`[orchestrator] auto-resume of workflow ${wf.id} failed: ${String(err)}`);
        });
      }
      return resumed;
    } finally {
      this.resumingInFlight = false;
    }
  }
}

/**
 * Global orchestrator instance
 */
export const globalOrchestrator = new AgentOrchestrator();

/**
 * Common workflow patterns
 */

/**
 * Feature Development Workflow
 */
export function createFeatureWorkflow(featureDescription: string): WorkflowStep[] {
  return [
    {
      role: "architecture-advisor",
      task: `Analyze the architecture for implementing: ${featureDescription}`,
    },
    {
      role: "code-creator",
      task: `Implement the feature: ${featureDescription}`,
      dependsOn: [`Analyze the architecture for implementing: ${featureDescription}`],
    },
    {
      role: "test-generator",
      task: `Generate tests for: ${featureDescription}`,
      dependsOn: [`Implement the feature: ${featureDescription}`],
    },
    {
      role: "code-reviewer",
      task: `Review the implementation of: ${featureDescription}`,
      dependsOn: [`Generate tests for: ${featureDescription}`],
    },
  ];
}

/**
 * Bug Fix Workflow
 */
export function createBugFixWorkflow(bugDescription: string): WorkflowStep[] {
  return [
    {
      role: "bug-analyzer",
      task: `Diagnose and propose fix for: ${bugDescription}`,
    },
    {
      role: "code-creator",
      task: `Implement the fix for: ${bugDescription}`,
      dependsOn: [`Diagnose and propose fix for: ${bugDescription}`],
    },
    {
      role: "test-generator",
      task: `Generate regression tests for: ${bugDescription}`,
      dependsOn: [`Implement the fix for: ${bugDescription}`],
    },
    {
      role: "code-reviewer",
      task: `Review the bug fix for: ${bugDescription}`,
      dependsOn: [`Generate regression tests for: ${bugDescription}`],
    },
  ];
}

/**
 * Refactoring Workflow
 */
export function createRefactorWorkflow(scope: string): WorkflowStep[] {
  return [
    {
      role: "code-reviewer",
      task: `Identify refactoring opportunities in: ${scope}`,
    },
    {
      role: "refactor-agent",
      task: `Refactor code in: ${scope}`,
      dependsOn: [`Identify refactoring opportunities in: ${scope}`],
    },
    {
      role: "test-generator",
      task: `Ensure test coverage for refactored code in: ${scope}`,
      dependsOn: [`Refactor code in: ${scope}`],
    },
  ];
}

/**
 * Security Audit Workflow
 *
 * Four-phase audit:
 *   1. Threat model — identify attack surface, trust boundaries, data flows
 *   2. Vulnerability scan — OWASP Top 10, injection, secrets, auth/authz gaps
 *   3. Fix recommendations — prioritised remediation plan with code examples
 *   4. Verification report — confirm fixes, residual risk summary, sign-off checklist
 */
export function createSecurityAuditWorkflow(target: string): WorkflowStep[] {
  return [
    {
      role: "architecture-advisor",
      task: `Build a threat model for: ${target}. Identify attack surface, trust boundaries, data flows, and external integrations.`,
    },
    {
      role: "bug-analyzer",
      task: `Perform a security vulnerability scan of: ${target}. Check for OWASP Top 10 (injection, XSS, CSRF, broken auth, sensitive data exposure, SSRF, etc.), hardcoded secrets, insecure dependencies, and missing input validation.`,
      dependsOn: [
        `Build a threat model for: ${target}. Identify attack surface, trust boundaries, data flows, and external integrations.`,
      ],
    },
    {
      role: "code-creator",
      task: `Produce prioritised remediation recommendations for all vulnerabilities found in: ${target}. Include concrete code examples or patches for the highest-severity issues.`,
      dependsOn: [
        `Perform a security vulnerability scan of: ${target}. Check for OWASP Top 10 (injection, XSS, CSRF, broken auth, sensitive data exposure, SSRF, etc.), hardcoded secrets, insecure dependencies, and missing input validation.`,
      ],
    },
    {
      role: "code-reviewer",
      task: `Review the proposed security fixes for: ${target}. Verify completeness, check for regressions, and produce a final sign-off checklist with residual risk summary.`,
      dependsOn: [
        `Produce prioritised remediation recommendations for all vulnerabilities found in: ${target}. Include concrete code examples or patches for the highest-severity issues.`,
      ],
    },
  ];
}

/**
 * Quality Audit Workflow
 *
 * Bug Analyzer assesses test coverage / CI / build integrity, Test Generator
 * fills the biggest gaps, and Code Reviewer signs off on the quality posture.
 * The deterministic engine scores the report; this workflow does the deep pass.
 */
export function createQualityAuditWorkflow(target: string): WorkflowStep[] {
  const assess = `Assess engineering quality for: ${target}. Evaluate automated test coverage, CI presence and gating, lint/type safety, build reproducibility (lockfiles), and error observability. List the highest-impact gaps.`;
  const fill = `Add or strengthen automated tests and CI checks for the highest-impact gaps found in: ${target}. Prefer fast, deterministic tests around the riskiest untested paths.`;
  return [
    { role: "bug-analyzer", task: assess },
    { role: "test-generator", task: fill, dependsOn: [assess] },
    {
      role: "code-reviewer",
      task: `Review the quality improvements for: ${target}. Verify the new tests are meaningful (not tautological), CI is green, and produce a quality-posture sign-off with residual gaps.`,
      dependsOn: [fill],
    },
  ];
}

/**
 * Product Vision & Roadmap Audit Workflow
 *
 * Architecture Advisor evaluates product direction (vision, objectives, key
 * results, roadmap sequencing) and Documentation Agent writes/updates the vision
 * + roadmap artifacts to close the gaps.
 */
export function createPmVisionAuditWorkflow(target: string): WorkflowStep[] {
  const assess = `Audit the product vision and roadmap for: ${target}. Check for a clear one-page vision (problem, users, differentiation), outcome objectives with measurable key results, and a sequenced/dated roadmap of initiatives. Identify what is missing or vague.`;
  return [
    { role: "architecture-advisor", task: assess },
    {
      role: "documentation-agent",
      task: `Draft or update the product vision and roadmap documents for: ${target}, closing the gaps identified. Produce a concise vision doc and a sequenced roadmap outline.`,
      dependsOn: [assess],
    },
  ];
}

/**
 * Privacy & Data-Law Compliance Audit Workflow
 *
 * Architecture Advisor inventories personal data + data flows, Bug Analyzer
 * checks the code for privacy-law gaps (consent gating, unsubscribe, data export
 * / erasure, retention), Documentation Agent drafts the missing privacy policy /
 * DPA language, and Code Reviewer signs off. Deepens the deterministic privacy
 * scan with a content-level review.
 */
export function createPrivacyAuditWorkflow(target: string): WorkflowStep[] {
  const inventory = `Inventory the personal data and data flows for: ${target}. Identify what PII is collected, where it is stored, who it is shared with (subprocessors), and the legal basis for each.`;
  const gaps = `Audit ${target} for GDPR / CCPA·CPRA / CAN-SPAM gaps: is analytics/marketing gated behind opt-in consent; is there a working unsubscribe + List-Unsubscribe + physical address; are there self-service data export (Art. 20) and erasure (Art. 17) endpoints that truly delete; is there a documented retention/purge routine. List concrete gaps.`;
  return [
    { role: "architecture-advisor", task: inventory },
    { role: "bug-analyzer", task: gaps, dependsOn: [inventory] },
    {
      role: "documentation-agent",
      task: `Draft or update the privacy policy, cookie policy, and DPA/subprocessor language for: ${target}, closing the gaps found. Ensure data-subject rights and retention windows are stated plainly.`,
      dependsOn: [gaps],
    },
    {
      role: "code-reviewer",
      task: `Review the privacy remediations for: ${target}. Verify consent actually gates trackers, export/erasure endpoints work end-to-end, and produce a compliance sign-off with residual risk.`,
      dependsOn: [gaps],
    },
  ];
}

/**
 * Planning Workflow
 *
 * Architecture Advisor builds a PRD and architecture spec, then decomposes it
 * into an actionable task list.
 */
export function createPlanningWorkflow(goal: string): WorkflowStep[] {
  return [
    {
      role: "architecture-advisor",
      task: `Write a Product Requirements Document (PRD) for: ${goal}`,
    },
    {
      role: "architecture-advisor",
      task: `Write a detailed architecture specification for: ${goal}`,
      dependsOn: [`Write a Product Requirements Document (PRD) for: ${goal}`],
    },
    {
      role: "architecture-advisor",
      task: `Decompose into an ordered task list with dependencies for: ${goal}`,
      dependsOn: [`Write a detailed architecture specification for: ${goal}`],
    },
  ];
}

/**
 * Adversarial Review Workflow
 *
 * One agent produces output, a second critiques it, a third synthesizes the final result.
 */
export function createAdversarialReviewWorkflow(subject: string): WorkflowStep[] {
  return [
    {
      role: "architecture-advisor",
      task: `Produce a detailed proposal for: ${subject}`,
    },
    {
      role: "code-reviewer",
      task: `Critically review the proposal for gaps, errors, and blind spots in: ${subject}`,
      dependsOn: [`Produce a detailed proposal for: ${subject}`],
    },
    {
      role: "architecture-advisor",
      task: `Synthesize the critique into a revised, final proposal for: ${subject}`,
      dependsOn: [
        `Critically review the proposal for gaps, errors, and blind spots in: ${subject}`,
      ],
    },
  ];
}
