/**
 * AgentHostRelayDO — Cloudflare Durable Object that acts as a WebSocket relay
 * between a BuilderForce Agents instance (upstream) and one or more browser clients.
 *
 * One DO instance per registered agentHost (keyed by agentHost id).
 *
 * Lifecycle:
 *   1. BuilderForce Agents connects to /api/agent-hosts/:id/upstream (agentHost API key auth)
 *      → stored as upstreamSocket
 *   2. Browser clients connect to /api/agent-hosts/:id/ws (tenant JWT auth)
 *      → added to clientSockets set
 *   3. Messages from BuilderForce Agents → broadcast to all clientSockets
 *   4. Messages from any client → forwarded to upstreamSocket
 *   5. When BuilderForce Agents disconnects → send { type:"agent_host_offline" } to clients
 *
 * Chat persistence:
 *   - Complete chat.message events are buffered in-memory (last 100 per session)
 *   - Each complete message is asynchronously persisted to Postgres via the
 *     main API endpoint (fire-and-forget, best-effort)
 *   - New browser clients receive the in-memory history replay immediately
 *
 * Remote task result streaming (P0-1):
 *   - When a target agentHost completes a remote.task it sends a remote.result frame
 *   - The DO forwards this to all connected clients AND to the originating agentHost
 *     via /api/agent-hosts/:sourceAgentHostId/relay-result (fire-and-forget)
 *
 * Observability frames (P2-2, P2-4):
 *   - usage.snapshot frames are forwarded to the API for persistence
 *   - tool.audit frames are forwarded to the API for persistence
 */

import { buildExecutionMessageFrame, buildExecutionCancelFrame } from './executionMessage';

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

export class AgentHostRelayDO implements DurableObject {
  // Required brand for DurableObjectNamespace<T> generic constraint
  declare readonly "__DURABLE_OBJECT_BRAND": never;

  private upstreamSocket: WebSocket | null = null;
  private clientSockets: Set<WebSocket> = new Set();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // --- Chat persistence state (in-memory, lives as long as DO is alive) ---
  private agentHostId: number | null = null;
  private agentHostApiKey: string | null = null;
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
          return this.json({ ok: false, error: "invalid_json" }, 400);
        }
        if (!this.sendUpstream(payload)) {
          return this.json({ ok: false, delivered: false, error: "agent_host_offline" }, 409);
        }
        return this.json({ ok: true, delivered: true }, 200);
      }

      // Steering: forward a user follow-up to a running execution as the next
      // turn for the live agent session. Mirrors /dispatch but wraps the body in
      // an `execution.message` frame and echoes it to browser clients.
      if (request.method === "POST" && url.pathname.endsWith("/execution-message")) {
        let payload: unknown = null;
        try {
          payload = await request.json();
        } catch {
          return this.json({ ok: false, error: "invalid_json" }, 400);
        }
        const built = buildExecutionMessageFrame(payload);
        if (!built.ok) {
          return this.json({ ok: false, error: built.error }, 400);
        }
        if (!this.sendUpstream(built.frame)) {
          return this.json({ ok: false, delivered: false, error: "agent_host_offline" }, 409);
        }
        // Echo to browser clients so the chat thread shows the steering message.
        this.broadcast(JSON.stringify({ type: "chat.message", role: "user", text: built.frame.text, ephemeral: true }));
        return this.json({ ok: true, delivered: true }, 200);
      }

      // Cancel: forward an `execution.cancel` frame upstream so the host aborts
      // the in-flight run. Mirrors /execution-message.
      if (request.method === "POST" && url.pathname.endsWith("/execution-cancel")) {
        let payload: unknown = null;
        try {
          payload = await request.json();
        } catch {
          return this.json({ ok: false, error: "invalid_json" }, 400);
        }
        const frame = buildExecutionCancelFrame(payload);
        if (!this.sendUpstream(frame)) {
          return this.json({ ok: false, delivered: false, error: "agent_host_offline" }, 409);
        }
        return this.json({ ok: true, delivered: true }, 200);
      }

      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    if (role === "upstream") {
      this.extractAgentHostMeta(url, request);
      this.attachUpstream(server);
    } else {
      this.attachClient(server);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------------------
  // Upstream (BuilderForce Agents instance)
  // ---------------------------------------------------------------------------

  /**
   * Extract agentHost ID and API key from the upstream connect request.
   * Prefers the Authorization: Bearer header (secure); falls back to ?key=
   * query param for backward compat with older BuilderForce Agents versions.
   */
  private extractAgentHostMeta(url: URL, request?: Request) {
    const match = url.pathname.match(/\/api\/agentHosts\/(\d+)\//);
    if (match) this.agentHostId = Number(match[1]);
    const headerKey = request?.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    const key = headerKey ?? url.searchParams.get("key");
    if (key) this.agentHostApiKey = key;
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
        // Notify all clients that the agentHost went offline
        this.broadcast(JSON.stringify({ type: "agent_host_offline" }));
      }
    });

    ws.addEventListener("error", () => { /* close follows */ });

    // Tell the agentHost it is connected
    ws.send(JSON.stringify({ type: "relay_connected" }));

    // Notify any waiting clients that the agentHost is now online
    this.broadcast(JSON.stringify({ type: "agent_host_online" }));
  }

  // ---------------------------------------------------------------------------
  // Clients (browser sessions)
  // ---------------------------------------------------------------------------

  private attachClient(ws: WebSocket) {
    this.clientSockets.add(ws);

    // Immediately tell the client whether the agentHost is connected
    if (this.upstreamSocket === null) {
      ws.send(JSON.stringify({ type: "agent_host_offline" }));
    } else {
      ws.send(JSON.stringify({ type: "agent_host_online" }));
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
      // Forward client messages to the upstream agentHost
      if (this.upstreamSocket?.readyState === WebSocket.OPEN) {
        this.upstreamSocket.send(data);
      } else {
        ws.send(JSON.stringify({ type: "agent_host_offline" }));
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
        fromAgentHostId?: string | number;
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

      // --- P0-1: remote.result — forward result back to source agentHost ---
      if (msg.type === "remote.result") {
        void this.persistRemoteResult(msg as {
          taskCorrelationId?: string;
          fromAgentHostId?: string | number;
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

      // --- file.change — persist per-agent file-change traceability ---
      if (msg.type === "file.change") {
        void this.persistFileChange(msg as {
          taskId?: number;
          executionId?: number;
          path?: string;
          change?: string;
          agent?: string;
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
    if (!this.agentHostId || !this.agentHostApiKey) return;

    // Determine the base URL: prefer SELF_URL binding, fall back to production URL
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    try {
      await fetch(
        `${baseUrl}/api/agent-hosts/${this.agentHostId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.agentHostApiKey}` },
          body: JSON.stringify({
            sessionKey: this.currentSessionKey,
            messages: [msg],
          }),
        },
      );
    } catch { /* best-effort; do not crash the relay */ }
  }

  // ---------------------------------------------------------------------------
  // P0-1: remote.result persistence — forward result back to source agentHost relay
  // ---------------------------------------------------------------------------

  private async persistRemoteResult(msg: {
    taskCorrelationId?: string;
    fromAgentHostId?: string | number;
    result?: string;
    status?: string;
    error?: string;
  }) {
    if (!this.agentHostId || !this.agentHostApiKey) return;
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    const fromId = msg.fromAgentHostId ? String(msg.fromAgentHostId) : null;
    if (!fromId) return;

    // Forward the remote.result frame to the source agentHost's relay so its
    // AgentHostLinkRelayService can resolve the pending dispatchToRemoteAgentHost() call.
    try {
      await fetch(
        `${baseUrl}/api/agent-hosts/${fromId}/relay-result`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.agentHostApiKey}` },
          body: JSON.stringify({
            type: "remote.result",
            taskCorrelationId: msg.taskCorrelationId,
            fromAgentHostId: this.agentHostId,
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
    if (!this.agentHostId || !this.agentHostApiKey) return;
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    try {
      await fetch(
        `${baseUrl}/api/agent-hosts/${this.agentHostId}/usage-snapshot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.agentHostApiKey}` },
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
    if (!this.agentHostId || !this.agentHostApiKey) return;
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    try {
      await fetch(
        `${baseUrl}/api/agent-hosts/${this.agentHostId}/tool-audit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.agentHostApiKey}` },
          body: JSON.stringify(msg),
        },
      );
    } catch { /* best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // file.change persistence — per-agent traceability for the ticket workspace
  // ---------------------------------------------------------------------------

  private async persistFileChange(msg: {
    taskId?: number;
    executionId?: number;
    path?: string;
    change?: string;
    agent?: string;
    ts?: string;
  }) {
    if (!this.agentHostId || !this.agentHostApiKey) return;
    if (msg.taskId == null || !msg.path) return;
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    try {
      await fetch(
        `${baseUrl}/api/agent-hosts/${this.agentHostId}/file-change`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.agentHostApiKey}` },
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
    if (!this.agentHostId || !this.agentHostApiKey) return;
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";

    try {
      await fetch(
        `${baseUrl}/api/agent-hosts/${this.agentHostId}/approval-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.agentHostApiKey}` },
          body: JSON.stringify(msg),
        },
      );
    } catch { /* best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Send a JSON-serializable frame to the connected agent host. Returns false
   *  (without throwing) when no agent host is online. */
  private sendUpstream(frame: unknown): boolean {
    if (this.upstreamSocket?.readyState !== WebSocket.OPEN) return false;
    this.upstreamSocket.send(JSON.stringify(frame));
    return true;
  }

  private json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

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
