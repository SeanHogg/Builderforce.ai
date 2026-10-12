import { describe, it, expect } from "vitest";
import {
  applyAssistantChunk,
  awaitRemoteResult,
  parseRemoteCallbackFrame,
  pendingRemoteCount,
  pushRemoteResultChunk,
  resolveRemoteResult,
} from "./remote-result-broker.js";

describe("remote-result-broker", () => {
  it("resolves when resolveRemoteResult is called with matching correlationId", async () => {
    const promise = awaitRemoteResult("corr-1", 5000);
    resolveRemoteResult("corr-1", "task done");
    const result = await promise;
    expect(result).toBe("task done");
  });

  it("returns false when no pending callback exists for correlationId", () => {
    const resolved = resolveRemoteResult("nonexistent", "result");
    expect(resolved).toBe(false);
  });

  it("rejects after timeout", async () => {
    const promise = awaitRemoteResult("corr-timeout", 50);
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it("tracks pending count correctly", async () => {
    const p1 = awaitRemoteResult("track-1", 5000);
    const p2 = awaitRemoteResult("track-2", 5000);
    expect(pendingRemoteCount()).toBeGreaterThanOrEqual(2);
    resolveRemoteResult("track-1", "done");
    resolveRemoteResult("track-2", "done");
    await p1;
    await p2;
  });

  it("delivers live chunks to onChunk before the terminal result", async () => {
    const chunks: string[] = [];
    const promise = awaitRemoteResult("corr-chunks", 5000, (c) => chunks.push(c));
    expect(pushRemoteResultChunk("corr-chunks", "hel")).toBe(true);
    expect(pushRemoteResultChunk("corr-chunks", "lo")).toBe(true);
    resolveRemoteResult("corr-chunks", "hello");
    await expect(promise).resolves.toBe("hello");
    expect(chunks).toEqual(["hel", "lo"]);
  });

  it("returns false for chunks with no waiter or empty payload", () => {
    expect(pushRemoteResultChunk("nobody", "x")).toBe(false);
    const p = awaitRemoteResult("corr-empty-chunk", 5000);
    expect(pushRemoteResultChunk("corr-empty-chunk", "")).toBe(false);
    resolveRemoteResult("corr-empty-chunk", "done");
    return p;
  });
});

describe("parseRemoteCallbackFrame", () => {
  it("parses runtime remote.task.chunk / remote.task.result", () => {
    expect(
      parseRemoteCallbackFrame({
        type: "remote.task.chunk",
        correlationId: "c1",
        chunk: "ab",
      }),
    ).toEqual({ kind: "chunk", correlationId: "c1", chunk: "ab" });
    expect(
      parseRemoteCallbackFrame({
        type: "remote.task.result",
        correlationId: "c1",
        result: "done",
      }),
    ).toEqual({ kind: "result", correlationId: "c1", result: "done" });
  });

  it("accepts the documented remote.result + taskCorrelationId aliases", () => {
    expect(
      parseRemoteCallbackFrame({
        type: "remote.result",
        taskCorrelationId: "c2",
        result: "ok",
      }),
    ).toEqual({ kind: "result", correlationId: "c2", result: "ok" });
    expect(
      parseRemoteCallbackFrame({
        type: "remote.result.chunk",
        taskCorrelationId: "c2",
        chunk: "xy",
      }),
    ).toEqual({ kind: "chunk", correlationId: "c2", chunk: "xy" });
  });

  it("returns null without a correlation id or unknown type", () => {
    expect(parseRemoteCallbackFrame({ type: "remote.task.result", result: "x" })).toBeNull();
    expect(parseRemoteCallbackFrame({ type: "chat.message", correlationId: "c" })).toBeNull();
  });
});

describe("applyAssistantChunk", () => {
  it("appends deltas and replaces on a full-text snapshot", () => {
    expect(applyAssistantChunk("", { delta: "he" })).toEqual({ accumulated: "he", piece: "he" });
    expect(applyAssistantChunk("he", { delta: "llo" })).toEqual({
      accumulated: "hello",
      piece: "llo",
    });
    expect(applyAssistantChunk("stale", { text: "fresh" })).toEqual({
      accumulated: "fresh",
      piece: "fresh",
    });
    expect(applyAssistantChunk("keep", {})).toEqual({ accumulated: "keep", piece: "" });
  });
});
