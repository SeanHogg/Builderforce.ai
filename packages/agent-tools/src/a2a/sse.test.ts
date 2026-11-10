import { describe, expect, it } from "vitest";
import { createSseFrameParser, parseSseStream, sseFrameToEvent } from "./sse.js";
import type { A2AStreamEvent } from "./types.js";

const enc = new TextEncoder();

async function* chunks(...parts: (string | Uint8Array)[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield typeof p === "string" ? enc.encode(p) : p;
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<A2AStreamEvent[]> {
  const out: A2AStreamEvent[] = [];
  for await (const ev of parseSseStream(body)) out.push(ev);
  return out;
}

describe("a2a SSE parser", () => {
  it("parses JSON frames, names and terminal result", async () => {
    const events = await collect(
      chunks('event: message\ndata: {"type":"message","n":1}\n\n', 'data: {"type":"result","result":"ok"}\n\n'),
    );
    expect(events).toEqual([
      { type: "message", n: 1 },
      { type: "result", result: "ok" },
    ]);
  });

  it("regression: a multi-byte UTF-8 character split across chunks decodes intact", async () => {
    const bytes = enc.encode('data: {"type":"message","text":"héllo €"}\n\n');
    // Split inside the 3-byte euro sign.
    const euro = bytes.indexOf(0xe2);
    const events = await collect(chunks(bytes.slice(0, euro + 1), bytes.slice(euro + 1)));
    expect(events).toEqual([{ type: "message", text: "héllo €" }]);
    expect(JSON.stringify(events)).not.toContain("�");
  });

  it("regression: the event name resets between frames", async () => {
    const events = await collect(chunks("event: status\ndata: first\n\ndata: second\n\n"));
    expect(events).toEqual([
      { type: "status", data: "first" },
      { type: "message", data: "second" },
    ]);
  });

  it("regression: a final frame without a trailing blank line is still dispatched", async () => {
    const events = await collect(chunks('data: {"type":"message"}\n\n', 'data: {"type":"result","result":"done"}'));
    expect(events.map((e) => e.type)).toEqual(["message", "result"]);
  });

  it("regression: events are yielded as frames complete, before the stream ends", async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    async function* slow(): AsyncGenerator<Uint8Array> {
      yield enc.encode('data: {"type":"message","n":1}\n\n');
      await gate;
      yield enc.encode('data: {"type":"result"}\n\n');
    }
    const it = parseSseStream(slow())[Symbol.asyncIterator]();
    const first = await it.next();
    seen.push((first.value as A2AStreamEvent).type);
    expect(seen).toEqual(["message"]);
    release();
    const second = await it.next();
    expect((second.value as A2AStreamEvent).type).toBe("result");
    expect((await it.next()).done).toBe(true);
  });

  it("handles CRLF and CR line endings, including CRLF split across chunks", async () => {
    const events = await collect(chunks("data: a\r", "\n\r\ndata: b\r\rdata: c\n\n"));
    expect(events.map((e) => e.data)).toEqual(["a", "b", "c"]);
  });

  it("joins multi-line data with \\n, ignores comments and a leading BOM", async () => {
    const events = await collect(chunks("﻿: comment\ndata: line1\ndata:line2\ndata\n\n"));
    expect(events).toEqual([{ type: "message", data: "line1\nline2\n" }]);
  });

  it("skips frames with no data and wraps non-object JSON", () => {
    const p = createSseFrameParser();
    expect(p.push("event: ping\n\n")).toEqual([]);
    const [frame] = p.push("event: count\ndata: 42\n\n");
    expect(sseFrameToEvent(frame!)).toEqual({ type: "count", data: 42 });
    expect(p.end()).toEqual([]);
  });
});
