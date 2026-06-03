/**
 * Focused helper classes extracted from BuilderforceRelayService.
 *
 * Each class owns exactly one concern:
 *   RelayHeartbeat       — periodic HTTP heartbeats to keep lastSeenAt fresh
 *   RelayLogPoller       — poll local gateway logs and forward to browser clients
 *   RelayPresencePoller  — poll session presence and forward snapshots
 */

import type { GatewayClient } from "../gateway/client.js";
import { logDebug } from "../logger.js";
import { buildLocalMachineProfile } from "./builderforce-context.js";

// ── RelayHeartbeat ────────────────────────────────────────────────────────────

export type HeartbeatOptions = {
  heartbeatUrl: string;
  apiKey: string;
  workspaceDir?: string;
};

/**
 * Sends a periodic HTTP PATCH heartbeat to keep `lastSeenAt` fresh in the
 * Builderforce database between WebSocket reconnects.
 */
export class RelayHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: HeartbeatOptions) {}

  /** Send immediately and schedule a 5-minute repeat. */
  schedule(): void {
    this.clear();
    void this.sendOnce();
    this.timer = setInterval(() => void this.sendOnce(), 5 * 60 * 1000);
  }

  clear(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sendOnce(): Promise<void> {
    try {
      const machineProfile = buildLocalMachineProfile({
        workspaceDirectory: this.opts.workspaceDir,
        rootInstallDirectory: process.cwd(),
        gatewayPort: 18789,
        tunnelUrl: process.env.BUILDERFORCE_AGENTS_PUBLIC_TUNNEL_URL,
        tunnelStatus: process.env.BUILDERFORCE_AGENTS_PUBLIC_TUNNEL_URL ? "connected" : "none",
      });
      await fetch(this.opts.heartbeatUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          capabilities: ["chat", "tasks", "relay", "remote-dispatch"],
          machineProfile,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logDebug(`[builderforce-relay] heartbeat failed: ${String(err)}`);
    }
  }
}

// ── RelayLogPoller ─────────────────────────────────────────────────────────────

/**
 * Polls the local gateway for log lines every 2 seconds and forwards them to
 * browser clients via the upstream relay WebSocket.
 */
export class RelayLogPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor: number | undefined;

  constructor(
    private readonly getClient: () => GatewayClient | null,
    private readonly send: (msg: unknown) => void,
  ) {}

  /** Start polling. Pass `resetCursor=true` to replay from the beginning. */
  start(resetCursor = false): void {
    if (resetCursor) {
      this.cursor = undefined;
    }
    if (this.timer !== null) {
      return;
    }
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), 2_000);
  }

  clear(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private mapLine(line: string): { ts: string; level: string; message: string } {
    const fallback = { ts: new Date().toISOString(), level: "info", message: line };
    try {
      const parsed = JSON.parse(line) as {
        time?: string;
        _meta?: { logLevelName?: string };
        1?: unknown;
        message?: unknown;
        0?: unknown;
      };
      const level =
        typeof parsed?._meta?.logLevelName === "string"
          ? parsed._meta.logLevelName.toLowerCase()
          : "info";
      const message =
        typeof parsed?.[1] === "string"
          ? parsed[1]
          : typeof parsed?.message === "string"
            ? parsed.message
            : typeof parsed?.[0] === "string"
              ? parsed[0]
              : line;
      return {
        ts: typeof parsed?.time === "string" ? parsed.time : fallback.ts,
        level,
        message,
      };
    } catch {
      return fallback;
    }
  }

  private async pollOnce(): Promise<void> {
    const client = this.getClient();
    if (!client) {
      return;
    }
    try {
      const res = await client.request("logs.tail", {
        cursor: this.cursor,
        limit: 500,
        maxBytes: 250_000,
      });

      if (typeof res.cursor === "number" && Number.isFinite(res.cursor)) {
        this.cursor = res.cursor;
      }
      const lines = Array.isArray(res.lines)
        ? res.lines.filter((line): line is string => typeof line === "string")
        : [];
      for (const line of lines) {
        const mapped = this.mapLine(line);
        this.send({
          type: "log",
          level: mapped.level,
          message: mapped.message,
          ts: mapped.ts,
        });
      }
    } catch (err) {
      logDebug(`[builderforce-relay] logs.tail failed: ${String(err)}`);
    }
  }
}

// ── RelayPresencePoller ────────────────────────────────────────────────────────

/**
 * Polls the local gateway for session presence every 5 seconds and forwards
 * snapshots to browser clients via the upstream relay WebSocket.
 */
export class RelayPresencePoller {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly getClient: () => GatewayClient | null,
    private readonly send: (msg: unknown) => void,
  ) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), 5_000);
  }

  clear(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    const client = this.getClient();
    if (!client) {
      return;
    }
    try {
      const res = await client.request("system-presence", {});
      const entries = Array.isArray(res) ? res : [];
      this.send({ type: "presence.snapshot", entries });
    } catch (err) {
      logDebug(`[builderforce-relay] system-presence failed: ${String(err)}`);
    }
  }
}
