import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The webview half of the host-proxied fetch.
 *
 * This is the piece with no other way to be checked: it only runs inside a VS Code
 * webview, and what it does — turn a sequence of postMessage frames back into a
 * `Response` whose body is a live stream — is exactly the kind of code that appears to
 * work until a chunk arrives a tick earlier than expected. The shared
 * `streamChatCompletion` requires a real streaming `Response`, so if this reassembly is
 * wrong, every local turn in the Brain panel fails at the transport with no useful error.
 *
 * The ordering case below is the one that matters most: the host starts streaming the
 * moment the upstream responds, which can be BEFORE the consumer has begun reading, so
 * early chunks must be queued rather than dropped.
 */

type Listener = (e: { data: unknown }) => void;

let posted: Array<Record<string, unknown>>;
let listeners: Listener[];

/** Deliver a host→webview frame to the module's message listener. */
function fromHost(frame: Record<string, unknown>): void {
  for (const listener of listeners) listener({ data: frame });
}

/** The id the module assigned to the most recent `llm.fetch`. */
function lastFetchId(): string {
  const message = [...posted].reverse().find((m) => m.type === "llm.fetch");
  return String(message?.id ?? "");
}

beforeEach(() => {
  posted = [];
  listeners = [];
  vi.resetModules();
  // Only 'message' listeners receive host frames. The module also registers a
  // 'pagehide' handler that fails every in-flight stream on teardown; feeding frames to
  // that would tear down the very streams under test.
  const stub = {
    addEventListener: (type: string, cb: Listener) => { if (type === "message") listeners.push(cb); },
    removeEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).window = stub;
  (globalThis as Record<string, unknown>).addEventListener = stub.addEventListener;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: (m: Record<string, unknown>) => { posted.push(m); },
    getState: () => undefined,
    setState: () => {},
  });
});

async function loadBridge() {
  return import("./vscodeBridge");
}

describe("hostFetch", () => {
  it("sends the request to the host and rebuilds a streaming Response", async () => {
    const { hostFetch } = await loadBridge();
    const pending = hostFetch("http://127.0.0.1:1919/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"model":"gpt-oss-20b"}',
    });

    const sent = posted.find((m) => m.type === "llm.fetch")!;
    expect(sent.url).toBe("http://127.0.0.1:1919/v1/chat/completions");
    expect(sent.method).toBe("POST");
    expect(sent.body).toBe('{"model":"gpt-oss-20b"}');

    const id = lastFetchId();
    fromHost({ type: "llm.open", id, status: 200, statusText: "OK", headers: { "content-type": "text/event-stream" } });
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    fromHost({ type: "llm.chunk", id, text: "data: one\n\n" });
    fromHost({ type: "llm.chunk", id, text: "data: two\n\n" });
    fromHost({ type: "llm.end", id });

    expect(await res.text()).toBe("data: one\n\ndata: two\n\n");
  });

  it("keeps chunks that arrive before the body is read", async () => {
    // The host streams as soon as the upstream responds; the consumer may not have
    // started reading yet. Dropping those bytes would silently truncate the reply.
    const { hostFetch } = await loadBridge();
    const pending = hostFetch("http://127.0.0.1:1919/v1/chat/completions", { method: "POST" });
    const id = lastFetchId();
    fromHost({ type: "llm.open", id, status: 200, statusText: "OK", headers: {} });
    const res = await pending;

    fromHost({ type: "llm.chunk", id, text: "early-" });
    fromHost({ type: "llm.chunk", id, text: "bytes" });
    fromHost({ type: "llm.end", id });

    expect(await res.text()).toBe("early-bytes");
  });

  it("surfaces a non-OK response rather than failing, so error mapping still runs", async () => {
    // `streamChatCompletion` reads the body of a failed response to build its typed
    // error. A rejected promise here would replace that with a transport error.
    const { hostFetch } = await loadBridge();
    const pending = hostFetch("http://127.0.0.1:1919/v1/chat/completions", { method: "POST" });
    const id = lastFetchId();
    fromHost({ type: "llm.open", id, status: 503, statusText: "Service Unavailable", headers: {} });
    const res = await pending;
    fromHost({ type: "llm.chunk", id, text: "engine not started" });
    fromHost({ type: "llm.end", id });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("engine not started");
  });

  it("rejects when the host cannot perform the fetch at all", async () => {
    const { hostFetch } = await loadBridge();
    const pending = hostFetch("http://127.0.0.1:9999/v1/chat/completions", { method: "POST" });
    fromHost({ type: "llm.error", id: lastFetchId(), error: "refused: not a configured local model endpoint" });
    await expect(pending).rejects.toThrow(/not a configured local model endpoint/);
  });

  it("tells the host to abort when the caller cancels", async () => {
    const { hostFetch } = await loadBridge();
    const controller = new AbortController();
    const pending = hostFetch("http://127.0.0.1:1919/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
    });
    const id = lastFetchId();
    fromHost({ type: "llm.open", id, status: 200, statusText: "OK", headers: {} });
    await pending;

    controller.abort();
    expect(posted.some((m) => m.type === "llm.abort" && m.id === id)).toBe(true);
  });

  it("ignores frames for a stream it no longer knows about", async () => {
    // A cancelled stream can still have frames in flight; they must not throw.
    const { hostFetch } = await loadBridge();
    const pending = hostFetch("http://127.0.0.1:1919/v1/chat/completions", { method: "POST" });
    const id = lastFetchId();
    fromHost({ type: "llm.open", id, status: 200, statusText: "OK", headers: {} });
    await pending;
    fromHost({ type: "llm.end", id });
    expect(() => fromHost({ type: "llm.chunk", id, text: "late" })).not.toThrow();
    expect(() => fromHost({ type: "llm.chunk", id: "never-existed", text: "x" })).not.toThrow();
  });
});
