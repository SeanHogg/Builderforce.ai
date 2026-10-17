import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteChunkQueue,
  createToolAuditPersister,
  type RemoteChunk,
} from "./builderforce-relay-outboxes.js";

/** The contract this pins: a batch leaves at 25 events or 1.5 s after the first. */
const TOOL_AUDIT_MAX_ITEMS = 25;
const TOOL_AUDIT_MAX_WAIT_MS = 1_500;

function persister(status = 200) {
  const bodies: unknown[] = [];
  const statuses = [status];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: statuses.shift() ?? 200 });
  }) as unknown as typeof fetch;
  const errors: unknown[] = [];
  const p = createToolAuditPersister({
    url: "https://api.test/api/agent-hosts/5/tool-audit",
    apiKey: "k",
    onError: (e) => errors.push(e),
    fetchImpl,
  });
  return { p, bodies, errors };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("tool-audit persister", () => {
  it("batches events into one POST after the wait, in order", async () => {
    const { p, bodies } = persister();
    p.persist({ executionId: 9, toolName: "a" });
    p.persist({ executionId: 9, toolName: "b" });
    p.persist({ executionId: 9, toolName: "c" });
    await vi.advanceTimersByTimeAsync(TOOL_AUDIT_MAX_WAIT_MS - 1);
    expect(bodies).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(bodies).toHaveLength(1);
    const events = (bodies[0] as { events: Array<Record<string, unknown>> }).events;
    expect(events.map((e) => e.toolName)).toEqual(["a", "b", "c"]);
    expect(events[0]).toMatchObject({ executionId: 9, runId: "exec-9", sessionKey: "main" });
  });

  it("sends a lone event in the single-event shape every API accepts", async () => {
    const { p, bodies } = persister();
    p.persist({ toolName: "solo" });
    await p.flush();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ toolName: "solo", sessionKey: "main" });
    expect(bodies[0]).not.toHaveProperty("events");
  });

  it("sends a full batch without waiting", async () => {
    const { p, bodies } = persister();
    for (let i = 0; i < TOOL_AUDIT_MAX_ITEMS; i += 1) {
      p.persist({ toolName: `t${i}` });
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies).toHaveLength(1);
  });

  it("falls back to one-by-one when an older API refuses the batch shape", async () => {
    const { p, bodies } = persister(400);
    p.persist({ toolName: "a" });
    p.persist({ toolName: "b" });
    await p.flush();
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toHaveProperty("events");
    expect(bodies.slice(1).map((b) => (b as { toolName: string }).toolName)).toEqual(["a", "b"]);
  });

  it("never rejects when the API is unreachable (best-effort, as before)", async () => {
    const errors: unknown[] = [];
    const p = createToolAuditPersister({
      url: "https://api.test/x",
      apiKey: "k",
      onError: (e) => errors.push(e),
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    p.persist({ toolName: "a" });
    await expect(p.flush()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});

describe("tool-audit emit: exactly once", () => {
  function emitter(socketUp: () => boolean) {
    const frames: Array<Record<string, unknown>> = [];
    const bodies: unknown[] = [];
    const p = createToolAuditPersister({
      url: "https://api.test/api/agent-hosts/5/tool-audit",
      apiKey: "k",
      onError: () => {},
      sendLive: (frame) => {
        if (!socketUp()) return false;
        frames.push(frame);
        return true;
      },
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });
    return { p, frames, bodies };
  }

  it("socket up: the live frame is the only write (the relay DO persists it)", async () => {
    const { p, frames, bodies } = emitter(() => true);
    p.emit({ executionId: 9, toolName: "read_file", toolCallId: "c1", category: "v2", args: { path: "a" } });
    await p.flush();
    await vi.advanceTimersByTimeAsync(TOOL_AUDIT_MAX_WAIT_MS);
    expect(bodies).toEqual([]);
    expect(frames).toHaveLength(1);
  });

  it("socket down: falls back to HTTP, and the frame and HTTP body carry the same row fields", async () => {
    let up = true;
    const { p, frames, bodies } = emitter(() => up);
    p.emit({ executionId: 9, toolName: "a", result: "r" });
    up = false;
    p.emit({ executionId: 9, toolName: "b", result: "r" });
    await p.flush(); // run-end flush still lands the fallback
    expect(frames).toHaveLength(1);
    expect(bodies).toHaveLength(1);
    const { type, ...frameRow } = frames[0]!;
    expect(type).toBe("tool.audit");
    // Both go over the wire as JSON, so compare what each side actually receives.
    const sentRow = JSON.parse(JSON.stringify(frameRow)) as object;
    expect(Object.keys(sentRow).sort()).toEqual(Object.keys(bodies[0] as object).sort());
    expect(frameRow).toMatchObject({ executionId: 9, runId: "exec-9", sessionKey: "main", toolName: "a", result: "r" });
    expect(bodies[0]).toMatchObject({ executionId: 9, runId: "exec-9", sessionKey: "main", toolName: "b", result: "r" });
  });

  it("persist() is durable-only: never sent live", async () => {
    const { p, frames, bodies } = emitter(() => true);
    p.persist({ executionId: 9, toolName: "agent.message", result: "hi" });
    await p.flush();
    expect(frames).toEqual([]);
    expect(bodies).toHaveLength(1);
  });
});

describe("remote chunk queue", () => {
  it("coalesces a session's pieces for 250 ms, joining adjacent pieces of one correlation", async () => {
    const sent: RemoteChunk[] = [];
    const q = createRemoteChunkQueue(
      async (chunk) => {
        sent.push(chunk);
      },
      () => {},
    );
    const at = (correlationId: string, piece: string) => ({ callbackAgentNodeId: "n", correlationId, piece });
    q.enqueue("s1", at("x", "a"));
    q.enqueue("s1", at("x", "b"));
    q.enqueue("s1", at("y", "c"));
    q.enqueue("s1", at("x", "d"));
    await vi.advanceTimersByTimeAsync(249);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([at("x", "ab"), at("y", "c"), at("x", "d")]);
  });
});
