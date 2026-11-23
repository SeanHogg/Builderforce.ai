import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkingTranscriptState } from "@seanhogg/builderforce-memory/working";
import { createCompactionHook, foldLimits, type HistoryCompactionPorts } from "../../src/index.js";
import { policyCtx } from "../support/policyContext.js";

function history() {
  const state: WorkingTranscriptState = {
    transcript: Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i}:${"x".repeat(12_000)}` })),
    compactMemo: null,
  };
  const ports: HistoryCompactionPorts = {
    state, systemPrompt: "SYSTEM", summarize: vi.fn(async () => "SUMMARY"),
    toRunMessage: (row) => ({ role: row.role, content: String(row.content) }),
    recordFold: vi.fn(), activity: vi.fn(), timeout: vi.fn(), error: vi.fn(), savedTokens: vi.fn(),
  };
  return ports;
}

afterEach(() => vi.useRealTimers());

describe("shared history compaction strategy", () => {
  it("preserves source history, reuses the memo, records only new folds and reports window savings", async () => {
    const ports = history();
    const original = [...ports.state.transcript];
    const hook = createCompactionHook({ history: ports });
    const ctx = policyCtx();
    const first = await hook.compact(ctx);
    expect(first?.messages.some((row) => row.content.includes("SUMMARY"))).toBe(true);
    expect(ports.recordFold).toHaveBeenCalledTimes(1);
    expect(ports.state.transcript).toEqual(original);
    expect(ports.state.transcript[0]).toBe(original[0]);
    expect(ports.savedTokens).toHaveBeenLastCalledWith(expect.any(Number));
    expect(ports.state.compactMemo?.note).toContain("SUMMARY");
    const second = await hook.compact(ctx);
    expect(second?.reused).toBe(true);
    expect(ports.summarize).toHaveBeenCalledTimes(1);
    expect(ports.recordFold).toHaveBeenCalledTimes(1);
  });

  it("aborts a summary at its deadline and does not wait again in the same run", async () => {
    vi.useFakeTimers();
    const ports = history();
    let signal: AbortSignal | undefined;
    ports.summarize = vi.fn<HistoryCompactionPorts["summarize"]>((_messages, ownSignal) => { signal = ownSignal; return new Promise<string | null>(() => {}); });
    const hook = createCompactionHook({ history: ports });
    const first = hook.compact(policyCtx());
    await vi.advanceTimersByTimeAsync(foldLimits.summaryMs);
    expect((await first)?.messages.length).toBeGreaterThan(0);
    expect(signal?.aborted).toBe(true);
    expect(ports.timeout).toHaveBeenCalledTimes(1);
    await hook.compact(policyCtx());
    expect(ports.summarize).toHaveBeenCalledTimes(1);
  });

  it("reports a failed summary and falls back to recent history", async () => {
    const ports = history();
    const error = new Error("summary unavailable");
    ports.summarize = async () => { throw error; };
    expect((await createCompactionHook({ history: ports }).compact(policyCtx()))?.messages.length).toBeGreaterThan(0);
    expect(ports.error).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), error);
    expect(ports.state.compactMemo).toBeNull();
  });
});
