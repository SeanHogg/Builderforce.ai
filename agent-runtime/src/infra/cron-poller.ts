/**
 * Cron Poller — executes Builderforce-managed cron jobs on this agentNode.
 *
 * At startup, fetches the list of enabled cron jobs from Builderforce and
 * schedules each one using standard cron expressions (5-field: min hr dom mon dow).
 * When a job fires, it dispatches the task to the gateway as a chat.send and
 * patches lastRunAt + lastStatus back to Builderforce.
 *
 * Cron expression format: "0/5 * * * *"  (every 5 minutes)
 *   field order: minute  hour  day-of-month  month  day-of-week
 *
 * This implementation uses a 1-minute polling loop instead of platform-level
 * cron primitives so it works in any Node.js process without extra dependencies.
 */

import { GatewayClient } from "../gateway/client.js";
import { logDebug, logWarn } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

export type CronJobRecord = {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  taskId: number | null;
  /** When set, the schedule belongs to a specific project agent (project_agents.id). */
  projectAgentId: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

type CronPollerOptions = {
  baseUrl: string;
  agentNodeId: string;
  apiKey: string;
  gatewayUrl?: string;
};

/**
 * Parse a 5-field cron expression and return the next Date after `after`.
 * Supports: "*", "STEP/n" (step), and literal numbers. Does not support ranges.
 * Returns null if the expression is malformed.
 */
function nextCronDate(expr: string, after: Date): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  const [mE, hE, , ,] = parts; // only minute + hour used for simple scheduling

  const tryMinute = (base: Date): Date | null => {
    const d = new Date(base);
    d.setSeconds(0, 0);

    const matchField = (val: number, field: string): boolean => {
      if (field === "*") {
        return true;
      }
      if (field.startsWith("*/")) {
        const step = Number(field.slice(2));
        return Number.isFinite(step) && step > 0 && val % step === 0;
      }
      return val === Number(field);
    };

    // Advance minute by minute (up to 24 h worth of candidates)
    for (let i = 0; i < 1440; i++) {
      d.setMinutes(d.getMinutes() + 1);
      if (matchField(d.getMinutes(), mE) && matchField(d.getHours(), hE)) {
        return d;
      }
    }
    return null;
  };

  return tryMinute(after);
}

export class CronPollerService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private jobs: CronJobRecord[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private gatewayClient: GatewayClient;

  constructor(private readonly opts: CronPollerOptions) {
    this.gatewayClient = new GatewayClient({
      url: opts.gatewayUrl ?? "ws://127.0.0.1:18789",
      onEvent: () => {},
      onConnectError: () => {},
    });
  }

  async start(): Promise<void> {
    this.gatewayClient.start();
    await this.fetchAndSchedule();
    // Re-sync every 5 minutes to pick up newly created or deleted jobs.
    this.pollTimer = setInterval(() => void this.fetchAndSchedule(), 5 * 60 * 1000);
  }

  stop(): void {
    this.closed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.gatewayClient.stop();
  }

  private async fetchAndSchedule(): Promise<void> {
    const url = `${normalizeBaseUrl(this.opts.baseUrl)}/api/agent-hosts/${this.opts.agentNodeId}/cron`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logWarn(`[cron-poller] fetch failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as { jobs: CronJobRecord[] };
      this.jobs = (data.jobs ?? []).filter((j) => j.enabled);
      logDebug(`[cron-poller] loaded ${this.jobs.length} enabled job(s)`);
      this.rescheduleAll();
    } catch (err) {
      logWarn(`[cron-poller] fetch error: ${String(err)}`);
    }
  }

  private rescheduleAll(): void {
    // Cancel existing timers — they'll be replaced below.
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    const now = new Date();
    for (const job of this.jobs) {
      const next = nextCronDate(job.schedule, now);
      if (!next) {
        logWarn(`[cron-poller] job "${job.name}" has unparseable schedule: ${job.schedule}`);
        continue;
      }
      const delay = next.getTime() - Date.now();
      logDebug(`[cron-poller] job "${job.name}" next run in ${Math.round(delay / 1000)}s`);
      const timer = setTimeout(() => void this.fireJob(job), delay);
      this.timers.set(job.id, timer);
    }
  }

  private async fireJob(job: CronJobRecord): Promise<void> {
    if (this.closed) {
      return;
    }
    logWarn(`[cron-poller] firing job "${job.name}" (${job.id})`);

    let lastStatus: "success" | "error" = "success";
    try {
      // A per-project-agent schedule runs in that agent's own session and carries
      // its id so the run is attributed to (and can be routed as) that agent.
      const sessionKey = job.projectAgentId != null ? `project-agent-${job.projectAgentId}` : "main";
      const agentLine = job.projectAgentId != null ? `\nProject agent: #${job.projectAgentId}` : "";
      await this.gatewayClient.request("chat.send", {
        sessionKey,
        message: `[Scheduled job: ${job.name}]\n\nRun cron task: ${job.name}${job.taskId != null ? ` (task #${job.taskId})` : ""}${agentLine}`,
        idempotencyKey: `cron-${job.id}-${Date.now()}`,
      });
    } catch (err) {
      logWarn(`[cron-poller] job "${job.name}" dispatch failed: ${String(err)}`);
      lastStatus = "error";
    }

    // Report back to Builderforce
    void this.patchJobStatus(job.id, lastStatus);

    // Schedule next run
    const next = nextCronDate(job.schedule, new Date());
    if (next && !this.closed) {
      const delay = next.getTime() - Date.now();
      const timer = setTimeout(() => void this.fireJob(job), delay);
      this.timers.set(job.id, timer);
    }
  }

  private async patchJobStatus(jobId: string, status: "success" | "error"): Promise<void> {
    const url = `${normalizeBaseUrl(this.opts.baseUrl)}/api/agent-hosts/${this.opts.agentNodeId}/cron/${jobId}`;
    try {
      await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          lastRunAt: new Date().toISOString(),
          lastStatus: status,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logDebug(`[cron-poller] status patch failed for job ${jobId}: ${String(err)}`);
    }
  }
}
