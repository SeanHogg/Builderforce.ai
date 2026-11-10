/**
 * A2A wire types shared by the client (`client.ts`), the server (`server.ts`)
 * and the SSE parser (`sse.ts`). See `../a2a.ts` for the wire contract.
 */

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

const TERMINAL_RESULT_TYPES = new Set(["result", "error", "completed", "canceled"]);

/** True for an event that ends a stream (`result`, `error`, `completed`, `canceled`). */
export function isTerminalEvent(ev: A2AStreamEvent): boolean {
  return TERMINAL_RESULT_TYPES.has(ev.type);
}
