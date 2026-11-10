/**
 * A2A — Agent-to-Agent messaging transport (public entry, `@builderforce/agent-tools/a2a`).
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
 * One concern per module: `a2a/types.ts` (wire types), `a2a/sse.ts` (the SSE
 * parser), `a2a/client.ts` (`sendMessage`), `a2a/server.ts`
 * (`createA2AHttpHandler`, Node-only). See `extensions/a2a` in agent-runtime for
 * the plugin built on top of it.
 */

export type {
  A2AClientOptions,
  A2AHandler,
  A2AHandlerResult,
  A2AMessage,
  A2APart,
  A2ARequest,
  A2ASendParams,
  A2ASendResult,
  A2AServerOptions,
  A2AStreamEvent,
} from "./a2a/types.js";
export { isTerminalEvent } from "./a2a/types.js";
export { createSseFrameParser, parseSseStream, sseFrameToEvent } from "./a2a/sse.js";
export type { SseFrame, SseFrameParser } from "./a2a/sse.js";
export { sendMessage } from "./a2a/client.js";
export { createA2AHttpHandler } from "./a2a/server.js";
