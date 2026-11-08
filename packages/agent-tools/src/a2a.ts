/**
 * A2A — Agent-to-Agent messaging transport.
 *
 * A small, dependency-free client + server for exchanging messages between
 * autonomous agents over HTTP, modelled on Google's A2A protocol and on the
 * streaming JSON surface that Claude Code's Agent SDK (`claude` CLI) exposes
 * via `--output-format stream-json --input-format stream-json`.
 *
 * The wire contract is deliberately simple so ANY agent runtime can
 * participate — an "A2A" is anything that can POST JSON and read a JSON or
 * SSE stream.
 *
 * Wire contract
 * -------------
 * POST { endpoint }
 *   body: {
 *     message: { role, parts: [{ type:"text", text }], ... },
 *     messageId?, sessionId?, metadata?         // task/skill routing is carried here
 *   }
 *   headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" }
 *
 * Response — one of:
 *   A) application/json   { message: {...}, status: "completed", ... }        // one-shot
 *   B) text/event-stream  SSE "message" events, terminal { type:"result", ... } // streaming
 *
 * This module ships zero runtime dependencies so it can be vendored into any
 * agent host. See `extensions/a2a` for the BuilderForceAgents
 * plugin built on top of it.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single content part inside a message. */
export type A2APart = {
  type: "text" | "data" | "file";
  text?: string;
  data?: unknown;
  mimeType?: string;
  fileId?: string;
};

/** A message exchanged between agents. */
export type A2AMessage = {
  role: "user" | "agent" | "system";
  parts: A2APart[];
  messageId?: string;
  taskId?: string;
  /** Arbitrary envelope for routing (skill, reply-channel, session, origin). */
  metadata?: Record<string, unknown>;
};

/** The body of an outgoing request. */
export type A2ASendParams = {
  message: A2AMessage;
  /** Stable correlation id; echoed back so a caller can match replies. */
  messageId?: string;
  /** Resume / continue an existing agent conversation. */
  sessionId?: string;
  /** Provider-specific routing (e.g. Claude Code skill name, reply channel). */
  skill?: string;
  metadata?: Record<string, unknown>;
};

/** A streamed event from a remote agent. */
export type A2AStreamEvent = {
  type: string;
  [key: string]: unknown;
};

/** What a handler returns — either a terminal reply or a stream of events. */
export type A2AHandlerResult =
  | { kind: "reply"; message: A2AMessage; status?: string; sessionId?: string }
  | { kind: "stream"; stream: AsyncIterable<A2AStreamEvent>; sessionId?: string };

/** The request a server-side handler receives (already parsed + bounded). */
export type A2ARequest = {
  message: A2AMessage;
  messageId?: string;
  sessionId?: string;
  skill?: string;
  metadata?: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type A2AHandler = (req: A2ARequest) => Promise<A2AHandlerResult> | A2AHandlerResult;

export type A2AClientOptions = {
  /** Request timeout in ms (default 120_000 — agents can be slow). */
  timeoutMs?: number;
  /** Optional bearer / api-key token. */
  token?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
};

export type A2ASendResult = {
  /** Terminal status reported by the remote agent ("completed" | "error" | ...). */
  status: string;
  sessionId?: string;
  /** The terminal reply message, when the remote returned one. */
  message?: A2AMessage;
  /** Full set of streamed events (empty for one-shot replies). */
  events: A2AStreamEvent[];
  /** True when the remote spoke SSE rather than returning one JSON body. */
  streamed: boolean;
};

export type A2AServerOptions = {
  /** Path the endpoint answers on (default "/a2a"). */
  path?: string;
  /** Maximum request body bytes (default 1 MiB). */
  maxBodyBytes?: number;
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const TERMINAL_RESULT_TYPES = new Set(["result", "error", "completed", "canceled"]);

function isTerminalEvent(ev: A2AStreamEvent): boolean {
  return TERMINAL_RESULT_TYPES.has(ev.type);
}

function messageToText(message: A2AMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

/**
 * Parse an SSE byte stream into discrete events, honouring `data:` frames and
 * the `event:` name. Resolves with the parsed events plus whether a terminal
 * `result` event was seen.
 */
async function parseSseEvents(
  body: AsyncIterable<Uint8Array>,
): Promise<{ events: A2AStreamEvent[]; sawTerminal: boolean }> {
  const events: A2AStreamEvent[] = [];
  let sawTerminal = false;
  let buffer = "";
  let eventName: string | undefined;

  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    // SSE frames are separated by a blank line.
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLines: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim() || undefined;
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).replace(/^ /, ""));
        }
      }
      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n");
      let parsed: A2AStreamEvent;
      try {
        parsed = JSON.parse(data) as A2AStreamEvent;
      } catch {
        parsed = { type: eventName ?? "message", data };
      }
      if (eventName && parsed.type === undefined) parsed.type = eventName;
      events.push(parsed);
      if (isTerminalEvent(parsed)) sawTerminal = true;
    }
  }
  return { events, sawTerminal };
}

/**
 * Send a message to a remote agent at `endpoint` and collect its reply.
 *
 * Works against any A2A-compatible endpoint:
 *  - a plain `application/json` one-shot responder, or
 *  - an SSE streaming responder (e.g. Claude Code `--output-format stream-json`).
 *
 * When `onEvent` is provided, each streamed event is delivered as it arrives.
 */
export async function sendMessage(
  endpoint: string,
  params: A2ASendParams,
  options: A2AClientOptions = {},
  onEvent?: (ev: A2AStreamEvent) => void,
): Promise<A2ASendResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`a2a request timed out after ${timeoutMs}ms`)), timeoutMs);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(options.headers ?? {}),
  };
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;

  const body: Record<string, unknown> = {
    message: params.message,
    ...(params.messageId ? { messageId: params.messageId } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.skill ? { skill: params.skill } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`a2a request failed: ${res.status} ${res.statusText} ${text}`.trim());
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

    // --- One-shot JSON responder -----------------------------------------
    if (contentType.includes("application/json")) {
      const json = (await res.json()) as Record<string, unknown>;
      const message = json.message as A2AMessage | undefined;
      const status = (json.status as string | undefined) ?? "completed";
      if (message) onEvent?.({ type: "message", message, status });
      return {
        status,
        sessionId: json.sessionId as string | undefined,
        message,
        events: message ? [{ type: "message", message, status }] : [],
        streamed: false,
      };
    }

    // --- SSE streaming responder ------------------------------------------
    if (contentType.includes("text/event-stream")) {
      if (!res.body) throw new Error("a2a: streaming response had no body");
      const { events, sawTerminal } = await parseSseEvents(res.body as unknown as AsyncIterable<Uint8Array>);
      for (const ev of events) onEvent?.(ev);

      // Terminal `result` event carries the final payload (Claude Code shape).
      const result = events.find((e) => e.type === "result") ?? events.find(isTerminalEvent);
      const resultMsg =
        (result?.message as A2AMessage | undefined) ??
        (result?.result as A2AMessage | undefined);
      const textFallback = typeof result?.result === "string" ? result.result : "";
      const message: A2AMessage | undefined = resultMsg
        ? resultMsg
        : textFallback
          ? { role: "agent", parts: [{ type: "text", text: textFallback }] }
          : events
              .filter((e) => e.type === "message" && e.message)
              .map((e) => e.message as A2AMessage)
              .pop();

      let status = "completed";
      if (result?.status === "error" || result?.is_error === true) status = "error";
      else if (result && typeof result.subtype === "string" && result.subtype.startsWith("error")) status = "error";

      return {
        status: sawTerminal ? status : "completed",
        sessionId:
          (result?.session_id as string | undefined) ??
          (events.find((e) => typeof e.session_id === "string")?.session_id as string | undefined),
        message,
        events,
        streamed: true,
      };
    }

    // --- Fallback: opaque body -------------------------------------------
    const text = await res.text();
    return {
      status: "completed",
      message: { role: "agent", parts: [{ type: "text", text }] },
      events: [],
      streamed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** Minimal request/response surface so this works on node:http and CF Workers. */
type IncomingLike = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

function readBodyBytes(
  req: { on?: Function; headers?: Record<string, string | string[] | undefined> },
  limit: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    if (typeof req.on !== "function") {
      // No streaming body (e.g. already-consumed) — treat as empty.
      resolve(Buffer.alloc(0));
      return;
    }
    req.on("data", (c: Buffer | string) => {
      const buf = typeof c === "string" ? Buffer.from(c) : c;
      size += buf.length;
      if (size > limit) {
        reject(new Error(`a2a: request body exceeds ${limit} bytes`));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: { writeHead?: Function; end: Function }, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  if (typeof res.writeHead === "function") {
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  }
  res.end(body);
}

function sseWrite(res: { write?: Function; end: Function }, frame: unknown, event = "message"): void {
  const data = JSON.stringify(frame);
  const chunk = `event: ${event}\ndata: ${data}\n\n`;
  if (typeof res.write === "function") res.write(chunk);
  else res.end(chunk);
}

function reqPath(req: IncomingLike): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

/**
 * Create a connect-style HTTP handler that serves the A2A endpoint.
 *
 * The returned async function has the shape
 * `(req, res) => Promise<boolean>` — it returns `true` when the request was
 * an A2A call it has fully answered (and the caller should stop routing),
 * `false` otherwise so other routes still work on the same server.
 *
 * Handler results:
 *  - `{ kind: "reply", message }`  → one JSON response
 *  - `{ kind: "stream", stream }`   → SSE stream of events; a terminal
 *      `{ type: "result", ... }` event ends it.
 */
export function createA2AHttpHandler(
  handler: A2AHandler,
  options: A2AServerOptions = {},
): (req: IncomingLike, res: unknown) => Promise<boolean> {
  const path = options.path ?? "/a2a";
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  return async function a2aHttpHandler(req: IncomingLike, res: unknown): Promise<boolean> {
    if ((req.method ?? "").toUpperCase() !== "POST") return false;
    if (reqPath(req) !== path) return false;

    const resAny = res as {
      writeHead?: Function;
      write?: Function;
      end: Function;
    };

    let parsed: Record<string, unknown>;
    try {
      const raw = await readBodyBytes(req as never, maxBodyBytes);
      parsed = raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
    } catch (err) {
      sendJson(resAny, 400, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }

    const message = parsed.message as A2AMessage | undefined;
    if (!message || !Array.isArray(message.parts)) {
      sendJson(resAny, 400, { error: "invalid a2a request: `message` with `parts[]` required" });
      return true;
    }

    const request: A2ARequest = {
      message,
      messageId: typeof parsed.messageId === "string" ? parsed.messageId : undefined,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      skill: typeof parsed.skill === "string" ? parsed.skill : message.metadata?.skill as string | undefined,
      metadata: (parsed.metadata as Record<string, unknown> | undefined) ?? message.metadata,
      raw: parsed,
    };

    let result: A2AHandlerResult;
    try {
      result = await handler(request);
    } catch (err) {
      sendJson(resAny, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }

    if (result.kind === "reply") {
      sendJson(resAny, 200, {
        message: result.message,
        status: result.status ?? "completed",
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        ...(request.messageId ? { messageId: request.messageId } : {}),
      });
      return true;
    }

    // Streaming reply.
    resAny.writeHead?.(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    try {
      for await (const ev of result.stream) {
        sseWrite(resAny, ev, ev.type ?? "message");
        if (isTerminalEvent(ev)) break;
      }
    } catch (err) {
      sseWrite(resAny, { type: "error", error: err instanceof Error ? err.message : String(err) }, "error");
    } finally {
      resAny.end();
    }
    return true;
  };
}
