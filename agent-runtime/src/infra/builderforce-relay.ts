/**
 * BuilderforceRelayService
 *
 * Persistent upstream WebSocket connection from builderForceAgents → Builderforce relay.
 * Bridges bidirectional chat:
 *   - Browser → AgentNodeRelayDO → upstream WS → this service → local gateway → agent
 *   - Agent → local gateway events → this service → upstream WS → AgentNodeRelayDO → browsers
 *
 * Also sends periodic HTTP heartbeats to keep lastSeenAt fresh in the DB.
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_ENGINE_ID, ENGINE_IDS } from "@builderforce/agent-tools";
import { WebSocket } from "ws";
import { buildAssignedCapabilityAppend } from "../agents/assigned-capabilities.js";
import { runClaudeAgentSdkV2, type V2RunnerSinks } from "../agents/claude-agent-sdk-runner.js";
import { loadProjectContext, updateProjectContextFields } from "../builderforce/project-context.js";
import type { IRelayService } from "../builderforce/relay-service.js";
import { GatewayClient, type GatewayClientOptions } from "../gateway/client.js";
import type { EventFrame } from "../gateway/protocol/index.js";
import { logDebug, logWarn } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import type { AgentEngine, EngineDispatch } from "./agent-engine.js";
import { onAgentEvent } from "./agent-events.js";
import { resolveApproval } from "./approval-gate.js";
import {
  makeCodingAgent,
  makeCodingGit,
  makeCodingHttp,
} from "./builderforce-coding-dispatch-adapters.js";
import { runCodingDispatch } from "./builderforce-coding-dispatch.js";
import {
  buildLocalMachineProfile,
  mergeBuilderforceContext,
  type AssignmentContextResponse,
} from "./builderforce-context.js";
import {
  RelayHeartbeat,
  RelayLogPoller,
  RelayPresencePoller,
} from "./builderforce-relay-helpers.js";
import { resolveCodingSession } from "./coding-session-broker.js";
import { buildSteeringInjection } from "./relay-steering.js";
import { resolveRemoteResult } from "./remote-result-broker.js";
import { dispatchResultToRemoteAgentNode, type RemoteDispatchOptions } from "./remote-subagent.js";
import {
  taskWorkspaceDir,
  buildTaskCloneUrl,
  taskBranchName,
  isCloned,
  detectTaskChanges,
  sweepStaleTaskWorkspaces,
} from "./task-workspace.js";
import { setRelayHook } from "./workflow-telemetry.js";

function extractChatText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const msg = message as { content?: unknown; text?: unknown };
  if (typeof msg.text === "string") {
    return msg.text;
  }
  if (!Array.isArray(msg.content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of msg.content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text.trim().length > 0) {
      parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function extractChatRole(message: unknown): "user" | "assistant" {
  if (!message || typeof message !== "object") {
    return "assistant";
  }
  const role = (message as { role?: unknown }).role;
  if (role === "user") {
    return "user";
  }
  return "assistant";
}

export type BuilderforceRelayOptions = {
  /** Base HTTP(S) URL of Builderforce, e.g. "https://api.builderforce.ai" */
  baseUrl: string;
  /** Numeric agentNode instance id (as string), from context.builderforce.instanceId */
  agentNodeId: string;
  /** Plaintext API key from BUILDERFORCE_API_KEY */
  apiKey: string;
  /** Local builderForceAgents gateway WebSocket URL. Defaults to ws://127.0.0.1:18789 */
  gatewayUrl?: string;
  /** Workspace path for updating .builderforce/context.yaml with assignment metadata. */
  workspaceDir?: string;
};

export class BuilderforceRelayService implements IRelayService {
  private ws: WebSocket | null = null;
  private closed = false;
  private backoffMs = 1000;
  private readonly heartbeat: RelayHeartbeat;
  private readonly logPoller: RelayLogPoller;
  private readonly presencePoller: RelayPresencePoller;
  private gatewayClient: GatewayClient | null = null;
  /** executionId from the last task.assign / task.broadcast dispatch, if any. */
  private pendingExecutionId: number | null = null;
  /** Abort handles for in-flight V2 (Claude Agent SDK) runs, keyed by executionId,
   *  so an `execution.cancel` frame from the portal can actually halt the run. */
  private readonly v2Aborts = new Map<number, AbortController>();
  /** Tracks pending remote task correlations so results can be sent back. */
  private pendingRemoteCorrelations = new Map<
    string,
    { correlationId: string; callbackAgentNodeId: string; callbackBaseUrl: string }
  >();
  /** Remote dispatch options, set after construction so result callbacks work. */
  private remoteDispatchOpts: RemoteDispatchOptions | null = null;

  private readonly upstreamWsUrl: string;
  private readonly heartbeatHttpUrl: string;
  private readonly assignmentContextUrl: string;
  private readonly gatewayWsUrl: string;

  /**
   * Engine registry — the dependency-injection seam. Maps an engine id to its
   * {@link AgentEngine} implementation; `dispatchTaskFromRelay` resolves by id and
   * calls `run()` instead of branching. Adding/swapping a runner is a registry entry.
   *
   * **V1 and Local are RETIRED (operator decision 2026-06-14)** — `runV1Engine` and the
   * `builderforce-local` shared-registry engine are gone; neither has a registry entry.
   * The sole runner is `builderforce-v2` (the Claude-Agent-SDK engine, gateway-routed),
   * which is also {@link DEFAULT_ENGINE_ID}; any legacy `engine` value (`builderforce-v1`,
   * `builderforce-local`) is unknown here and falls through to v2. Adding a runner is a
   * registry entry; the DI seam stays even with one engine so the next runner is a wiring
   * change, not a branch.
   */
  private resolveEngine(engineId?: string): AgentEngine {
    const v2: AgentEngine = { id: ENGINE_IDS.v2, run: (d, p) => this.runV2Engine(d, p) };
    const registry: Record<string, AgentEngine> = { [v2.id]: v2 };
    return registry[engineId ?? ""] ?? registry[DEFAULT_ENGINE_ID];
  }

  private dispatchTaskFromRelay(payload: EngineDispatch): void {
    const lines = [
      `[Builderforce ${payload.sourceType}] ${payload.title}`,
      payload.description ? "" : undefined,
      payload.description,
      payload.executionId != null ? "" : undefined,
      payload.executionId != null ? `Execution ID: ${payload.executionId}` : undefined,
      payload.taskId != null ? `Task ID: ${payload.taskId}` : undefined,
    ].filter((line): line is string => typeof line === "string");

    const message = lines.join("\n").trim();
    if (!message) {
      return;
    }

    // Track executionId so we can report running/completed/failed back to Builderforce.
    if (payload.executionId != null) {
      this.pendingExecutionId = payload.executionId;
      void this.reportExecutionState(payload.executionId, "running");
    }

    // Resolve the runtime by id from the engine registry (DI seam) and run it —
    // no hard-coded V1/V2 branch. Adding/swapping a runner is a registry change;
    // removing V1 is deleting its registration. Both engines run out of the shared
    // per-ticket workspace.
    const engine = this.resolveEngine(payload.engine);
    const runEngine = () => {
      void engine.run(payload, message);
    };

    // Apply assigned artifacts FIRST, then run — both engines read the synced
    // persona registry / sidecar at run start, so the sync must complete before
    // the run begins (otherwise the agent races past its own capabilities).
    if (payload.artifacts) {
      void this.syncAssignedCapabilities(
        payload.artifacts,
        payload.executionId,
        payload.taskId,
      ).finally(runEngine);
    } else {
      runEngine();
    }
  }

  /**
   * Push assigned artifacts to the gateway (applies persona registry + writes the
   * sidecar) and record a `capabilities.load` event on the Observability timeline
   * (live frame + durable persist) so on-prem runs show which Skills/Personas/
   * Content were loaded — at parity with the cloud `capabilities.load` event.
   * Awaited before the run starts; never throws.
   */
  private async syncAssignedCapabilities(
    artifacts: { skills?: string[]; personas?: string[]; content?: string[] },
    executionId?: number,
    taskId?: number,
  ): Promise<void> {
    try {
      await this.gatewayClient?.request("artifacts.sync", { artifacts, executionId, taskId });
    } catch (err) {
      logWarn(`[builderforce] artifacts.sync failed: ${String(err)}`);
    }

    const skills = artifacts.skills ?? [];
    const personas = artifacts.personas ?? [];
    const content = artifacts.content ?? [];
    if (!(skills.length || personas.length || content.length)) return;

    const summary = { skills, personas, content };
    this.sendToRelay({
      type: "tool.audit",
      sessionKey: "main",
      toolName: "capabilities.load",
      category: "context",
      args: summary,
      ts: new Date().toISOString(),
    });
    void this.persistToolAudit({
      executionId,
      toolName: "capabilities.load",
      category: "context",
      args: summary,
    });
    logWarn(
      `[builderforce] capabilities.load: ${personas.length} persona(s), ${skills.length} skill(s), ${content.length} content`,
    );
  }

  /**
   * Ensure the shared per-ticket workspace exists and (once) holds a clone of the
   * task's bound repo. Returns the working directory both engines run in.
   */
  private async ensureTaskWorkspace(
    taskId: number | undefined,
    repo?: { repoId: string; defaultBranch: string | null },
  ): Promise<string> {
    const baseDir = this.opts.workspaceDir ?? process.cwd();
    const cwd = taskId != null ? taskWorkspaceDir(baseDir, taskId) : baseDir;
    await fs.mkdir(cwd, { recursive: true }).catch(() => {
      /* fall back to baseDir */
    });
    if (repo?.repoId && taskId != null) {
      const git = makeCodingGit({ apiKey: this.opts.apiKey });
      if (!(await isCloned(cwd))) {
        try {
          const cloneUrl = buildTaskCloneUrl(
            normalizeBaseUrl(this.opts.baseUrl),
            this.opts.agentNodeId,
            repo.repoId,
          );
          await git.clone(cloneUrl, cwd, repo.defaultBranch ?? null);
        } catch (err) {
          logWarn(`[builderforce] task ${taskId} clone failed: ${String(err)}`);
        }
      }
      // Execute under the ticket branch so every change is pending on it. Idempotent:
      // creating an existing branch fails harmlessly (the tree is already on it).
      if (await isCloned(cwd)) {
        await git.checkoutNewBranch(cwd, taskBranchName(taskId)).catch(() => {
          /* already on the branch */
        });
      }
    }
    return cwd;
  }

  /**
   * Commit ALL of the ticket workspace's changes to the ticket branch and push —
   * so every file the agent touched (PRD, code, tests, …) becomes a pending change
   * on the branch, with a PR opened/kept open. Runs after each agent run and on
   * Done. No-ops when nothing changed. Never throws.
   */
  private async commitAndPushTicketBranch(
    taskId: number,
    repo: { repoId: string; defaultBranch: string | null },
    title: string,
    agentLabel: string,
  ): Promise<void> {
    const dir = taskWorkspaceDir(this.opts.workspaceDir ?? process.cwd(), taskId);
    if (!(await isCloned(dir))) return;
    const git = makeCodingGit({ apiKey: this.opts.apiKey });
    const branch = taskBranchName(taskId);
    try {
      const { changed } = await git.commitAll(
        dir,
        `BuilderForce: task ${taskId} — ${title} (by ${agentLabel})`.trim(),
      );
      if (!changed) return; // nothing new to push
      const base = normalizeBaseUrl(this.opts.baseUrl);
      await git.push(dir, buildTaskCloneUrl(base, this.opts.agentNodeId, repo.repoId), branch);
      // Open/keep a PR so the pending changes are reviewable (idempotent server-side).
      await fetch(`${base}/api/agent-hosts/${this.opts.agentNodeId}/tasks/${taskId}/pull-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({ branch, base: repo.defaultBranch ?? undefined, title }),
        signal: AbortSignal.timeout(30_000),
      }).catch(() => {
        /* branch pushed; PR can be opened manually */
      });
      logWarn(`[builderforce] task ${taskId}: pushed pending changes to ${branch}`);
    } catch (err) {
      logWarn(`[builderforce] task ${taskId} commit/push failed: ${String(err)}`);
    }
  }

  /** Diff the ticket workspace and emit one attributed file.change per change. */
  private async emitTaskChanges(
    cwd: string,
    agentLabel: string,
    executionId: number | undefined,
    taskId: number | undefined,
  ): Promise<void> {
    for (const ch of await detectTaskChanges(cwd, agentLabel)) {
      this.sendToRelay({
        type: "file.change",
        executionId,
        taskId,
        path: ch.path,
        change: ch.change,
        agent: ch.agent,
        ts: new Date().toISOString(),
      });
    }
  }

  /**
   * BuilderForce-V2 engine path. Runs the Claude Agent SDK against the workspace,
   * forwarding its events onto the same relay frames the V1 loop emits
   * (chat.message for assistant text, tool.audit for tool calls) so the portal
   * renders both engines identically, then reports the terminal execution state.
   */
  private async runV2Engine(payload: EngineDispatch, prompt: string): Promise<void> {
    const agentLabel = payload.agentLabel?.trim() || "BuilderForce-V2";
    const sinks: V2RunnerSinks = {
      onAssistantText: (text) => {
        // Live view…
        this.sendToRelay({ type: "chat.message", role: "assistant", text, session: "main" });
        // …and durable persistence, so the V2 run's natural-language turns show on
        // the Logs/Timeline after it ends (parity with V1's `agent.message`).
        void this.persistToolAudit({
          executionId: payload.executionId,
          toolName: "agent.message",
          category: "message",
          result: text,
        });
      },
      onToolUse: (toolName, toolCallId, args) => {
        // Live view (fans out to subscribers)…
        this.sendToRelay({
          type: "tool.audit",
          sessionKey: "main",
          toolName,
          toolCallId,
          category: "v2",
          args,
          ts: new Date().toISOString(),
        });
        // …and durable persistence, so the run stays on the timeline after it ends.
        void this.persistToolAudit({
          executionId: payload.executionId,
          toolName,
          toolCallId,
          category: "v2",
          args,
        });
      },
      onResult: () => {
        /* terminal state is reported below from the runner's return value */
      },
    };

    // One shared ephemeral workspace per ticket — every agent on the task works
    // out of it (the ticket is the shared context). Clone happens once.
    const cwd = await this.ensureTaskWorkspace(payload.taskId, payload.repo);

    // Assigned Skills/Personas/Content → appended to the SDK system prompt (the
    // V2 run path injects nothing otherwise). Mirrors the V1 embedded injection.
    const appendSystemPrompt = await buildAssignedCapabilityAppend();

    // Register an abort handle so an `execution.cancel` frame can stop this run.
    const abortController = new AbortController();
    if (payload.executionId != null) {
      this.v2Aborts.set(payload.executionId, abortController);
    }

    let result: { ok: boolean; text: string };
    try {
      result = await runClaudeAgentSdkV2(
        {
          prompt,
          model: payload.model,
          cwd,
          // SDK posts Messages to `${anthropicBaseUrl}/v1/messages`; the gateway's
          // Anthropic-Messages endpoint lives under /llm.
          anthropicBaseUrl: `${normalizeBaseUrl(this.opts.baseUrl)}/llm`,
          gatewayAuthKey: this.opts.apiKey,
          appendSystemPrompt,
          abortController,
        },
        sinks,
      );
    } finally {
      if (payload.executionId != null) {
        this.v2Aborts.delete(payload.executionId);
      }
    }

    // If the run was cancelled, the API already flipped the row to CANCELLED (a
    // terminal state); don't report completed/failed over it.
    if (abortController.signal.aborted) {
      await this.emitTaskChanges(cwd, agentLabel, payload.executionId, payload.taskId);
      return;
    }

    // Attribute the files this agent changed (traceability), then commit + push
    // them to the ticket branch as pending changes.
    await this.emitTaskChanges(cwd, agentLabel, payload.executionId, payload.taskId);
    if (payload.taskId != null && payload.repo?.repoId) {
      await this.commitAndPushTicketBranch(
        payload.taskId,
        payload.repo,
        payload.title ?? `Task ${payload.taskId}`,
        agentLabel,
      );
    }

    if (payload.executionId != null) {
      await this.reportExecutionState(
        payload.executionId,
        result.ok ? "completed" : "failed",
        result.ok ? { result: result.text } : { errorMessage: result.text },
      );
    }
  }

  /**
   * Finalize a ticket on Done: a final commit + push of any remaining changes to
   * the ticket branch (the per-run commits already pushed earlier ones), then tear
   * the workspace down. Never throws.
   */
  private async finalizeTask(payload: {
    taskId: number;
    title?: string;
    repoId?: string;
    defaultBranch?: string | null;
  }): Promise<void> {
    const dir = taskWorkspaceDir(this.opts.workspaceDir ?? process.cwd(), payload.taskId);
    if (payload.repoId && (await isCloned(dir))) {
      await this.commitAndPushTicketBranch(
        payload.taskId,
        { repoId: payload.repoId, defaultBranch: payload.defaultBranch ?? null },
        payload.title ?? `Task ${payload.taskId}`,
        "BuilderForce",
      );
    }
    // Tear the ticket workspace down — the work is committed/pushed, ticket is Done.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* best-effort */
    });
  }

  /**
   * Handle a swimlane `agent_dispatch` frame end-to-end: clone the bound repo
   * through the host git-proxy, run the embedded agent against it, push, open a
   * PR, and report the terminal result. Never throws — runCodingDispatch always
   * reports a terminal result so the stage can't hang.
   */
  private async handleAgentDispatch(dispatchId: string): Promise<void> {
    const workspaceDir = this.opts.workspaceDir ?? process.cwd();
    try {
      await runCodingDispatch(
        {
          http: makeCodingHttp({
            baseUrl: this.opts.baseUrl,
            agentNodeId: this.opts.agentNodeId,
            apiKey: this.opts.apiKey,
          }),
          git: makeCodingGit({ apiKey: this.opts.apiKey }),
          agent: makeCodingAgent(() => this.gatewayClient),
          baseUrl: normalizeBaseUrl(this.opts.baseUrl),
          workspaceDir,
          joinPath: (...parts: string[]) => path.join(...parts),
        },
        dispatchId,
      );
    } catch (err) {
      logWarn(`[builderforce] agent_dispatch ${dispatchId} failed: ${String(err)}`);
    }
  }

  /**
   * Report execution lifecycle state back to Builderforce.
   * Fire-and-forget — errors are logged but never surfaced to the caller.
   */
  /**
   * Persist one tool-call audit event so the run is observable on the timeline
   * AFTER it ends — not just live. The relay frame ({@link sendToRelay}
   * `tool.audit`) only fans out to live subscribers; this HTTP POST writes it to
   * the durable `tool_audit_events` store via the same agent-host ingest the
   * self-hosted path uses. Fire-and-forget; never surfaces errors.
   */
  private async persistToolAudit(event: {
    executionId?: number;
    toolName: string;
    toolCallId?: string;
    category?: string;
    args?: unknown;
    result?: string;
  }): Promise<void> {
    const base = normalizeBaseUrl(this.opts.baseUrl);
    const url = `${base}/api/agent-hosts/${this.opts.agentNodeId}/tool-audit`;
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          // Tie the event to its execution so it's queryable per-run as well as
          // per-host. sessionKey 'main' matches the live relay frame.
          executionId: event.executionId,
          runId: event.executionId != null ? `exec-${event.executionId}` : undefined,
          sessionKey: "main",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          category: event.category,
          args: event.args,
          result: event.result,
          ts: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logDebug(`[builderforce-relay] tool-audit persist failed: ${String(err)}`);
    }
  }

  private async reportExecutionState(
    executionId: number,
    status: "running" | "completed" | "failed" | "cancelled",
    extra?: { result?: string; errorMessage?: string },
  ): Promise<void> {
    const base = normalizeBaseUrl(this.opts.baseUrl);
    const url = `${base}/api/agent-hosts/${this.opts.agentNodeId}/executions/${executionId}/state`;
    try {
      await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({ status, ...extra }),
        signal: AbortSignal.timeout(10_000),
      });
      logDebug(`[builderforce-relay] execution ${executionId} → ${status}`);
    } catch (err) {
      logDebug(`[builderforce-relay] execution state report failed: ${String(err)}`);
    }
  }

  constructor(private readonly opts: BuilderforceRelayOptions) {
    const base = normalizeBaseUrl(opts.baseUrl)
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:");
    // API key is passed via Authorization header, not as a query param.
    // Query params appear in server access logs and CDN caches — headers are safer.
    this.upstreamWsUrl = `${base}/api/agent-hosts/${opts.agentNodeId}/upstream`;
    this.heartbeatHttpUrl = `${normalizeBaseUrl(opts.baseUrl)}/api/agent-hosts/${opts.agentNodeId}/heartbeat`;
    this.assignmentContextUrl = `${normalizeBaseUrl(opts.baseUrl)}/api/agent-hosts/${opts.agentNodeId}/assignment-context`;
    this.gatewayWsUrl = opts.gatewayUrl ?? "ws://127.0.0.1:18789";

    this.heartbeat = new RelayHeartbeat({
      heartbeatUrl: this.heartbeatHttpUrl,
      apiKey: opts.apiKey,
      workspaceDir: opts.workspaceDir,
    });
    this.logPoller = new RelayLogPoller(
      () => this.gatewayClient,
      (msg) => this.sendToRelay(msg),
    );
    this.presencePoller = new RelayPresencePoller(
      () => this.gatewayClient,
      (msg) => this.sendToRelay(msg),
    );
  }

  /** Set remote dispatch options so result callbacks can be sent back to the originating agentNode. */
  setRemoteDispatchOptions(opts: RemoteDispatchOptions): void {
    this.remoteDispatchOpts = opts;
  }

  // ---------------------------------------------------------------------------
  // Remote context fetching (P4-2)
  // ---------------------------------------------------------------------------

  /**
   * Fetch the last-synced .builderforce/ files from a remote agentNode via Builderforce and
   * write them to `.builderforce/remote-context/<remoteAgentNodeId>/` in the local workspace.
   * Only writes files whose SHA-256 content hash has changed since the last fetch.
   */
  async fetchRemoteContext(remoteAgentNodeId: string): Promise<void> {
    if (!this.opts.workspaceDir) {
      return;
    }
    const base = normalizeBaseUrl(this.opts.baseUrl);
    const url = `${base}/api/agent-hosts/${encodeURIComponent(remoteAgentNodeId)}/context-bundle`;
    let bundle: { files: Array<{ path: string; content: string; sha256: string }> };
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        logDebug(
          `[builderforce-relay] context-bundle for agentNode ${remoteAgentNodeId} failed: ${res.status}`,
        );
        return;
      }
      bundle = (await res.json()) as typeof bundle;
    } catch (err) {
      logDebug(`[builderforce-relay] fetchRemoteContext error: ${String(err)}`);
      return;
    }

    if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
      return;
    }

    const targetDir = path.join(
      this.opts.workspaceDir,
      ".builderForceAgents",
      "remote-context",
      remoteAgentNodeId,
    );

    for (const file of bundle.files) {
      if (typeof file.path !== "string" || typeof file.content !== "string") {
        continue;
      }
      // Sanitize path: strip leading slashes and resolve relative dots
      const safeName = file.path
        .replace(/\\/g, "/")
        .replace(/^[./]+/, "")
        .replace(/\.\.\//g, "");
      if (!safeName) {
        continue;
      }
      const destPath = path.join(targetDir, safeName);

      // Check existing SHA-256 before writing
      let existingSha: string | null = null;
      try {
        const existing = await fs.readFile(destPath, "utf-8");
        const digest = createHash("sha256").update(existing, "utf-8").digest("hex");
        existingSha = digest;
      } catch {
        // File doesn't exist yet
      }

      if (existingSha === file.sha256) {
        continue; // unchanged
      }

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, file.content, "utf-8");
      logDebug(`[builderforce-relay] wrote remote context file: ${safeName}`);
    }
  }

  /** Start the relay service. Both WS connections retry on their own. */
  start(): void {
    if (this.closed) {
      return;
    }
    // Register the relay hook so workflow telemetry spans are forwarded as live
    // WebSocket events to browser clients (workflow.update, task.started, task.completed).
    setRelayHook((event, payload) => {
      this.sendToRelay({ type: "event", event, payload });
    });
    // Reclaim ticket workspaces orphaned by a previous crash/kill (a run that
    // never received task.finalize leaves its clone on disk). At startup nothing
    // is in flight, so no active dir needs protecting. Best-effort; never blocks startup.
    void sweepStaleTaskWorkspaces(this.opts.workspaceDir ?? process.cwd(), {
      activeTaskIds: [],
    })
      .then(({ removed }) => {
        if (removed.length) {
          logWarn(`[builderforce] swept ${removed.length} stale ticket workspace(s)`);
        }
      })
      .catch(() => {
        /* best-effort */
      });
    this.connectUpstream();
    this.connectLocalGateway();
    this.startRemoteResultTracking();
  }

  /** Gracefully shut down both connections. */
  stop(): void {
    this.closed = true;
    setRelayHook(null); // deregister so no dangling sends after stop
    this.heartbeat.clear();
    this.logPoller.clear();
    this.presencePoller.clear();
    this.ws?.close(1000, "stopped");
    this.ws = null;
    this.gatewayClient?.stop();
    this.gatewayClient = null;
  }

  // ---------------------------------------------------------------------------
  // Remote result tracking — send task results back to the originating agentNode
  // ---------------------------------------------------------------------------

  private startRemoteResultTracking(): void {
    onAgentEvent((evt) => {
      if (this.closed) {
        return;
      }
      if (evt.stream !== "lifecycle") {
        return;
      }
      const phase = evt.data["phase"];
      if (phase !== "end" && phase !== "error") {
        return;
      }
      const sessionKey = evt.sessionKey ?? "";
      const correlation = this.pendingRemoteCorrelations.get(sessionKey);
      if (!correlation) {
        return;
      }
      this.pendingRemoteCorrelations.delete(sessionKey);
      // Capture the last assistant message or a summary from the lifecycle event
      const errorVal = evt.data["error"];
      const errorStr = typeof errorVal === "string" ? errorVal : "unknown error";
      const summary =
        typeof evt.data["summary"] === "string"
          ? evt.data["summary"]
          : phase === "error"
            ? `Remote task failed: ${errorStr}`
            : `Remote task completed on agentNode ${this.opts.agentNodeId}`;
      // Send the result back to the originating agentNode
      if (this.remoteDispatchOpts) {
        void dispatchResultToRemoteAgentNode(
          this.remoteDispatchOpts,
          correlation.callbackAgentNodeId,
          correlation.correlationId,
          summary,
        );
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Upstream WebSocket (builderForceAgents → AgentNodeRelayDO)
  // ---------------------------------------------------------------------------

  private connectUpstream(): void {
    if (this.closed) {
      return;
    }

    const ws = new WebSocket(this.upstreamWsUrl, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    this.ws = ws;

    ws.on("open", () => {
      logWarn("[builderforce-relay] upstream connected");
      this.backoffMs = 1000;
      this.heartbeat.schedule();
      void this.syncAssignmentContext("ws-open");
    });

    ws.on("message", (raw) => {
      try {
        const rawText =
          typeof raw === "string"
            ? raw
            : raw instanceof Buffer
              ? raw.toString("utf-8")
              : Array.isArray(raw)
                ? Buffer.concat(raw).toString("utf-8")
                : raw instanceof ArrayBuffer
                  ? Buffer.from(new Uint8Array(raw)).toString("utf-8")
                  : "";
        const msg = JSON.parse(rawText) as Record<string, unknown>;
        this.handleRelayMessage(msg);
      } catch {
        /* ignore malformed frames */
      }
    });

    ws.on("close", () => {
      if (this.ws === ws) {
        this.ws = null;
        this.heartbeat.clear();
        logWarn("[builderforce-relay] upstream disconnected — reconnecting…");
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      logWarn(`[builderforce-relay] upstream error: ${String(err)}`);
      // "close" follows automatically
    });
  }

  /**
   * Handle messages forwarded from browser clients through AgentNodeRelayDO.
   * Translates Builderforce wire protocol → local gateway method calls.
   */
  private handleRelayMessage(msg: Record<string, unknown>): void {
    const type = typeof msg.type === "string" ? msg.type : "";

    switch (type) {
      case "relay_connected":
        logDebug("[builderforce-relay] relay acknowledged connection");
        break;

      case "ping":
        // Relay sends 30s pings to keep the upstream connection alive; no reply needed.
        break;

      case "chat": {
        const message = typeof msg.message === "string" ? msg.message : "";
        const session = typeof msg.session === "string" ? msg.session : "main";
        this.gatewayClient
          ?.request("chat.send", {
            sessionKey: session,
            message,
            idempotencyKey: randomUUID(),
          })
          .catch((err: unknown) => {
            logDebug(`[builderforce-relay] chat.send failed: ${String(err)}`);
          });
        break;
      }

      case "chat.abort":
        this.gatewayClient?.request("chat.abort", {}).catch(() => {});
        break;

      case "session.new":
        this.gatewayClient?.request("chat.new", {}).catch(() => {});
        break;

      case "logs.subscribe":
        this.logPoller.start(true);
        break;

      case "presence.subscribe":
        this.presencePoller.start();
        break;

      case "rpc.call": {
        const requestId =
          typeof msg.requestId === "string" && msg.requestId.trim().length > 0
            ? msg.requestId
            : randomUUID();
        const method = typeof msg.method === "string" ? msg.method.trim() : "";
        const params =
          msg.params && typeof msg.params === "object" && !Array.isArray(msg.params)
            ? (msg.params as Record<string, unknown>)
            : {};

        if (!method) {
          this.sendToRelay({
            type: "rpc.error",
            requestId,
            method,
            error: "method required",
          });
          break;
        }

        this.gatewayClient
          ?.request(method, params)
          .then((result) => {
            this.sendToRelay({
              type: "rpc.result",
              requestId,
              method,
              result,
            });
          })
          .catch((err: unknown) => {
            this.sendToRelay({
              type: "rpc.error",
              requestId,
              method,
              error: String(err),
            });
          });
        break;
      }

      case "remote.task": {
        // Peer agentNode delegated a task to this agentNode — execute it as a chat message.
        const task = typeof msg.task === "string" ? msg.task : "";
        const fromAgentNodeId =
          typeof msg.fromAgentNodeId === "string" ? msg.fromAgentNodeId : "unknown";
        const correlationId = typeof msg.correlationId === "string" ? msg.correlationId : "";
        const callbackAgentNodeId =
          typeof msg.callbackAgentNodeId === "string" ? msg.callbackAgentNodeId : "";
        const callbackBaseUrl = typeof msg.callbackBaseUrl === "string" ? msg.callbackBaseUrl : "";
        if (!task) {
          break;
        }
        logDebug(
          `[builderforce-relay] remote task from agentNode ${fromAgentNodeId}: ${task.slice(0, 80)}…`,
        );
        // Track correlation so we can send result back when the session completes.
        const sessionKey = correlationId ? `remote-${correlationId}` : "main";
        if (correlationId && callbackAgentNodeId) {
          this.pendingRemoteCorrelations.set(sessionKey, {
            correlationId,
            callbackAgentNodeId,
            callbackBaseUrl,
          });
        }
        this.gatewayClient
          ?.request("chat.send", {
            sessionKey,
            message: `[Remote task from agentNode ${fromAgentNodeId}]\n\n${task}`,
            idempotencyKey: `remote-${fromAgentNodeId}-${correlationId || Date.now()}`,
          })
          .catch((err: unknown) => {
            logDebug(`[builderforce-relay] remote.task dispatch failed: ${String(err)}`);
          });
        break;
      }

      case "remote.task.result": {
        // A remote agentNode sent the result of a task we previously dispatched.
        const correlationId = typeof msg.correlationId === "string" ? msg.correlationId : "";
        const result = typeof msg.result === "string" ? msg.result : "";
        if (correlationId) {
          const resolved = resolveRemoteResult(correlationId, result);
          logDebug(
            `[builderforce-relay] remote.task.result ${correlationId}: ${resolved ? "resolved" : "no pending callback"}`,
          );
        }
        break;
      }

      case "task.assign":
      case "task.broadcast": {
        const taskRecord =
          msg.task && typeof msg.task === "object" ? (msg.task as Record<string, unknown>) : null;
        const title = typeof taskRecord?.title === "string" ? taskRecord.title.trim() : "";
        const description =
          typeof taskRecord?.description === "string" ? taskRecord.description.trim() : "";
        const executionId =
          typeof msg.executionId === "number" && Number.isFinite(msg.executionId)
            ? msg.executionId
            : undefined;
        const taskId =
          typeof msg.taskId === "number" && Number.isFinite(msg.taskId) ? msg.taskId : undefined;

        // Extract artifact assignments from the dispatch payload
        const rawArtifacts =
          msg.artifacts && typeof msg.artifacts === "object"
            ? (msg.artifacts as Record<string, unknown>)
            : undefined;
        const artifacts = rawArtifacts
          ? {
              skills: Array.isArray(rawArtifacts.skills)
                ? (rawArtifacts.skills as string[])
                : undefined,
              personas: Array.isArray(rawArtifacts.personas)
                ? (rawArtifacts.personas as string[])
                : undefined,
              content: Array.isArray(rawArtifacts.content)
                ? (rawArtifacts.content as string[])
                : undefined,
            }
          : undefined;

        if (!title && !description) {
          logWarn(`[builderforce] received ${type} without task content`);
          break;
        }

        // Engine selector + model are resolved by the API (engine from the cloud
        // agent record, model from the run payload).
        const engine = typeof msg.engine === "string" ? msg.engine : DEFAULT_ENGINE_ID;
        let model: string | undefined;
        try {
          const p =
            typeof msg.payload === "string"
              ? (JSON.parse(msg.payload) as { model?: unknown })
              : null;
          if (p && typeof p.model === "string" && p.model.trim()) model = p.model.trim();
        } catch {
          /* payload not JSON — use the engine default model */
        }

        // Repo coords (for cloning into the ticket workspace) + executing agent
        // label (for change traceability) are resolved by the API.
        const repoRaw =
          msg.repo && typeof msg.repo === "object" ? (msg.repo as Record<string, unknown>) : null;
        const repo =
          repoRaw && typeof repoRaw.repoId === "string"
            ? {
                repoId: repoRaw.repoId,
                defaultBranch:
                  typeof repoRaw.defaultBranch === "string" ? repoRaw.defaultBranch : null,
              }
            : undefined;
        const agentLabel = typeof msg.agentLabel === "string" ? msg.agentLabel : undefined;

        logWarn(
          `[builderforce] received ${type}${taskId != null ? ` task=${taskId}` : ""}${executionId != null ? ` execution=${executionId}` : ""} engine=${engine}`,
        );

        this.dispatchTaskFromRelay({
          sourceType: type,
          title: title || "Assigned task",
          description: description || undefined,
          executionId,
          taskId,
          artifacts,
          engine,
          model,
          repo,
          agentLabel,
        });
        void this.syncAssignmentContext(type);
        break;
      }

      case "execution.message": {
        // Steering: a user sent a follow-up direction to a running execution
        // from the portal. Inject it into the live `main` session as the next
        // turn so the agent picks it up mid-run.
        const executionId =
          typeof msg.executionId === "number" && Number.isFinite(msg.executionId)
            ? msg.executionId
            : undefined;
        const injection = buildSteeringInjection(executionId, msg.text, Date.now());
        if (!injection) break;
        logWarn(`[builderforce] steering message for execution ${executionId ?? "?"}`);
        this.gatewayClient?.request("chat.send", injection).catch((err: unknown) => {
          logWarn(`[builderforce] execution.message dispatch failed: ${String(err)}`);
        });
        break;
      }

      case "execution.cancel": {
        // The user cancelled a running execution from the portal. Halt the work:
        // abort the in-flight V2 SDK run (if any) and abort the live V1 chat
        // session, so cancel actually stops token spend instead of only flipping
        // the DB status.
        const executionId =
          typeof msg.executionId === "number" && Number.isFinite(msg.executionId)
            ? msg.executionId
            : undefined;
        logWarn(`[builderforce] cancel execution ${executionId ?? "?"}`);
        if (executionId != null) {
          const ctrl = this.v2Aborts.get(executionId);
          if (ctrl) {
            try {
              ctrl.abort();
            } catch {
              /* ignore */
            }
          }
        }
        // V1 (pi) runs out of the live `main` session — abort the current turn.
        // The API already set the row to CANCELLED (terminal) before relaying
        // this frame, so we don't report state back — just stop the work.
        this.gatewayClient?.request("chat.abort", {}).catch(() => {});
        break;
      }

      case "task.finalize": {
        // Task marked Done → commit the shared ticket workspace to a branch,
        // push it, and open a PR.
        const finalizeTaskId =
          typeof msg.taskId === "number" && Number.isFinite(msg.taskId) ? msg.taskId : undefined;
        if (finalizeTaskId == null) break;
        const repoRaw =
          msg.repo && typeof msg.repo === "object" ? (msg.repo as Record<string, unknown>) : null;
        void this.finalizeTask({
          taskId: finalizeTaskId,
          title: typeof msg.title === "string" ? msg.title : undefined,
          repoId: repoRaw && typeof repoRaw.repoId === "string" ? repoRaw.repoId : undefined,
          defaultBranch:
            repoRaw && typeof repoRaw.defaultBranch === "string" ? repoRaw.defaultBranch : null,
        });
        break;
      }

      case "agent_dispatch": {
        // Swimlane coding dispatch: clone the bound repo through the host
        // git-proxy, run the embedded agent against it, push, open a PR, and
        // report the terminal result so the SwimlaneCoordinator advances.
        const dispatchId = typeof msg.dispatchId === "string" ? msg.dispatchId : "";
        if (!dispatchId) {
          logWarn("[builderforce] agent_dispatch without dispatchId");
          break;
        }
        logWarn(`[builderforce] received agent_dispatch dispatch=${dispatchId}`);
        void this.handleAgentDispatch(dispatchId);
        break;
      }

      case "approval.decision": {
        // A human resolved a pending request in the portal: approved/rejected an
        // action, or answered a question/feedback request with free text.
        const approvalId = typeof msg.approvalId === "string" ? msg.approvalId : "";
        const decision = typeof msg.status === "string" ? msg.status : "";
        const responseText = typeof msg.responseText === "string" ? msg.responseText : undefined;
        if (
          approvalId &&
          (decision === "approved" || decision === "rejected" || decision === "answered")
        ) {
          logWarn(`[builderforce-relay] approval.decision ${approvalId}: ${decision}`);
          resolveApproval(approvalId, decision, responseText);
        }
        break;
      }

      default:
        break;
    }
  }

  /** Send a raw message to all browser clients via the relay. */
  private sendToRelay(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // Heartbeat, log polling, and presence polling are handled by focused helpers:
  // RelayHeartbeat, RelayLogPoller, RelayPresencePoller (builderforce-relay-helpers.ts)

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    setTimeout(() => this.connectUpstream(), delay).unref();
  }

  // ---------------------------------------------------------------------------
  // Local Gateway Client (local agent events → relay → browsers)
  // ---------------------------------------------------------------------------

  private connectLocalGateway(): void {
    const opts: GatewayClientOptions = {
      url: this.gatewayWsUrl,
      onEvent: (evt) => this.handleGatewayEvent(evt),
      onConnectError: (err) => {
        logDebug(`[builderforce-relay] local gateway connect error: ${String(err)}`);
      },
    };
    const gw = new GatewayClient(opts);
    this.gatewayClient = gw;
    // GatewayClient has its own backoff reconnect — start it independently of upstream.
    gw.start();
  }

  /**
   * Translate local gateway "chat" EventFrames → Builderforce browser protocol,
   * then broadcast to all connected browser clients via the upstream WS.
   */
  private handleGatewayEvent(evt: EventFrame): void {
    if (evt.event !== "chat") {
      return;
    }

    const p = evt.payload as
      | {
          type?: string;
          sessionKey?: string;
          text?: string;
          role?: string;
          delta?: string;
          toolCallId?: string;
          toolName?: string;
          toolInput?: string;
          toolResult?: string;
        }
      | null
      | undefined;

    const legacy = evt.payload as
      | {
          sessionKey?: string;
          state?: string;
          message?: unknown;
          errorMessage?: string;
        }
      | null
      | undefined;

    if (!p) {
      return;
    }

    if (legacy && typeof legacy.state === "string") {
      const session = legacy.sessionKey ?? "main";
      if (legacy.state === "final") {
        const text = extractChatText(legacy.message);
        const role = extractChatRole(legacy.message);
        if (text) {
          this.sendToRelay({
            type: "chat.message",
            role,
            text,
            session,
          });
        }
        // A coding dispatch waiting on this session handles its own terminal
        // reporting (commit/push/PR/dispatch-result) — don't double-report.
        if (resolveCodingSession(session, { ok: true, text })) {
          return;
        }
        // Report execution completed to Builderforce if one is pending.
        if (this.pendingExecutionId != null) {
          const eid = this.pendingExecutionId;
          this.pendingExecutionId = null;
          void this.reportExecutionState(eid, "completed", { result: text || undefined });
        }
        return;
      }
      if (legacy.state === "error") {
        const text = legacy.errorMessage?.trim();
        if (text) {
          this.sendToRelay({
            type: "chat.message",
            role: "assistant",
            text: `[error] ${text}`,
            session,
          });
        }
        // A coding dispatch waiting on this session reports its own failure.
        if (resolveCodingSession(session, { ok: false, text: text ?? "agent error" })) {
          return;
        }
        // Report execution failed to Builderforce if one is pending.
        if (this.pendingExecutionId != null) {
          const eid = this.pendingExecutionId;
          this.pendingExecutionId = null;
          void this.reportExecutionState(eid, "failed", { errorMessage: text || undefined });
        }
        return;
      }
    }

    switch (p.type) {
      case "delta":
        this.sendToRelay({
          type: "chat.delta",
          delta: p.delta ?? "",
          session: p.sessionKey ?? "main",
        });
        break;
      case "message":
        this.sendToRelay({
          type: "chat.message",
          role: p.role ?? "assistant",
          text: p.text ?? "",
          session: p.sessionKey ?? "main",
        });
        break;
      case "tool_use":
        this.sendToRelay({
          type: "tool.start",
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          toolInput: p.toolInput,
          session: p.sessionKey ?? "main",
        });
        break;
      case "tool_result":
        this.sendToRelay({
          type: "tool.result",
          toolCallId: p.toolCallId,
          toolResult: p.toolResult,
          session: p.sessionKey ?? "main",
        });
        break;
      case "abort":
        this.sendToRelay({ type: "chat.abort", session: p.sessionKey ?? "main" });
        break;
      default:
        break;
    }
  }

  // Heartbeat → delegated to this.heartbeat (RelayHeartbeat in builderforce-relay-helpers.ts)

  private async syncAssignmentContext(reason: string): Promise<void> {
    if (!this.opts.workspaceDir) {
      return;
    }
    try {
      const response = await fetch(this.assignmentContextUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        logDebug(`[builderforce-relay] assignment-context ${reason} failed: ${response.status}`);
        return;
      }
      const assignmentContext = (await response.json()) as AssignmentContextResponse;
      const context = await loadProjectContext(this.opts.workspaceDir);
      if (!context) {
        return;
      }

      const machineProfile = buildLocalMachineProfile({
        workspaceDirectory: this.opts.workspaceDir,
        rootInstallDirectory: process.cwd(),
        gatewayPort: 18789,
        tunnelUrl: process.env.BUILDERFORCE_AGENTS_PUBLIC_TUNNEL_URL,
        tunnelStatus: process.env.BUILDERFORCE_AGENTS_PUBLIC_TUNNEL_URL ? "connected" : "none",
      });

      const builderforce = mergeBuilderforceContext({
        existing: context.builderforce,
        assignmentContext,
        fallback: { instanceId: this.opts.agentNodeId, url: this.opts.baseUrl },
        machineProfile,
      });

      await updateProjectContextFields(this.opts.workspaceDir, { builderforce });
    } catch (err) {
      logDebug(`[builderforce-relay] assignment-context ${reason} failed: ${String(err)}`);
    }
  }
}
