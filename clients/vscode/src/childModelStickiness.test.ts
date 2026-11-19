import { describe, expect, it } from "vitest";
import type { BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { sameModelTier, stickyChildStream, type StickyModelState } from "./childModelStickiness";

const FLASH = "minimax/MiniMax-M3.1-Flash";
const M3 = "minimax/MiniMax-M3";
const KIMI = "kimi-for-coding";

type Call = Parameters<BrainStreamFn>[0];
const call = (over: Partial<Call> = {}): Call => ({ messages: [], ...over }) as Call;

/**
 * A gateway as chat #273's child met it. Unpinned, each turn is routed afresh by role:
 * Flash ×4, then kimi-for-coding ×4. A call naming a model gets it — except the 2nd call,
 * where Flash times out (408) and the gateway fails over to M3.
 */
function chat273Gateway(): { stream: BrainStreamFn; sent: Array<string | undefined> } {
  const sent: Array<string | undefined> = [];
  const unpinned = [FLASH, FLASH, FLASH, FLASH, KIMI, KIMI, KIMI, KIMI];
  let n = 0;
  const stream: BrainStreamFn = async (opts) => {
    n += 1;
    sent.push(opts.model);
    const served = n === 2 ? M3 : opts.model ?? unpinned[n - 1] ?? KIMI;
    return { text: "", toolCalls: [], finishReason: "tool_calls", resolvedModel: served };
  };
  return { stream, sent };
}

async function servedSequence(stream: BrainStreamFn, turns: number): Promise<string[]> {
  const served: string[] = [];
  for (let i = 0; i < turns; i += 1) served.push((await stream(call())).resolvedModel ?? "");
  return served;
}

describe("a child keeps the model it was first routed to (VS Code chat #273)", () => {
  it("regression: unpinned, the child hopped Flash → M3 → Flash → Flash → Kimi ×4", async () => {
    const { stream } = chat273Gateway();
    expect(await servedSequence(stream, 8)).toEqual([FLASH, M3, FLASH, FLASH, KIMI, KIMI, KIMI, KIMI]);
  });

  it("sticky: it stays on Flash, fails over once to M3 (same family), and then STAYS on M3", async () => {
    const gateway = chat273Gateway();
    const state: StickyModelState = {};
    const stream = stickyChildStream(gateway.stream, "code", state);
    expect(await servedSequence(stream, 8)).toEqual([FLASH, M3, M3, M3, M3, M3, M3, M3]);
    // Only the first call is routed by role; every later one names the held model.
    expect(gateway.sent).toEqual([undefined, FLASH, M3, M3, M3, M3, M3, M3]);
    expect(state.held).toBe(M3);
  });

  it("a cross-family substitute answers one call, and the next goes back to the held model", async () => {
    let n = 0;
    const sent: Array<string | undefined> = [];
    const stream = stickyChildStream(async (opts) => {
      n += 1;
      sent.push(opts.model);
      return { text: "", toolCalls: [], finishReason: "stop", resolvedModel: n === 2 ? KIMI : opts.model ?? FLASH };
    }, "explore");
    expect(await servedSequence(stream, 3)).toEqual([FLASH, KIMI, FLASH]);
    expect(sent).toEqual([undefined, FLASH, FLASH]);
  });

  it("a provider error on the held model routes the next call around it, and a same-family failover is kept", async () => {
    let n = 0;
    const sent: Call[] = [];
    const state: StickyModelState = {};
    const stream = stickyChildStream(async (opts) => {
      n += 1;
      sent.push(opts);
      if (n === 2) throw new Error("408 Request Timeout");
      return { text: "", toolCalls: [], finishReason: "stop", resolvedModel: opts.model ?? (n === 1 ? FLASH : M3) };
    }, "code", state);
    await stream(call());
    await expect(stream(call())).rejects.toThrow("408");
    expect(state.failing).toBe(FLASH);
    await stream(call());
    expect(sent[2]!.model).toBeUndefined();
    expect(sent[2]!.excludeModels).toEqual([FLASH]);
    expect(state.held).toBe(M3);
    await stream(call());
    expect(sent[3]!.model).toBe(M3);
  });

  it("a dead held model with only another family to stand in is released after repeated misses", async () => {
    const sent: Call[] = [];
    const state: StickyModelState = {};
    const stream = stickyChildStream(async (opts) => {
      sent.push(opts);
      if (opts.model === FLASH && sent.length > 1) throw new Error("503 upstream unavailable");
      return { text: "", toolCalls: [], finishReason: "stop", resolvedModel: opts.model ?? (sent.length === 1 ? FLASH : KIMI) };
    }, "code", state);
    await stream(call()); // routed: Flash, held
    await expect(stream(call())).rejects.toThrow("503"); // Flash dies — miss 1
    await stream(call()); // routed around Flash: Kimi substitutes — miss 2, the hold moves
    expect(state.held).toBe(KIMI);
    for (let i = 0; i < 3; i += 1) await stream(call());
    expect(sent.slice(3).map((c) => c.model)).toEqual([KIMI, KIMI, KIMI]);
    expect(sent.filter((c) => c.model === FLASH)).toHaveLength(1);
  });

  it("a call that names its own model is the caller's decision, and what serves it is held", async () => {
    const sent: Array<string | undefined> = [];
    const stream = stickyChildStream(async (opts) => {
      sent.push(opts.model);
      return { text: "", toolCalls: [], finishReason: "stop", resolvedModel: opts.model ?? FLASH };
    }, "code");
    await stream(call());
    await stream(call({ model: "claude-sonnet-5" }));
    await stream(call());
    expect(sent).toEqual([undefined, "claude-sonnet-5", "claude-sonnet-5"]);
  });
});

describe("sameModelTier", () => {
  it("matches a point release or a cut of the same family, never another family", () => {
    expect(sameModelTier("code", FLASH, M3)).toBe(true);
    expect(sameModelTier("explore", FLASH, M3)).toBe(true);
    expect(sameModelTier("code", FLASH, KIMI)).toBe(false);
    expect(sameModelTier("review", "claude-opus-5", "anthropic/claude-opus-5-5")).toBe(true);
    expect(sameModelTier("verify", "some-unknown-model", "another-unknown-model")).toBe(false);
  });
});
