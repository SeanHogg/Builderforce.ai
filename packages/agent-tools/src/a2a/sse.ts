/**
 * Incremental Server-Sent Events parser for the A2A client.
 *
 * Follows the WHATWG "event stream interpretation" rules:
 *  - lines end in `\r\n`, `\n` or `\r` (a `\r\n` split across chunks is one terminator);
 *  - a blank line dispatches the pending frame, and the `event:` name is reset
 *    after every frame so the next one does not inherit it;
 *  - several `data:` lines join with `\n`; one leading space after the colon is dropped;
 *  - lines starting with `:` are comments; a leading BOM is ignored.
 *
 * One deliberate departure: a final frame that is not followed by a blank line is
 * still dispatched at end of stream, because the terminal `result` event is the
 * one most likely to be written last without its trailing separator.
 *
 * Bytes are decoded with a streaming `TextDecoder`, so a multi-byte UTF-8
 * character split across two chunks decodes intact.
 */

import type { A2AStreamEvent } from "./types.js";

/** One dispatched SSE frame, before its data is interpreted. */
export type SseFrame = {
  /** The `event:` field, when the frame named one. */
  event?: string;
  /** Every `data:` line of the frame, joined with `\n`. */
  data: string;
};

/** A push-style parser: feed decoded text, collect the frames it completes. */
export type SseFrameParser = {
  /** Feed decoded text; returns the frames this text completed. */
  push(text: string): SseFrame[];
  /** End of stream: returns the final frame if one was left without a blank line. */
  end(): SseFrame[];
};

export function createSseFrameParser(): SseFrameParser {
  let buffer = "";
  let started = false;
  let eventName: string | undefined;
  let dataLines: string[] = [];

  function dispatch(out: SseFrame[]): void {
    if (dataLines.length > 0) {
      out.push({ ...(eventName !== undefined ? { event: eventName } : {}), data: dataLines.join("\n") });
    }
    eventName = undefined;
    dataLines = [];
  }

  function processLine(line: string, out: SseFrame[]): void {
    if (line === "") {
      dispatch(out);
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value || undefined;
    else if (field === "data") dataLines.push(value);
    // `id:` and `retry:` carry no meaning for a single request/response exchange.
  }

  function drain(final: boolean): SseFrame[] {
    const out: SseFrame[] = [];
    if (!started && buffer.length > 0) {
      started = true;
      if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1);
    }
    let pos = 0;
    for (;;) {
      const cr = buffer.indexOf("\r", pos);
      const lf = buffer.indexOf("\n", pos);
      if (cr === -1 && lf === -1) break;
      if (cr !== -1 && (lf === -1 || cr < lf)) {
        // A trailing `\r` may be the first half of a `\r\n` split across chunks.
        if (cr === buffer.length - 1 && !final) break;
        processLine(buffer.slice(pos, cr), out);
        pos = buffer[cr + 1] === "\n" ? cr + 2 : cr + 1;
      } else {
        processLine(buffer.slice(pos, lf), out);
        pos = lf + 1;
      }
    }
    buffer = buffer.slice(pos);
    if (final) {
      if (buffer.length > 0) processLine(buffer, out);
      buffer = "";
      dispatch(out);
    }
    return out;
  }

  return {
    push(text: string): SseFrame[] {
      buffer += text;
      return drain(false);
    },
    end(): SseFrame[] {
      return drain(true);
    },
  };
}

/**
 * Interpret a frame's data: a JSON object becomes the event (its `type` defaulting
 * to the frame's `event:` name, else `"message"`); anything else is wrapped as
 * `{ type, data }`.
 */
export function sseFrameToEvent(frame: SseFrame): A2AStreamEvent {
  const fallbackType = frame.event ?? "message";
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    return { type: fallbackType, data: frame.data };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { type: fallbackType, data: parsed };
  }
  const event = parsed as Record<string, unknown>;
  return typeof event.type === "string" ? (event as A2AStreamEvent) : { ...event, type: fallbackType };
}

/**
 * Parse an SSE byte stream, yielding each event as soon as its frame completes
 * (not after the stream ends), then any unterminated final frame.
 */
export async function* parseSseStream(
  body: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<A2AStreamEvent, void, undefined> {
  const decoder = new TextDecoder("utf-8");
  const parser = createSseFrameParser();
  for await (const chunk of body) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    for (const frame of parser.push(text)) yield sseFrameToEvent(frame);
  }
  const tail = decoder.decode();
  const frames = tail ? parser.push(tail) : [];
  frames.push(...parser.end());
  for (const frame of frames) yield sseFrameToEvent(frame);
}
