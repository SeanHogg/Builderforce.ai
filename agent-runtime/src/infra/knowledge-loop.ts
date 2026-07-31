import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BUILDERFORCE_URL = "https://api.builderforce.ai";
import { appendKnowledgeMemory } from "../builderforce/project-context.js";
import { contributeProjectEvermindFromText, type ProjectEvermindSyncConfig } from "./project-evermind-sync.js";
import { pushProjectFact, recallSharedProjectFacts } from "./project-facts-sync.js";
import { logDebug } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { getAgentRunContext, onAgentEvent } from "./agent-events.js";
import type { TeamMemoryEntry } from "./api-contract.js";
import {
  syncBuilderForceAgentsDirectory,
  type SyncBuilderForceAgentsDirParams,
} from "./builderforce-directory-sync.js";
import { registerKnowledgeLoop, registerTeamMemoryContextBuilder } from "./memory-bridge.js";
import { getSsmMemoryService } from "./ssm-memory-service.js";

/**
 * Derive a human-readable one-line summary of what happened in an agent run
 * based on heuristics over the tool activity. No model call required.
 *
 * Priority order (first matching rule wins):
 * 1. "Multi-agent workflow execution"   — orchestrate or workflow_status used
 * 2. "Code review / analysis"           — git_history, code_analysis, or project_knowledge used
 * 3. "Test suite created"               — *.test.* / *.spec.* file created
 * 4. "Tests updated"                    — *.test.* / *.spec.* file edited
 * 5. "Codebase exploration / read-only analysis" — only grep/glob/view, no bash, no file changes
 * 6. "Feature implementation: new files + edits" — both created and edited files
 * 7. "New file(s) created: N"           — only file creation
 * 8. "Code modifications: N file(s) changed" — only file edits
 * 9. "Agent activity (no file changes)" — tools used but no files created or edited
 * 10. ""                                — no activity at all
 *
 * @returns A short English label, or an empty string when there was no activity.
 */
export function deriveActivitySummary(params: {
  created: string[];
  edited: string[];
  tools: string[];
}): string {
  const { created, edited, tools } = params;
  const hasCreate = created.length > 0;
  const hasEdit = edited.length > 0;
  const toolSet = new Set(tools);

  const isTest =
    [...created, ...edited].some(
      (f) => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"),
    ) || toolSet.has("test");

  const isAnalysis =
    !hasCreate &&
    !hasEdit &&
    (toolSet.has("grep") || toolSet.has("glob") || toolSet.has("view")) &&
    !toolSet.has("bash");

  const isReview =
    toolSet.has("git_history") || toolSet.has("code_analysis") || toolSet.has("project_knowledge");

  const isOrchestration = toolSet.has("orchestrate") || toolSet.has("workflow_status");

  if (isOrchestration) {
    return "Multi-agent workflow execution";
  }
  if (isReview) {
    return "Code review / analysis";
  }
  if (isTest && hasCreate) {
    return "Test suite created";
  }
  if (isTest && hasEdit) {
    return "Tests updated";
  }
  if (isAnalysis) {
    return "Codebase exploration / read-only analysis";
  }
  if (hasCreate && hasEdit) {
    return "Feature implementation: new files + edits";
  }
  if (hasCreate) {
    return `New file(s) created: ${created.length}`;
  }
  if (hasEdit) {
    return `Code modifications: ${edited.length} file(s) changed`;
  }
  if (tools.length > 0) {
    return "Agent activity (no file changes)";
  }
  return "";
}

export type KnowledgeLoopOptions = {
  workspaceDir: string;
  apiKey?: string | null;
  baseUrl?: string;
  agentNodeId?: string | null;
  projectId?: number;
};

type RunAccumulator = {
  sessionKey: string;
  filesCreated: string[];
  filesEdited: string[];
  toolNames: string[];
  /** The run's initiating user prompt (the "ticket"), captured at accumulate time
   *  from the run context so the project-Evermind teacher distils (task → answer). */
  prompt?: string;
};

export function buildKnowledgeMemoryEntry(params: {
  sessionKey: string;
  ts: string;
  acc?: RunAccumulator;
}): string | null {
  const lines: string[] = [`\n## [${params.ts}] session:${params.sessionKey}`, ""];
  let hasMeaningfulContent = false;

  if (params.acc) {
    const created = [...new Set(params.acc.filesCreated)];
    const edited = [...new Set(params.acc.filesEdited)];
    const tools = [...new Set(params.acc.toolNames)];
    if (created.length > 0) {
      lines.push(`**Created**: ${created.join(", ")}`);
      hasMeaningfulContent = true;
    }
    if (edited.length > 0) {
      lines.push(`**Edited**: ${edited.join(", ")}`);
      hasMeaningfulContent = true;
    }
    if (tools.length > 0) {
      lines.push(`**Tools**: ${tools.join(", ")}`);
      hasMeaningfulContent = true;
    }
    const summary = deriveActivitySummary({ created, edited, tools });
    if (summary) {
      lines.push(`**Summary**: ${summary}`);
      hasMeaningfulContent = true;
    }
  }

  if (!hasMeaningfulContent) {
    return null;
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Listens for agent run completions and writes a timestamped activity entry to
 * .builderforce/memory/YYYY-MM-DD.md, then syncs .builderforce/ to Builderforce if credentials
 * are configured.
 */
export class KnowledgeLoopService {
  private readonly runs = new Map<string, RunAccumulator>();
  private unsub: (() => void) | null = null;

  constructor(private readonly opts: KnowledgeLoopOptions) {}

  /** Start listening for agent events. Safe to call once. */
  start(): void {
    if (this.unsub) {
      return;
    }
    // Register with the memory bridge mediator so SsmMemoryService can access
    // team memory without creating a circular dependency.
    registerKnowledgeLoop(this);
    registerTeamMemoryContextBuilder(async () => {
      const entries = await this.pullTeamMemory(5);
      const typed = entries as Array<{ summary?: string; agentNodeId?: string; timestamp?: string }>;
      if (!typed || typed.length === 0) {
        return "";
      }
      const lines = ["[Team Memory Context]"];
      for (const entry of typed) {
        const who = entry.agentNodeId ? `agentNode:${entry.agentNodeId}` : "unknown";
        const when = entry.timestamp ? ` (${entry.timestamp.slice(0, 10)})` : "";
        lines.push(`- [${who}${when}] ${entry.summary ?? ""}`);
      }
      lines.push("[End Team Memory Context]");
      // SHARED project facts — durable beliefs any surface (VS Code / cloud / prior
      // on-prem run) wrote for this project, so on-prem recall sees them too.
      const cfg = this.projectEvermindConfig();
      if (cfg) {
        const facts = await recallSharedProjectFacts(cfg, undefined, 6);
        if (facts.length > 0) {
          lines.push("[Project memory — durable facts recalled for this project]");
          for (const f of facts) lines.push(`- ${f.content}`);
        }
      }
      return lines.join("\n") + "\n";
    });
    this.unsub = onAgentEvent((evt) => {
      if (!this.unsub) {
        return; // stopped
      }

      if (evt.stream === "tool") {
        this.accumulate(evt.runId, evt.sessionKey ?? "unknown", evt.data);
      }

      if (
        evt.stream === "lifecycle" &&
        typeof evt.data["phase"] === "string" &&
        (evt.data["phase"] === "end" || evt.data["phase"] === "error")
      ) {
        void this.onRunComplete(evt.runId, evt.sessionKey ?? "unknown");
      }
    });
    logDebug("[knowledge-loop] started");
  }

  /** Stop listening and clear accumulated state. */
  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.runs.clear();
    // Persist any pending SSM adaptation so the learning loop survives shutdown.
    const ssmSvc = getSsmMemoryService();
    if (ssmSvc) {
      void ssmSvc.flush().catch((err) => {
        logDebug(`[ssm-memory] flush on stop failed: ${String(err)}`);
      });
    }
    logDebug("[knowledge-loop] stopped");
  }

  // ---------------------------------------------------------------------------

  private accumulate(runId: string, sessionKey: string, data: Record<string, unknown>): void {
    if (!this.runs.has(runId)) {
      // Capture the initiating prompt NOW (during the run) — the run context is still
      // registered here; by onRunComplete it may already be cleared.
      const prompt = getAgentRunContext(runId)?.prompt;
      this.runs.set(runId, {
        sessionKey,
        filesCreated: [],
        filesEdited: [],
        toolNames: [],
        ...(prompt ? { prompt } : {}),
      });
    }
    const acc = this.runs.get(runId)!;
    const toolName = typeof data["toolName"] === "string" ? data["toolName"] : null;
    if (toolName) {
      acc.toolNames.push(toolName);
    }
    const filePath = typeof data["path"] === "string" ? data["path"] : null;
    if (filePath) {
      if (toolName === "create" || toolName === "write") {
        acc.filesCreated.push(filePath);
      } else if (toolName === "edit") {
        acc.filesEdited.push(filePath);
      }
    }
  }

  private async onRunComplete(runId: string, sessionKey: string): Promise<void> {
    const acc = this.runs.get(runId);
    this.runs.delete(runId);

    // Compute once; reused for both the memory file (via buildKnowledgeMemoryEntry) and the SSM layer.
    const created = acc ? [...new Set(acc.filesCreated)] : [];
    const edited = acc ? [...new Set(acc.filesEdited)] : [];
    const tools = acc ? [...new Set(acc.toolNames)] : [];
    const summary = deriveActivitySummary({ created, edited, tools });

    const ts = new Date().toISOString();
    const entry = buildKnowledgeMemoryEntry({ ts, sessionKey, acc });
    if (!entry) {
      return;
    }

    try {
      await appendKnowledgeMemory(this.opts.workspaceDir, entry);
    } catch (err) {
      logDebug(`[knowledge-loop] failed to write memory entry: ${String(err)}`);
    }

    // Feed the SSM hippocampus layer — non-fatal.
    // remember() stores the concise summary for fast semantic recall; learn()
    // adapts the model on the full structured activity record (the same text
    // written to the memory file), a far richer training signal than the label.
    const ssmSvc = getSsmMemoryService();
    if (ssmSvc) {
      if (summary) {
        try {
          await ssmSvc.remember(runId, summary, {
            tags: ["activity"],
            importance: 0.6,
          });
        } catch (err) {
          logDebug(`[ssm-memory] remember() failed: ${String(err)}`);
        }
        try {
          // `entry` is the structured markdown block (Created/Edited/Tools/Summary);
          // it is non-null here because a non-empty summary implies meaningful content.
          await ssmSvc.learn((entry ?? summary).trim());
        } catch (err) {
          logDebug(`[ssm-memory] learn() failed: ${String(err)}`);
        }
        // Write-through belief layer (Evermind Write-Through Cognition). The
        // remember()/learn() calls above are the append-only ACTIVITY EVENT LOG
        // (events legitimately accumulate — they don't supersede). On top of it
        // we record a per-FILE state belief keyed by a STABLE subject
        // (`file:<path>`), so the latest change to a file SUPERSEDES the prior
        // note instead of piling up alongside it — the exact drift a
        // reconcile-free model exists to eliminate. commitFact routes through
        // EvermindCognition (Canonicalize → Recall incumbent → Evaluate →
        // Reconcile supersede|augment|confirm|reject → write-through + recall
        // invalidation) and degrades to a plain keyed put on older packages.
        for (const { file, action } of [
          ...created.map((file) => ({ file, action: "created" as const })),
          ...edited.map((file) => ({ file, action: "edited" as const })),
        ]) {
          try {
            const factContent = `${file} was ${action} — ${summary}`;
            await ssmSvc.commitFact(`file:${file}`, factContent, {
              tags: ["file-state"],
              importance: 0.55,
            });
            // Mirror the belief to the SHARED project store so cloud/editor runs
            // recall it too (best-effort — the local commit is the source of truth).
            const cfg = this.projectEvermindConfig();
            if (cfg) void pushProjectFact(cfg, `file:${file}`, factContent);
          } catch (err) {
            logDebug(`[ssm-memory] commitFact() failed for ${file}: ${String(err)}`);
          }
        }
        // Push to team mesh (P4-5) — fire-and-forget
        void this.pushMemoryToMesh(runId, summary, ["activity"]);
      }
    }

    // Contribute a WEIGHT DELTA to the project's shared Evermind (concurrent
    // learning): adapt the project model on this run's activity and push the diff
    // to the coordinator. Fire-and-forget + fully guarded — a no-op unless the
    // runtime is configured to reach a seeded, connected project model.
    void this.contributeToProjectEvermind((entry ?? summary ?? "").trim(), acc?.prompt, created.length + edited.length > 0);

    await this.syncIfConfigured();
  }

  /** Build project-Evermind sync config from the loop's gateway opts (reuses the
   *  same Bearer + X-AgentHost-Id auth `pushMemoryToMesh` uses). Null unless a
   *  gateway key, numeric host id, and project id are all present. */
  private projectEvermindConfig(): ProjectEvermindSyncConfig | null {
    const { apiKey, baseUrl, agentNodeId, projectId } = this.opts;
    const hostId = Number(agentNodeId);
    if (!apiKey || !Number.isInteger(hostId) || hostId <= 0 || !projectId) return null;
    return { gatewayUrl: baseUrl ?? DEFAULT_BUILDERFORCE_URL, apiKey, agentHostId: hostId, projectId: Number(projectId) };
  }

  /** Adapt-and-push a project-Evermind contribution (best-effort, non-fatal). The
   *  `prompt` (the run's ticket) lets the coordinator's teacher distil (task → answer).
   *  `producedChanges` weights the contribution by run quality: a run that actually
   *  created/edited files teaches harder than a no-op one (0.7 vs 0.4), replacing the
   *  old raw-text-length weight. */
  private async contributeToProjectEvermind(text: string, prompt?: string, producedChanges = false): Promise<void> {
    const cfg = this.projectEvermindConfig();
    if (!cfg || text.length < 20) return;
    try {
      const res = await contributeProjectEvermindFromText(cfg, text, prompt, producedChanges ? 0.7 : 0.4);
      if (res.ok) logDebug(`[project-evermind] contributed a delta (base v${res.version})`);
      else logDebug(`[project-evermind] skipped: ${res.reason}`);
    } catch (err) {
      logDebug(`[project-evermind] contribution error: ${String(err)}`);
    }
  }

  private async syncIfConfigured(): Promise<void> {
    const { apiKey, baseUrl, agentNodeId, workspaceDir, projectId } = this.opts;
    if (!apiKey || !agentNodeId) {
      return;
    }
    const syncParams: SyncBuilderForceAgentsDirParams = {
      workspaceDir,
      apiKey,
      baseUrl: baseUrl ?? DEFAULT_BUILDERFORCE_URL,
      agentNodeId,
      projectId,
    };
    try {
      await syncBuilderForceAgentsDirectory(syncParams);
      logDebug("[knowledge-loop] .builderforce/ synced to Builderforce");
    } catch (err) {
      logDebug(`[knowledge-loop] sync failed: ${String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // P4-5: Cross-agentNode memory mesh
  // ---------------------------------------------------------------------------

  /**
   * Push an activity summary to the Builderforce team memory mesh.
   * Fire-and-forget — errors are logged but never surfaced to the caller.
   */
  async pushMemoryToMesh(runId: string, summary: string, tags?: string[]): Promise<void> {
    const { apiKey, baseUrl, agentNodeId } = this.opts;
    if (!apiKey || !agentNodeId) {
      return;
    }
    const url = `${normalizeBaseUrl(baseUrl ?? DEFAULT_BUILDERFORCE_URL)}/api/teams/memory`;
    const payload = {
      agentNodeId,
      runId,
      summary,
      tags: tags ?? [],
      timestamp: new Date().toISOString(),
    };
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-AgentHost-Id": String(agentNodeId),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      logDebug(`[knowledge-loop] pushed memory to mesh: ${summary.slice(0, 60)}`);
    } catch (err) {
      logDebug(`[knowledge-loop] pushMemoryToMesh failed: ${String(err)}`);
    }
  }

  /**
   * Pull recent team memory entries from Builderforce.
   * Caches results in `.builderforce/memory/team-memory.json` (TTL: 5 minutes).
   * Returns an empty array on error.
   */
  async pullTeamMemory(limit = 20): Promise<TeamMemoryEntry[]> {
    const { apiKey, baseUrl, workspaceDir } = this.opts;
    const cacheFile = path.join(workspaceDir, ".builderForceAgents", "memory", "team-memory.json");
    const TTL_MS = 5 * 60 * 1000;

    // Check cache first
    try {
      const raw = await fs.readFile(cacheFile, "utf-8");
      const cached = JSON.parse(raw) as { ts: number; entries: TeamMemoryEntry[] };
      if (Date.now() - cached.ts < TTL_MS) {
        return cached.entries;
      }
    } catch {
      // cache miss or parse error — proceed to fetch
    }

    if (!apiKey) {
      return [];
    }
    const url = `${normalizeBaseUrl(baseUrl ?? DEFAULT_BUILDERFORCE_URL)}/api/teams/memory?limit=${limit}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logDebug(`[knowledge-loop] pullTeamMemory HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as { entries: TeamMemoryEntry[] };
      const entries = Array.isArray(data.entries) ? data.entries : [];

      // Write cache
      try {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify({ ts: Date.now(), entries }), "utf-8");
      } catch {
        // cache write failure is non-fatal
      }

      return entries;
    } catch (err) {
      logDebug(`[knowledge-loop] pullTeamMemory failed: ${String(err)}`);
      return [];
    }
  }
}

// ── Gateway-level singleton accessor (used by SsmMemoryService for P4-5) ──────

let _knowledgeLoopInstance: KnowledgeLoopService | null = null;

/** Called by the gateway startup to register the singleton. */
export function setKnowledgeLoopService(svc: KnowledgeLoopService): void {
  _knowledgeLoopInstance = svc;
}

/** Returns the gateway-level KnowledgeLoopService singleton, or null. */
export function getKnowledgeLoopService(): KnowledgeLoopService | null {
  return _knowledgeLoopInstance;
}
