import { describe, it, expect } from "vitest";
import {
  awaitRemoteResult,
  resolveRemoteResult,
  pendingRemoteCount,
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
});
