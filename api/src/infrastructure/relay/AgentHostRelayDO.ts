import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
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

/**
 * An in-flight `POST /host-egress` waiting on its `host.egress.response` frame.
 *
 * The relay is otherwise fire-and-forget (`/dispatch` returns as soon as the frame is
 * on the wire), but egress is a REQUEST: the caller is a vendor module that must hand
 * back a real `Response`. So the DO — the only place that holds the socket — keeps the
 * HTTP request open and resolves it when the matching frame comes back.
 */
interface PendingEgress {
  resolve: (frame: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Ceiling on how long a relayed call may hold a DO request open. Above the gateway's
 *  own per-vendor deadline, so the vendor timeout is what a caller normally sees; this
 *  only stops a wedged host leaking pending entries forever. */
const EGRESS_TIMEOUT_MS = 120_000;

/**
 * How often an OPEN upstream socket refreshes `agent_hosts.last_seen_at`.
 *
 * Online-ness is `lastSeenAt` within 15 minutes (domain/agentHost/onlineStatus),
 * but the column was only written on connect and by the host's own periodic
 * heartbeat — so a connected host whose heartbeat poller stalled (or which points
 * at a route that no longer exists) went "offline" in the UI while its socket was
 * still live, and stage dispatch skipped it. The relay is the one component that
 * KNOWS the socket is open, so it is what says so. A third of the staleness
 * window gives two chances to land before the host is judged offline.
 */
const LIVENESS_BEAT_MS = 5 * 60_000;

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
  /** In-flight relayed HTTP calls, keyed by request id. See {@link PendingEgress}. */
  private pendingEgress = new Map<string, PendingEgress>();
  /** Timer refreshing `last_seen_at` while the upstream socket is open. */
  private livenessInterval: ReturnType<typeof setInterval> | null = null;

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

      // Egress: run ONE outbound HTTP call from the connected host's machine and
      // return its response. This is what makes a provider that refuses our cloud
      // egress (Kimi Code's edge 403s the Cloudflare Workers ASN before reading the
      // key) reachable at all — the call is made by the tenant's own runtime, which
      // is the personal interactive client such a subscription is licensed for.
      // Unlike every other route here this one AWAITS a reply, so it correlates.
      if (request.method === "POST" && url.pathname.endsWith("/host-egress")) {
        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return this.json({ ok: false, error: "invalid_json" }, 400);
        }
        return this.relayEgress(payload);
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
      try { this.upstreamSocket.close(1001, "replaced"); } catch (error) { /* ignore */ 
        reportCaughtError(error, { source: "infrastructure/relay/AgentHostRelayDO.ts", operation: "attachUpstream" }, { env: this.env, waitUntil: (task) => this.state.waitUntil(task) });
      }
    }
    this.upstreamSocket = ws;
    this.schedulePings();

    ws.addEventListener("message", (ev) => {
      const data = ev.data as string;
      // Egress replies are answers to a specific in-flight request, not relay traffic:
      // they carry the provider's own response body and must never be broadcast to
      // browser clients. Claimed BEFORE the broadcast for exactly that reason.
      if (this.resolveEgress(data)) return;
      // Broadcast every upstream message to all connected clients
      this.broadcast(data);
      // Persist complete messages (not deltas) to Postgres
      this.handleUpstreamMessage(data);
    });

    ws.addEventListener("close", () => {
      if (this.upstreamSocket === ws) {
        this.upstreamSocket = null;
        this.clearPings();
        // Nothing will ever answer these now — release them instead of making every
        // caller wait out the full egress ceiling.
        this.failPendingEgress();
        // Notify all clients that the agentHost went offline
        this.broadcast(JSON.stringify({ type: "agent_host_offline" }));
      }
    });

    ws.addEventListener("error", (error) => {
      console.error('[agent-host-relay] upstream websocket error; awaiting close event', {
        agentHostId: this.agentHostId,
        error,
      });
    });

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
    } catch (error) { /* ignore non-JSON */ 
      reportCaughtError(error, { source: "infrastructure/relay/AgentHostRelayDO.ts", operation: "handleClientMessage" }, { env: this.env, waitUntil: (task) => this.state.waitUntil(task) });
    }
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

      // --- channel.status — the host's verdict on a channel it brought up ---
      if (msg.type === "channel.status") {
        void this.persistChannelStatus(msg as {
          platform?: string;
          name?: string;
          status?: string;
          error?: string | null;
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
    } catch (error) { /* ignore non-JSON or non-message events */ 
      reportCaughtError(error, { source: "infrastructure/relay/AgentHostRelayDO.ts", operation: "handleUpstreamMessage" }, { env: this.env, waitUntil: (task) => this.state.waitUntil(task) });
    }
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

  /**
   * Call one of this host's API endpoints with its own key. The ONE place the
   * relay talks back to the API: base-URL resolution, the host Bearer, the
   * "no identity yet" guard and best-effort error reporting were copied into five
   * `persist*` methods, so a fix to any of them reached exactly one caller.
   */
  private async callApi(
    suffix: string,
    body: unknown,
    operation: string,
    method: "POST" | "PATCH" = "POST",
  ): Promise<void> {
    if (!this.agentHostId || !this.agentHostApiKey) return;
    // Prefer the SELF_URL binding, fall back to the production API.
    const env = this.env as Partial<{ SELF_URL: string }>;
    const baseUrl = env.SELF_URL ?? "https://api.builderforce.ai";
    try {
      await fetch(`${baseUrl}/api/agent-hosts/${this.agentHostId}${suffix}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.agentHostApiKey}` },
        body: JSON.stringify(body),
      });
    } catch (error) { /* best-effort; do not crash the relay */
      reportCaughtError(error, { source: "infrastructure/relay/AgentHostRelayDO.ts", operation }, { env: this.env, waitUntil: (task) => this.state.waitUntil(task) });
    }
  }

  /** POST a single message to the main API for Postgres persistence. */
  private async persistMessage(msg: BufferedMessage) {
    await this.callApi(
      "/messages",
      { sessionKey: this.currentSessionKey, messages: [msg] },
      "persistMessage",
    );
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
    // Addressed to the SOURCE host, not this one, so it does not go through callApi.
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
    } catch (error) { /* best-effort */ 
      reportCaughtError(error, { source: "infrastructure/relay/AgentHostRelayDO.ts", operation: "persistRemoteResult" }, { env: this.env, waitUntil: (task) => this.state.waitUntil(task) });
    }
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
    await this.callApi("/usage-snapshot", msg, "persistUsageSnapshot");
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
    await this.callApi("/tool-audit", msg, "persistToolAuditEvent");
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
    if (msg.taskId == null || !msg.path) return;
    await this.callApi("/file-change", msg, "persistFileChange");
  }

  /**
   * The host says a channel connected, failed to authenticate, or dropped.
   *
   * Dropped rather than forwarded when it names no channel: the registry matches
   * on `(platform, name)`, so a frame missing either cannot address a row and
   * posting it would be a round-trip that updates nothing.
   */
  private async persistChannelStatus(msg: {
    platform?: string;
    name?: string;
    status?: string;
    error?: string | null;
  }) {
    if (!msg.platform || !msg.name || !msg.status) return;
    await this.callApi("/channel-status", msg, "persistChannelStatus");
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
    await this.callApi("/approval-request", msg, "persistApprovalRequest");
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Send one `host.egress.request` and hold this HTTP request open until the host
   * answers, times out, or disconnects.
   *
   * Returns 409 `agent_host_offline` rather than hanging when nothing is connected —
   * the caller (a vendor module) needs to fall back to direct egress immediately, not
   * to sit on a request that can never be answered.
   */
  private async relayEgress(payload: Record<string, unknown>): Promise<Response> {
    const requestId =
      typeof payload.requestId === "string" && payload.requestId.length > 0
        ? payload.requestId
        : crypto.randomUUID();

    if (this.upstreamSocket?.readyState !== WebSocket.OPEN) {
      return this.json({ ok: false, delivered: false, error: "agent_host_offline" }, 409);
    }

    const frame = await new Promise<Record<string, unknown> | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingEgress.delete(requestId);
        resolve(null);
      }, EGRESS_TIMEOUT_MS);
      this.pendingEgress.set(requestId, {
        resolve: (f) => { clearTimeout(timer); resolve(f); },
        timer,
      });
      if (!this.sendUpstream({ ...payload, type: "host.egress.request", requestId })) {
        clearTimeout(timer);
        this.pendingEgress.delete(requestId);
        resolve(null);
      }
    });

    if (!frame) {
      return this.json({ ok: false, delivered: false, error: "agent_host_timeout" }, 504);
    }
    // A frame carrying an error — a blocked destination, a network failure, or the
    // synthetic one `failPendingEgress` raises on disconnect — is NOT a success with an
    // empty payload. Reporting `ok: true` here would hand the vendor layer a null
    // response to interpret, which is exactly how "the relay broke" gets misread as
    // "the provider answered strangely".
    const error = typeof frame.error === "string" ? frame.error : null;
    if (error || !frame.response) {
      const offline = error === "agent_host_offline";
      return this.json(
        { ok: false, delivered: !offline, error: error ?? "egress_failed" },
        offline ? 409 : 502,
      );
    }
    return this.json({ ok: true, delivered: true, response: frame.response }, 200);
  }

  /** Resolve a waiting {@link relayEgress} call. Returns true when the frame was an
   *  egress reply, so the caller can stop before broadcasting it — a relayed response
   *  carries the provider's payload and has no business reaching browser clients. */
  private resolveEgress(data: string): boolean {
    let msg: { type?: unknown; requestId?: unknown };
    try {
      msg = JSON.parse(data) as { type?: unknown; requestId?: unknown };
    } catch {
      return false;
    }
    if (msg.type !== "host.egress.response") return false;
    const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
    const pending = requestId ? this.pendingEgress.get(requestId) : undefined;
    if (pending) {
      this.pendingEgress.delete(requestId);
      pending.resolve(msg as Record<string, unknown>);
    }
    // Consume the frame either way: a late reply whose waiter already timed out is
    // still not something to broadcast.
    return true;
  }

  /** Fail every waiter at once — a disconnected host will never answer, and leaving
   *  them to time out individually would stall each caller for the full ceiling. */
  private failPendingEgress(): void {
    for (const [, pending] of this.pendingEgress) {
      clearTimeout(pending.timer);
      pending.resolve({ error: "agent_host_offline" });
    }
    this.pendingEgress.clear();
  }

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
    // Report liveness immediately as well, so a host that reconnects is online
    // again at once rather than one beat later.
    void this.beatLiveness();
    this.livenessInterval = setInterval(() => { void this.beatLiveness(); }, LIVENESS_BEAT_MS);
  }

  /** Refresh `last_seen_at` iff the upstream socket is still open. */
  private async beatLiveness(): Promise<void> {
    if (this.upstreamSocket?.readyState !== WebSocket.OPEN) return;
    await this.callApi("/heartbeat", {}, "beatLiveness", "PATCH");
  }

  private clearPings() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.livenessInterval !== null) {
      clearInterval(this.livenessInterval);
      this.livenessInterval = null;
    }
  }
}
