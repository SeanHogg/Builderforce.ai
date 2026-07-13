import { createHeadlessRenderer } from "@builderforce/tui";
import { describe, expect, it, vi } from "vitest";
import { type InkSessionClient, wireInkSession } from "./ink-session.js";

/** A fake gateway client whose events the test drives directly. */
function fakeClient(): InkSessionClient & { emit(event: string, payload: unknown): void } {
  const c: InkSessionClient & { emit(event: string, payload: unknown): void } = {
    sendChat: vi.fn(async () => ({ runId: "run-1" })),
    emit(event, payload) {
      this.onEvent?.({ event, payload });
    },
  };
  return c;
}

describe("wireInkSession", () => {
  it("submitting input appends a user entry and calls chat.send", async () => {
    const renderer = createHeadlessRenderer();
    const client = fakeClient();
    wireInkSession({ renderer, client, sessionKey: "main" });

    await renderer.input.submit("hello there");

    expect(renderer.chat.entries.at(-1)).toEqual({ kind: "user", text: "hello there" });
    expect(client.sendChat).toHaveBeenCalledWith({ sessionKey: "main", message: "hello there" });
    expect(renderer.input.isEnabled()).toBe(false); // disabled until the run finishes
  });

  it("ignores blank submissions", async () => {
    const renderer = createHeadlessRenderer();
    const client = fakeClient();
    wireInkSession({ renderer, client, sessionKey: "main" });

    await renderer.input.submit("   ");

    expect(renderer.chat.entries).toHaveLength(0);
    expect(client.sendChat).not.toHaveBeenCalled();
  });

  it("streams assistant deltas into a single assistant entry, then finalizes", async () => {
    const renderer = createHeadlessRenderer();
    const client = fakeClient();
    wireInkSession({ renderer, client, sessionKey: "main" });

    client.emit("chat", { runId: "r1", sessionKey: "main", state: "delta", message: { content: "Hel" } });
    client.emit("chat", { runId: "r1", sessionKey: "main", state: "delta", message: { content: "Hello world" } });

    const assistant = renderer.chat.entries.filter((e) => e.kind === "assistant");
    expect(assistant).toHaveLength(1); // one entry, updated in place
    expect(assistant[0]).toMatchObject({ kind: "assistant", text: "Hello world" });

    renderer.input.setEnabled(false);
    client.emit("chat", { runId: "r1", sessionKey: "main", state: "final", message: { content: "Hello world" } });
    expect(renderer.input.isEnabled()).toBe(true); // re-enabled on final
  });

  it("drops events for a different session", () => {
    const renderer = createHeadlessRenderer();
    const client = fakeClient();
    wireInkSession({ renderer, client, sessionKey: "main" });

    client.emit("chat", { runId: "r1", sessionKey: "other", state: "delta", message: { content: "nope" } });
    expect(renderer.chat.entries).toHaveLength(0);
  });

  it("renders a tool call: running on start, resolved on result", () => {
    const renderer = createHeadlessRenderer();
    const client = fakeClient();
    wireInkSession({ renderer, client, sessionKey: "main" });

    client.emit("agent", { runId: "r1", stream: "tool", data: { phase: "start", toolCallId: "t1", name: "read", args: { path: "a.ts" } } });
    expect(renderer.chat.entries.at(-1)).toMatchObject({ kind: "tool", name: "read", detail: "a.ts", status: "running" });

    client.emit("agent", { runId: "r1", stream: "tool", data: { phase: "result", toolCallId: "t1", name: "read", result: "ok" } });
    expect(renderer.chat.entries.at(-1)).toMatchObject({ kind: "tool", name: "read", status: "ok", result: "ok" });
  });

  it("marks a failed tool result as error", () => {
    const renderer = createHeadlessRenderer();
    const client = fakeClient();
    wireInkSession({ renderer, client, sessionKey: "main" });

    client.emit("agent", { runId: "r1", stream: "tool", data: { phase: "start", toolCallId: "t1", name: "exec" } });
    client.emit("agent", { runId: "r1", stream: "tool", data: { phase: "result", toolCallId: "t1", name: "exec", isError: true, result: "boom" } });

    expect(renderer.chat.entries.at(-1)).toMatchObject({ kind: "tool", status: "error" });
  });
});
