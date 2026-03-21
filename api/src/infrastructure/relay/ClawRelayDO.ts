/**
 * ClawRelayDO — Cloudflare Durable Object that acts as a WebSocket relay
 * between a CoderClaw instance (upstream) and one or more browser clients.
 *
 * One DO instance per registered claw (keyed by claw id).
 *
 * Lifecycle:
 *   1. CoderClaw connects to /api/claws/:id/upstream (claw API key auth)
 *      → stored as upstreamSocket
 *   2. Browser clients connect to /api/claws/:id/ws (tenant JWT auth)
 *      → added to clientSockets set
 *   3. Messages from CoderClaw → broadcast to all clientSockets
 *   4. Messages from any client → forwarded to upstreamSocket
 *   5. When CoderClaw disconnects → send { type:"claw_offline" } to clients
 *
 * Chat persistence:
 *   - Complete chat.message events are buffered in-memory (last 100 per session)
 *   - Each complete message is asynchronously persisted to Postgres via the
 *     main API endpoint (fire-and-forget, best-effort)
 *   - New browser clients receive the in-memory history replay immediately
 *
 * Remote task result streaming (P0-1):
 *   - When a target claw completes a remote.task it sends a remote.result frame
 *   - The DO forwards this to all connected clients AND to the originating claw
 *     via /api/claws/:sourceClawId/relay-result (fire-and-forget)
 *
 * Observability frames (P2-2, P2-4):
 *   - usage.snapshot frames are forwarded to the API for persistence
 *   - tool.audit frames are forwarded to the API for persistence
 */

interface BufferedMessage {
  role: string;
  content: string;
  metadata?: string;
  seq: number;
}

interface BufferedLog {
  ts: string;
  level: string;
  message: string;
}

export class ClawRelayDO implements DurableObject {
  // Required brand for DurableObjectNamespace<T> generic constraint
  declare readonly "__DURABLE_OBJECT_BRAND": never;

  private upstreamSocket: WebSocket | null = null;
  private clientSockets: Set<WebSocket> = new Set();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // --- Chat persistence state (in-memory, lives as long as DO is alive) ---
  private clawId: number | null = null;
  private clawApiKey: string | null = null;
  private currentSessionKey = "default";
  private msgSeq = 0;
  /** Circular buffer of last 100 messages for history replay on reconnect */
  private msgBuffer: BufferedMessage[] = [];
  private readonly MSG_BUFFER_MAX = 100;
  /** Circular buffer of last 200 log lines for replay in Logs tab */
  private logBuffer: BufferedLog[] = [];
  private readonly LOG_BUFFER_MAX = 200;

  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role"); // "upstream" | "client"

    if (request.headers.get("Upgrade") !== "websocket") {
      if (request.method === "POST" && url.pathname.endsWith("/dispatch")) {
        let payload: unknown = null;
        try {
          payload = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (this.upstreamSocket?.readyState !== WebSocket.OPEN) {
          return new Response(JSON.stringify({ ok: false, delivered: false, error: "claw_offline" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          });
        }

        this.upstreamSocket.send(JSON.stringify(payload));
        return new Response(JSON.stringify({ ok: true, delivered: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    if (role === "upstream") {
      this.extractClawMeta(url, request);
      this.attachUpstream(server);
    } else {
      this.attachClient(server);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------------------
  // Upstream (CoderClaw instance)
  // ---------------------------------------------------------------------------

  /**
   * Extract claw ID and API key from the upstream connect request.
   * Prefers the Authorization: Bearer header (secure); falls back to ?key=
   * query param for backward compat with older CoderClaw versions.
   */
  private extractClawMeta(url: URL, request?: Request) {
    const match = url.pathname.match(/\/api\/claws\/(\d+)\//);
    if (match) this.clawId = Number(match[1]);
    const headerKey = request?.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    const key = headerKey ?? url.searchParams.get("key");
    if (key) this.clawApiKey = key;
  }

  private attachUpstream(ws: WebSocket) {
    // Close any existing upstream connection
    if (this.upstreamSocket) {
      try { this.upstreamSocket.close(1001, "replaced"); } catch { /* ignore */ }
    }
    this.upstreamSocket = ws;
    this.schedulePings();

    ws.addEventListener("message", (ev) => {
      const data = ev.data as string;
      // Broadcast every upstream message to all connected clients
      this.broadcast(data);
      // Persist complete messages (not deltas) to Postgres
      this.handleUpstreamMessage(data);
    });

    ws.addEventListener("close", () => {
      if (this.upstreamSocket === ws) {
        this.upstreamSocket = null;
        this.clearPings();
        // Notify all clients that the claw went offline
        this.broadcast(JSON.stringify({ type: "claw_offline" }));
      }
    });

    ws.addEventListener("error", () => { /* close follows */ });

    // Tell the claw it is connected
    ws.send(JSON.stringify({ type: "relay_connected" }));

    // Notify any waiting clients that the claw is now online
    this.broadcast(JSON.stringify({ type: "claw_online" }));
  }

  // ---------------------------------------------------------------------------
  // Clients (browser sessions)
  // ---------------------------------------------------------------------------

  private attachClient(ws: WebSocket) {
    this.clientSockets.add(ws);

    // Immediately tell the client whether the claw is connected
    if (this.upstreamSocket === null) {
      ws.send(JSON.stringify({ type: "claw_offline" }));
    } else {
      ws.send(JSON.stringify({ type: "claw_online" }));
    }

    // Replay buffered history so the browser sees recent messages immediately
    if (this.msgBuffer.length > 0) {
      ws.send(JSON.stringify({ type: "chat.history", messages: this.msgBuffer }));
    }
    if (this.logBuffer.length > 0) {
      for (const entry of this.logBuffer) {
        ws.send(JSON.stringify({ type: "log", level: entry.level, message: entry.message, ts: entry.ts }));
      }
    }

    ws.addEventListener("message", (ev) => {
      const data = ev.data as string;
      // Track session and mirror outgoing user chat across all browser clients
      this.handleClientMessage(data);
      // Forward client messages to the upstream claw
      if (this.upstreamSocket?.readyState === WebSocket.OPEN) {
        this.upstreamSocket.send(data);
      } else {
        ws.send(JSON.stringify({ type: "claw_offline" }));
      }
    });

    ws.addEventListener("close", () => {
      this.clientSockets.delete(ws);
    });

    ws.addEventListener("error", () => { /* close follows */ });
  }

  // ---------------------------------------------------------------------------
  // Chat message handling
  // ---------------------------------------------------------------------------

  /** Track session key from outgoing client messages. */
  private handleClientMessage(data: string) {
    try {
      const msg = JSON.parse(data) as { type?: string; session?: string; message?: string };
      if (msg.type === "session.new") {
        // New session — reset buffer and seq but keep tracking
        this.msgBuffer = [];
        this.msgSeq = 0;
      }
      if (msg.session) {
        this.currentSessionKey = msg.session;
      }

      if (msg.type === "chat" && typeof msg.message === "string" && msg.message.trim().length > 0) {
        const session = (msg.session && msg.session.trim().length > 0) ? msg.session.trim() : this.currentSessionKey;
        // Mirror outgoing user message to all connected browser clients immediately
        this.broadcast(
          JSON.stringify({
            type: "chat.message",
            role: "user",
            text: msg.message,
            session,
            ephemeral: true,
          }),
        );

        // Emit a lightweight log line so Logs tab reflects chat activity
        this.emitLog("info", `[chat] user: ${msg.message}`);

        // Persist outgoing user message even if upstream doesn't echo it back
        this.currentSessionKey = session;
        this.appendAndPersistMessage({ role: "user", content: msg.message });
      }
    } catch { /* ignore non-JSON */ }
  }

  /** Persist complete chat messages from upstream. Deltas are skipped. */
  private handleUpstreamMessage(data: string) {
    try {
      const msg = JSON.parse(data) as {
        type?: string;
        role?: string;
        text?: string;
        session?: string;
        // remote.result fields
        taskCorrelationId?: string;
        fromClawId?: string | number;
        result?: string;
        status?: string;
        error?: string;
        // usage.snapshot fields
        sessionKey?: string;
        inputTokens?: number;
        outputTokens?: number;
        contextTokens?: number;
        contextWindowMax?: number;
        compactionCount?: number;
        ts?: string;
        // tool.audit fields
        runId?: string;
        toolCallId?: string;
        toolName?: string;
        args?: unknown;
        durationMs?: number;
        // workflow.update fields
        workflowId?: string;
        taskId?: string;
        // approval.request fields
        actionType?: string;
        description?: string;
        metadata?: unknown;
        expiresAt?: string;
        requestedBy?: string;
      };
      if (typeof msg.session === "string" && msg.session.trim().length > 0) {
        this.currentSessionKey = msg.session.trim();
      }

      // --- P0-1: remote.result — forward result back to source claw ---
      if (msg.type === "remote.result") {
        void this.persistRemoteResult(msg as {
          taskCorrelationId?: string;
          fromClawId?: string | number;
          result?: string;
          status?: string;
          error?: string;
        });
        return;
      }

      // --- P2-2: usage.snapshot — persist token telemetry ---
      if (msg.type === "usage.snapshot") {
        void this.persistUsageSnapshot(msg as {
          sessionKey?: string;
          inputTokens?: number;
          outputTokens?: number;
          contextTokens?: number;
          contextWindowMax?: number;
          compactionCount?: number;
          ts?: string;
        });
        return;
      }

      // --- P2-4: tool.audit — persist tool call record ---
      if (msg.type === "tool.audit") {
        void this.persistToolAuditEvent(msg as {
          runId?: string;
          sessionKey?: string;
          toolCallId?: string;
          toolName?: string;
          category?: string;
          args?: unknown;
          result?: string;
          durationMs?: number;
          ts?: string;
        });
        return;
      }

      // --- P3-3: approval.request — persist approval and notify clients ---
      if (msg.type === "approval.request") {
        void this.persistApprovalRequest(msg as {
          actionType?: string;
          description?: string;
          metadata?: unknown;
          expiresAt?: string;
          requestedBy?: string;
        });
        return;
      }

      if (msg.type !== "chat.message" || !msg.role || typeof msg.text !== "string") return;

      // Emit a lightweight log line so Logs tab reflects chat activity
      this.emitLog("info", `[chat] ${msg.role}: ${msg.text}`);

      this.appendAndPersistMessage({ role: msg.role, content: msg.text });
    } catch { /* ignore non-JSON or non-message events */ }
  }

  /** Add to in-memory history and persist asynchronously. */
  private appendAndPersistMessage(msg: { role: string; content: string }) {
    this.msgSeq++;
    const buffered: BufferedMessage = {
      role: msg.role,
      content: msg.content,
      seq: this.msgSeq,
    };

    this.msgBuffer.push(buffered);
    if (this.msgBuffer.length > this.MSG_BUFFER_MAX) {
      this.msgBuffer.shift();
    }

    void this.persistMessage(buffered);
  }

  private emitLog(level: string, message: string) {
    const entry: BufferedLog = {
      ts: new Date().toISOString(),
      level,
      message,
    };

    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.LOG_BUFFER_MAX) {
      this.logBuffer.shift();
    }

    this.broadcast(JSON.stringify({ type: "log", level: entry.level, message: entry.message, ts: entry.ts }));
  }

  /** POST a single message to the main API for Postgres persistence. */
  private async persistMessage(msg: BufferedMessage) {
    if (!this.clawId || !this.clawApiKey) return;

    // Determine the base URL: prefer SELF_URL binding, fall back to production URL
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    try {
      await fetch(
        `${baseUrl}/api/claws/${this.clawId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.clawApiKey}` },
          body: JSON.stringify({
            sessionKey: this.currentSessionKey,
            messages: [msg],
          }),
        },
      );
    } catch { /* best-effort; do not crash the relay */ }
  }

  // ---------------------------------------------------------------------------
  // P0-1: remote.result persistence — forward result back to source claw relay
  // ---------------------------------------------------------------------------

  private async persistRemoteResult(msg: {
    taskCorrelationId?: string;
    fromClawId?: string | number;
    result?: string;
    status?: string;
    error?: string;
  }) {
    if (!this.clawId || !this.clawApiKey) return;
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    const fromId = msg.fromClawId ? String(msg.fromClawId) : null;
    if (!fromId) return;

    // Forward the remote.result frame to the source claw's relay so its
    // ClawLinkRelayService can resolve the pending dispatchToRemoteClaw() call.
    try {
      await fetch(
        `${baseUrl}/api/claws/${fromId}/relay-result`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.clawApiKey}` },
          body: JSON.stringify({
            type: "remote.result",
            taskCorrelationId: msg.taskCorrelationId,
            fromClawId: this.clawId,
            result: msg.result,
            status: msg.status,
            error: msg.error,
          }),
        },
      );
    } catch { /* best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // P2-2: usage.snapshot persistence
  // ---------------------------------------------------------------------------

  private async persistUsageSnapshot(msg: {
    sessionKey?: string;
    inputTokens?: number;
    outputTokens?: number;
    contextTokens?: number;
    contextWindowMax?: number;
    compactionCount?: number;
    ts?: string;
  }) {
    if (!this.clawId || !this.clawApiKey) return;
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    try {
      await fetch(
        `${baseUrl}/api/claws/${this.clawId}/usage-snapshot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.clawApiKey}` },
          body: JSON.stringify(msg),
        },
      );
    } catch { /* best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // P2-4: tool.audit event persistence
  // ---------------------------------------------------------------------------

  private async persistToolAuditEvent(msg: {
    runId?: string;
    sessionKey?: string;
    toolCallId?: string;
    toolName?: string;
    category?: string;
    args?: unknown;
    result?: string;
    durationMs?: number;
    ts?: string;
  }) {
    if (!this.clawId || !this.clawApiKey) return;
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    try {
      await fetch(
        `${baseUrl}/api/claws/${this.clawId}/tool-audit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.clawApiKey}` },
          body: JSON.stringify(msg),
        },
      );
    } catch { /* best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // P3-3: approval.request persistence
  // ---------------------------------------------------------------------------

  private async persistApprovalRequest(msg: {
    actionType?: string;
    description?: string;
    metadata?: unknown;
    expiresAt?: string;
    requestedBy?: string;
  }) {
    if (!this.clawId || !this.clawApiKey) return;
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    try {
      await fetch(
        `${baseUrl}/api/claws/${this.clawId}/approval-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.clawApiKey}` },
          body: JSON.stringify(msg),
        },
      );
    } catch { /* best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private broadcast(data: string) {
    const dead: WebSocket[] = [];
    for (const ws of this.clientSockets) {
      try {
        ws.send(data);
      } catch {
        dead.push(ws);
      }
    }
    for (const ws of dead) this.clientSockets.delete(ws);
  }

  private schedulePings() {
    this.clearPings();
    this.pingInterval = setInterval(() => {
      if (this.upstreamSocket?.readyState === WebSocket.OPEN) {
        this.upstreamSocket.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);
  }

  private clearPings() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
