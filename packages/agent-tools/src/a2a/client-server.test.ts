import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createA2AHttpHandler, sendMessage } from "../a2a.js";
import type { A2AHandler, A2AStreamEvent } from "../a2a.js";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

/** Listen on an ephemeral port with a raw node handler; returns the base URL. */
async function serveRaw(listener: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  server = createServer(listener);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Serve an A2A `handler` on `/a2a`; every other route answers 404. */
function serve(handler: A2AHandler): Promise<string> {
  const a2a = createA2AHttpHandler(handler);
  return serveRaw((req, res) => {
    void a2a(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
}

const hello = { message: { role: "user" as const, parts: [{ type: "text" as const, text: "hi" }] } };

describe("a2a client + server", () => {
  it("one-shot JSON reply round-trips messageId, sessionId and skill", async () => {
    let seenSkill: string | undefined;
    const base = await serve((req) => {
      seenSkill = req.skill;
      return {
        kind: "reply",
        sessionId: "s1",
        message: { role: "agent", parts: [{ type: "text", text: `echo ${req.message.parts[0]?.text}` }] },
      };
    });
    const result = await sendMessage(`${base}/a2a`, { ...hello, messageId: "m1", skill: "review" });
    expect(seenSkill).toBe("review");
    expect(result).toMatchObject({ status: "completed", sessionId: "s1", streamed: false });
    expect(result.message?.parts[0]?.text).toBe("echo hi");
  });

  it("streams SSE events and folds the terminal result", async () => {
    const base = await serve(() => ({
      kind: "stream",
      stream: (async function* () {
        yield { type: "message", message: { role: "agent", parts: [{ type: "text", text: "partial" }] } };
        yield { type: "result", result: "final answer", session_id: "s2" };
        yield { type: "message", text: "never sent" };
      })(),
    }));
    const seen: A2AStreamEvent[] = [];
    const result = await sendMessage(`${base}/a2a`, hello, {}, (ev) => seen.push(ev));
    expect(result.streamed).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.sessionId).toBe("s2");
    expect(result.message?.parts[0]?.text).toBe("final answer");
    expect(seen.map((e) => e.type)).toEqual(["message", "result"]);
  });

  it("reports an error result status", async () => {
    const base = await serve(() => ({
      kind: "stream",
      stream: (async function* () {
        yield { type: "result", subtype: "error_max_turns", result: "gave up" };
      })(),
    }));
    expect((await sendMessage(`${base}/a2a`, hello)).status).toBe("error");
  });

  it("regression: onEvent fires for each event before the stream ends", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const base = await serveRaw((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"message","n":1}\n\n');
      void gate.then(() => res.end('data: {"type":"result","result":"done"}\n\n'));
    });
    let onFirst!: (ev: A2AStreamEvent) => void;
    const firstEvent = new Promise<A2AStreamEvent>((resolve) => (onFirst = resolve));
    const sent = sendMessage(`${base}/a2a`, hello, {}, (ev) => {
      if (ev.type === "message") onFirst(ev);
    });
    // Resolves only if the first event is delivered while the server still holds the stream open.
    expect((await firstEvent).n).toBe(1);
    finish();
    expect((await sent).message?.parts[0]?.text).toBe("done");
  });

  it("rejects a malformed request with 400 and lets other routes through", async () => {
    const base = await serve(() => ({ kind: "reply", message: { role: "agent", parts: [] } }));
    const bad = await fetch(`${base}/a2a`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    const other = await fetch(`${base}/elsewhere`, { method: "POST", body: "{}" });
    expect(other.status).toBe(404);
    await expect(sendMessage(`${base}/elsewhere`, hello)).rejects.toThrow(/404/);
  });
});
