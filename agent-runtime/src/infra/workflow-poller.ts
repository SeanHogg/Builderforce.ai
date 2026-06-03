/**
 * Workflow Poller — executes Builderforce-authored visual workflows on this
 * agentHost.
 *
 * The portal's workflow builder compiles a definition into a `workflows`
 * execution record + pending tasks assigned to a agentHost. This poller closes
 * the loop: it periodically claims the next pending workflow for this host,
 * rebuilds it as an orchestrator workflow (LLM-logic / ETL nodes run in-process,
 * agent nodes via the host's runtimes), executes it, and reports the terminal
 * task results + workflow status back to the portal.
 *
 * Uses a simple polling loop (no platform cron primitive) so it works in any
 * Node.js process. Auth mirrors workflow-telemetry forwarding: Bearer API key +
 * X-AgentHost-Id header.
 */

import { globalOrchestrator, type SpawnSubagentContext } from "../builderforce/orchestrator.js";
import { logDebug, logWarn } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

type WorkflowPollerOptions = {
  baseUrl: string;
  /** AgentHost id — used for the X-AgentHost-Id auth header. */
  agentNodeId: string;
  apiKey: string;
  /** Supplies the spawn context executeWorkflow threads into agent dispatches. */
  getContext: () => SpawnSubagentContext;
  /** Poll interval in ms (default 15s). */
  intervalMs?: number;
};

type ClaimedTask = {
  id: string;
  agentRole: string;
  description: string;
  input: string | null;
  dependsOn: string | null;
};

type ClaimResponse = {
  workflow: { id: string; status: string } | null;
  tasks?: ClaimedTask[];
};

/** Parse the stored task `input` ({kind, config}) defensively. */
function parseNodeInput(input: string | null): { kind?: string; config?: Record<string, unknown> } {
  if (!input) return {};
  try {
    const v = JSON.parse(input) as { kind?: string; config?: Record<string, unknown> };
    return { kind: v.kind, config: v.config };
  } catch {
    return {};
  }
}

/** Parse a JSON array of dependency task ids defensively. */
function parseDeps(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export class WorkflowPollerService {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private busy = false;

  constructor(private readonly opts: WorkflowPollerOptions) {}

  start(): void {
    const interval = this.opts.intervalMs ?? 15_000;
    // Fire one claim immediately, then on the interval.
    void this.tick();
    this.pollTimer = setInterval(() => void this.tick(), interval);
  }

  stop(): void {
    this.closed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.apiKey}`,
      "X-AgentHost-Id": this.opts.agentNodeId,
      ...extra,
    };
  }

  /** Claim + execute at most one workflow per tick. Skips re-entry while busy. */
  private async tick(): Promise<void> {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      const claim = await this.claim();
      if (!claim?.workflow) return;
      await this.runClaimed(claim.workflow.id, claim.tasks ?? []);
    } catch (err) {
      logWarn(`[workflow-poller] tick error: ${String(err)}`);
    } finally {
      this.busy = false;
    }
  }

  private async claim(): Promise<ClaimResponse | null> {
    const url = `${normalizeBaseUrl(this.opts.baseUrl)}/api/workflows/claim`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        if (res.status !== 401) logWarn(`[workflow-poller] claim failed: ${res.status}`);
        return null;
      }
      return (await res.json()) as ClaimResponse;
    } catch (err) {
      logDebug(`[workflow-poller] claim error: ${String(err)}`);
      return null;
    }
  }

  private async runClaimed(workflowId: string, tasks: ClaimedTask[]): Promise<void> {
    logWarn(`[workflow-poller] executing workflow ${workflowId} (${tasks.length} task(s))`);

    const specs = tasks.map((t) => {
      const { kind, config } = parseNodeInput(t.input);
      return {
        id: t.id,
        agentRole: t.agentRole,
        description: t.description,
        // Human task text is the agent prompt; node handlers read `config`.
        input: t.description,
        dependsOn: parseDeps(t.dependsOn),
        nodeType: kind && kind !== "agent" ? kind : undefined,
        config,
      };
    });

    globalOrchestrator.createWorkflowFromTasks(workflowId, specs);

    let failed = false;
    try {
      await globalOrchestrator.executeWorkflow(workflowId, this.opts.getContext());
    } catch (err) {
      failed = true;
      logWarn(`[workflow-poller] workflow ${workflowId} failed: ${String(err)}`);
    }

    // Read the final task states from the orchestrator and report them back.
    const wf = globalOrchestrator.getWorkflowStatus(workflowId);
    const reportTasks = wf
      ? Array.from(wf.tasks.values()).map((task) => ({
          id: task.id,
          status: task.status,
          output: task.output,
          error: task.error,
        }))
      : [];
    const status: "completed" | "failed" =
      failed || (wf?.status === "failed") ? "failed" : "completed";

    await this.reportResult(workflowId, reportTasks, status);
  }

  private async reportResult(
    workflowId: string,
    tasks: Array<{ id: string; status: string; output?: string; error?: string }>,
    status: "completed" | "failed",
  ): Promise<void> {
    const url = `${normalizeBaseUrl(this.opts.baseUrl)}/api/workflows/${workflowId}/host-result`;
    try {
      await fetch(url, {
        method: "POST",
        headers: this.authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ tasks, status }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logWarn(`[workflow-poller] result report failed for ${workflowId}: ${String(err)}`);
    }
  }
}
