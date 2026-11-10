/**
 * A2A server: a connect-style HTTP handler that answers the A2A endpoint with one
 * JSON reply or an SSE stream. Node-only (uses `Buffer`).
 */

import { isTerminalEvent } from "./types.js";
import type { A2AHandler, A2AHandlerResult, A2AMessage, A2ARequest, A2AServerOptions } from "./types.js";

/** Minimal request/response surface so this works on node:http and CF Workers. */
type IncomingLike = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type ResponseLike = {
  writeHead?: Function;
  write?: Function;
  end: Function;
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

function sendJson(res: ResponseLike, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  if (typeof res.writeHead === "function") {
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  }
  res.end(body);
}

function sseWrite(res: ResponseLike, frame: unknown, event = "message"): void {
  // A line break in the event name would end the field early and corrupt the frame.
  const name = event.replace(/[\r\n]/g, "");
  const chunk = `event: ${name}\ndata: ${JSON.stringify(frame)}\n\n`;
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

function toRequest(parsed: Record<string, unknown>, message: A2AMessage): A2ARequest {
  return {
    message,
    messageId: typeof parsed.messageId === "string" ? parsed.messageId : undefined,
    sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
    skill: typeof parsed.skill === "string" ? parsed.skill : (message.metadata?.skill as string | undefined),
    metadata: (parsed.metadata as Record<string, unknown> | undefined) ?? message.metadata,
    raw: parsed,
  };
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

    const resAny = res as ResponseLike;

    let parsed: Record<string, unknown>;
    try {
      const raw = await readBodyBytes(req as never, maxBodyBytes);
      parsed = raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
    } catch (err) {
      sendJson(resAny, 400, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }

    const message = parsed?.message as A2AMessage | undefined;
    if (!message || !Array.isArray(message.parts)) {
      sendJson(resAny, 400, { error: "invalid a2a request: `message` with `parts[]` required" });
      return true;
    }

    const request = toRequest(parsed, message);

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
