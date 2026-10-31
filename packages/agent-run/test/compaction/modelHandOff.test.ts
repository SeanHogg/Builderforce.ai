/**
 * The model hand-off (`policy/compaction/modelHandOff`): the context a failover inherits is measured WHOLE (thinking blocks and
 * pictures, not just text), packed for the incoming window under the run's ONE reply reserve, and a context that cannot fit is said.
 */

import { reduceRunPolicy } from "@builderforce/run-policy";
import { describe, expect, it } from "vitest";
import type { RunEvent, RunMessage, RunPorts } from "../../src/index.js";
import { handOff } from "../../src/policy/compaction/modelHandOff.js";
import { compactionOptions } from "../../src/policy/compaction/index.js";
import { replyReserve } from "../../src/policy/compaction/reserve.js";
import { modelHook } from "../../src/policy/model/index.js";
import { policyCtx } from "../support/policyContext.js";

function ctxFor(window: number, messages: RunMessage[], over: { levers?: "c9_price_tier_budget"[]; pinnedModel?: string; handoff?: boolean; tools?: string[] } = {}) {
  const events: RunEvent[] = [];
  const ports: Partial<RunPorts> = {
    model: { complete: async () => ({ content: "" }), window: () => window },
    capabilities: { capabilities: new Set() },
    events: { emit: (e) => void events.push(e) },
  };
  const ctx = policyCtx({
    policy: { ...(over.handoff === false ? {} : { modelHandoff: {} }), pinnedModel: over.pinnedModel ?? "p/small", levers: over.levers ?? [] },
    messages,
    ports,
    ...(over.tools ? { tools: over.tools } : {}),
  });
  ctx.state.preparedFor = "p/big";
  return { ctx, events };
}

const shot = (n: number): string => `data:image/png;base64,${"A".repeat(n)}`;

describe("a hand-off measures the whole row", () => {
  it("a screenshot-heavy transcript does not look like it fits because its text does", async () => {
    // six rows of ~50K tokens of picture each, a few words of text: 300K tokens against a 128K window
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    for (let i = 0; i < 6; i += 1) {
      rows.push({ role: "assistant", content: `screenshot ${i}`, parts: [{ type: "image", url: shot(200_000) }] });
      rows.push({ role: "user", content: "next" });
    }
    const { ctx } = ctxFor(128_000, rows);

    const result = await handOff(ctx);

    expect(result).toBeTruthy();
    expect(result!.dropped).toBeGreaterThan(0);
    expect(result!.beforeTokens!).toBeGreaterThan(250_000);
    expect(result!.afterTokens!).toBeLessThanOrEqual(128_000 - result!.reserveTokens!);
    // the task survives the cut whole
    expect(result!.messages.some((m) => m.content === "TASK")).toBe(true);
  });

  it("a thinking-heavy transcript is measured too", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    for (let i = 0; i < 8; i += 1) {
      rows.push({ role: "assistant", content: "ok", parts: [{ type: "thinking", thinking: "z".repeat(60_000) }] });
      rows.push({ role: "user", content: "next" });
    }
    const { ctx } = ctxFor(64_000, rows);

    const result = await handOff(ctx);

    expect(result?.dropped).toBeGreaterThan(0);
  });

  it("a transcript that fits its text AND its pictures is left alone", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }, { role: "assistant", content: "one", parts: [{ type: "image", url: shot(4_000) }] }];
    const { ctx } = ctxFor(128_000, rows);
    expect(await handOff(ctx)).toBeUndefined();
  });
});

describe("a hand-off under the long-context price tier (cost lever C9)", () => {
  // ~130K tokens: inside a 1M window, past claude-haiku-5-5's 100K price boundary
  const big = (): RunMessage[] => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    for (let i = 0; i < 26; i += 1) {
      rows.push({ role: "assistant", content: "", toolCalls: [{ id: `c${i}`, name: "read_file", arguments: "{}" }] });
      rows.push({ role: "tool", toolCallId: `c${i}`, content: "X".repeat(20_000) });
    }
    return rows;
  };

  it("packs under the boundary when the run's policy carries the lever", async () => {
    const { ctx } = ctxFor(1_000_000, big(), { levers: ["c9_price_tier_budget"], pinnedModel: "claude-haiku-5-5" });
    expect((await handOff(ctx))?.dropped).toBeGreaterThan(0);
  });

  it("fills the window when it does not", async () => {
    const { ctx } = ctxFor(1_000_000, big(), { pinnedModel: "claude-haiku-5-5" });
    expect(await handOff(ctx)).toBeUndefined();
  });
});

describe("a context that cannot fit is said", () => {
  it("the system prompt alone is larger than the window: a degraded notice, not silence", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "s".repeat(40_000) }, { role: "user", content: "TASK", task: true }, { role: "assistant", content: "a" }, { role: "user", content: "b" }];
    const { ctx, events } = ctxFor(2_000, rows);

    await handOff(ctx);

    const notice = events.find((e) => e.kind === "model.preflight");
    expect(notice).toMatchObject({ kind: "model.preflight", status: "degraded" });
  });

  it("nothing is said when it fits", async () => {
    const { ctx, events } = ctxFor(128_000, [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }]);
    await handOff(ctx);
    expect(events).toEqual([]);
  });
});

describe("one reply reserve per run", () => {
  // a run that has begun the work (handed from plan to code) asks as the code role: its reply cap is 8,192
  const askOf = async (window: number, over: Parameters<typeof ctxFor>[2] = {}) => {
    const { ctx } = ctxFor(window, [], { tools: ["read"], ...over });
    ctx.state.model = reduceRunPolicy(ctx.state.model, { type: "hand_off" });
    return { ctx, reserve: replyReserve(ctx), asks: (await modelHook.resolve(ctx))?.maxTokens };
  };

  it("holds back on-prem's floor within a quarter of the serving window, and asks the role cap unless the window forces less", async () => {
    expect(await askOf(200_000).then((r) => [r.reserve, r.asks])).toEqual([20_000, 8_192]);
    expect(await askOf(64_000).then((r) => [r.reserve, r.asks])).toEqual([16_000, 8_192]);
    expect(await askOf(16_384).then((r) => [r.reserve, r.asks])).toEqual([4_096, 4_096]);
  });

  it("compaction and the hand-off hold back the very number replyReserve names", async () => {
    for (const window of [200_000, 64_000, 16_384]) {
      const { ctx, reserve } = await askOf(window);
      expect(compactionOptions(ctx).reserveOutputTokens).toBe(reserve);
    }
  });

  it("a big window asks for the role cap it always asked for: the same as a run that does not hand off", async () => {
    expect((await askOf(1_000_000)).asks).toBe((await askOf(1_000_000, { handoff: false })).asks);
  });

  it("a run that does not hand off keeps the reserve its policy states, or the host-neutral floor", () => {
    const { ctx } = ctxFor(16_384, [], { handoff: false });
    expect(replyReserve(ctx)).toBe(20_000);
    ctx.policy.budgets.reserveTokens = 4_000;
    expect(replyReserve(ctx)).toBe(4_000);
  });

  it("what a hand-off reports as held back is that same reserve", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    for (let i = 0; i < 24; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(4_000)}` });
    const { ctx } = ctxFor(16_384, rows);
    const result = await handOff(ctx);
    expect(result?.reserveTokens).toBe(replyReserve(ctx));
  });
});
