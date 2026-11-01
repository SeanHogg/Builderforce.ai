/**
 * The model hand-off (`policy/compaction/modelHandOff`): the context a failover inherits is measured WHOLE (thinking blocks and
 * pictures, not just text), packed for the incoming window under the run's ONE reply reserve, and a context that cannot fit is said.
 */

import { reduceRunPolicy } from "@builderforce/run-policy";
import { describe, expect, it } from "vitest";
import type { RunEvent, RunMessage, RunPorts } from "../../src/index.js";
import { handOff } from "../../src/policy/compaction/modelHandOff.js";
import { compactionHook } from "../../src/policy/compaction/index.js";
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
    policy: { ...(over.handoff === false ? {} : { modelHandoff: true }), pinnedModel: over.pinnedModel ?? "p/small", levers: over.levers ?? [] },
    messages,
    ports,
    ...(over.tools ? { tools: over.tools } : {}),
  });
  ctx.state.preparedFor = "p/big";
  return { ctx, events };
}

const shot = (n: number): string => `data:image/png;base64,${"A".repeat(n)}`;

/** A hand-off that dropped nothing: every row is kept, and the incoming model is told it took over by one extra row. */
function expectKeptWhole(result: Awaited<ReturnType<typeof handOff>>, rows: readonly RunMessage[]): void {
  expect(result?.dropped).toBe(0);
  const kept = result!.messages;
  expect(rows.every((row) => kept.includes(row))).toBe(true);
  expect(kept.filter((m) => !rows.includes(m)).map((m) => m.content)).toEqual(["Handed off from p/big to p/small."]);
}

describe("a hand-off measures the whole row", () => {
  it("a screenshot-heavy transcript does not look like it fits because its text does", async () => {
    // 80 screenshots at one fixed estimate each (2,000 tokens) is 160K tokens against a 128K window, with a few words of text apiece
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    for (let i = 0; i < 80; i += 1) {
      rows.push({ role: "assistant", content: `screenshot ${i}`, parts: [{ type: "image", url: shot(2_000) }] });
      rows.push({ role: "user", content: "next" });
    }
    const { ctx } = ctxFor(128_000, rows);

    const result = await handOff(ctx);

    expect(result).toBeTruthy();
    expect(result!.dropped).toBeGreaterThan(0);
    expect(result!.beforeTokens!).toBeGreaterThan(150_000);
    expect(result!.afterTokens!).toBeLessThanOrEqual(128_000 - result!.reserveTokens!);
    // the task survives the cut whole
    expect(result!.messages.some((m) => m.content === "TASK")).toBe(true);
  });

  it("a picture costs one fixed estimate, never its base64 length: a photo cannot evict the history", async () => {
    // a 5 MB photo among a handful of rows: ~1.3M tokens if its bytes were counted, 2,000 at the estimate
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    for (let i = 0; i < 6; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i}` });
    rows.push({ role: "assistant", content: "photo", parts: [{ type: "image", url: shot(5_000_000) }] });
    rows.push({ role: "user", content: "what is in it?" });
    const { ctx } = ctxFor(128_000, rows);

    expectKeptWhole(await handOff(ctx), rows);
  });

  it("a row's text is counted once, though a channel row carries it in its parts too", async () => {
    // real shape: text in `content` AND in a text part. 30 rows of 20K chars (5K tokens) is 150K once, 300K twice; the window is 200K.
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    for (let i = 0; i < 30; i += 1) {
      const text = `row ${i} ${"x".repeat(20_000)}`;
      rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: text, parts: [{ type: "text", text }] });
    }
    const { ctx } = ctxFor(200_000, rows);
    expectKeptWhole(await handOff(ctx), rows);
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
    expectKeptWhole(await handOff(ctx), rows);
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
    const rows = big();
    const { ctx } = ctxFor(1_000_000, rows, { pinnedModel: "claude-haiku-5-5" });
    expect((await handOff(ctx))?.dropped).toBe(0);
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
  const askOf = async (window: number, over: Parameters<typeof ctxFor>[2] = {}) => {
    const { ctx } = ctxFor(window, [], { tools: ["read"], ...over });
    return { ctx, reserve: replyReserve(ctx), asks: (await modelHook.resolve(ctx))?.maxTokens };
  };

  it("holds back on-prem's floor within a quarter of the serving window, and asks for nothing unless the window forces it", async () => {
    expect(await askOf(200_000).then((r) => [r.reserve, r.asks])).toEqual([20_000, undefined]);
    expect(await askOf(64_000).then((r) => [r.reserve, r.asks])).toEqual([16_000, 16_000]);
    expect(await askOf(16_384).then((r) => [r.reserve, r.asks])).toEqual([4_096, 4_096]);
  });

  it("the hand-off holds back the very number replyReserve names", async () => {
    for (const window of [200_000, 64_000, 16_384]) {
      const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
      for (let i = 0; i < 140; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(8_000)}` });
      const { ctx } = ctxFor(window, rows);
      expect((await handOff(ctx))?.reserveTokens).toBe(replyReserve(ctx));
    }
  });

  it("a run that hands off asks for no cap of its own where a run that does not asks for its role's", async () => {
    expect((await askOf(1_000_000)).asks).toBeUndefined();
    expect((await askOf(1_000_000, { handoff: false })).asks).toBeGreaterThan(0);
  });

  it("a run that does not hand off keeps the reserve its policy states, or the host-neutral floor", () => {
    const { ctx } = ctxFor(16_384, [], { handoff: false });
    expect(replyReserve(ctx)).toBe(20_000);
    ctx.policy.budgets.reserveTokens = 4_000;
    expect(replyReserve(ctx)).toBe(4_000);
  });
});

describe("a run that hands off between models runs no ordinary compaction", () => {
  const long = (): RunMessage[] => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    // ~45K tokens against a 32K window: an ordinary compaction would fold it (and ask the model for a summary)
    for (let i = 0; i < 45; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(4_000)}` });
    return rows;
  };

  it("an over-window transcript is left to the session while the serving model is the same: no fold, no summary call", async () => {
    const { ctx } = ctxFor(32_000, long());
    ctx.state.preparedFor = "p/small";
    let summaries = 0;
    ctx.ports.model.summarize = async () => { summaries += 1; return { content: "SUMMARY" }; };
    ctx.ports.model.complete = async () => { summaries += 1; return { content: "SUMMARY" }; };

    expect(await compactionHook.compact(ctx)).toBeUndefined();
    expect(summaries).toBe(0);
  });

  it("the same transcript, in a run that does not hand off, IS folded", async () => {
    const { ctx } = ctxFor(32_000, long(), { handoff: false });
    expect(await compactionHook.compact(ctx)).toBeTruthy();
  });

  it("a change of serving model still re-packs for the incoming window, with no summary call", async () => {
    const { ctx } = ctxFor(32_000, long());
    let summaries = 0;
    ctx.ports.model.summarize = async () => { summaries += 1; return { content: "SUMMARY" }; };
    const result = await compactionHook.compact(ctx);
    expect(result?.dropped).toBeGreaterThan(0);
    expect(summaries).toBe(0);
  });
});

/** A bash execution as a channel run holds it (`toRunRow` over the runner's `bashExecution` message): the row's text IS what the model is sent, `$ command` then the output. */
const bashRow = (command: string, output: string): RunMessage => ({
  role: "user",
  content: `$ ${command}\n${output}`,
  custom: true,
  meta: { agentMessage: { role: "bashExecution", command, output, exitCode: 0, cancelled: false, truncated: false, timestamp: 1 } },
});

describe("a surface's custom row is never the latest directive", () => {
  it("the real user request survives the cut whole; a bash-output row read as `user` does not displace it", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    for (let i = 0; i < 40; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(4_000)}` });
    rows.push({ role: "user", content: "THE LATEST REAL REQUEST" });
    rows.push({ role: "assistant", content: "on it" });
    rows.push(bashRow("npm run build", "b".repeat(60_000)));
    const { ctx } = ctxFor(32_000, rows);

    const result = await handOff(ctx);

    expect(result?.messages.some((m) => m.content === "THE LATEST REAL REQUEST")).toBe(true);
  });

  it("a custom row is not the task when the transcript marks none", async () => {
    const rows: RunMessage[] = [
      { role: "system", content: "sys" },
      bashRow("ls", "bash output"),
      { role: "user", content: "THE REQUEST" },
    ];
    for (let i = 0; i < 40; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(4_000)}` });
    const { ctx } = ctxFor(32_000, rows);

    const result = await handOff(ctx);

    expect(result?.messages.some((m) => m.content === "THE REQUEST")).toBe(true);
  });
});
