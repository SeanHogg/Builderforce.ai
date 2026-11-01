/**
 * The model hand-off keeps what the person said, tells the incoming model it took over on EVERY real change of serving model, keeps the
 * packer's role for the note, and charges what the request carries besides the transcript (its volatile tail).
 */

import { describe, expect, it } from "vitest";
import type { RunEvent, RunMessage, RunPorts } from "../../src/index.js";
import { handOff } from "../../src/policy/compaction/modelHandOff.js";
import { volatileTail } from "../../src/policy/compaction/pack.js";
import { measureTurnTail } from "../../src/turnTail.js";
import { policyCtx } from "../support/policyContext.js";

const WINDOWS: Record<string, number> = { "p/big": 200_000, "p/small": 16_384, "p/mid": 32_000 };

function ctxFor(messages: RunMessage[], serving = "p/small", from = "p/big") {
  const events: RunEvent[] = [];
  const ports: Partial<RunPorts> = {
    model: { complete: async () => ({ content: "" }), window: (model) => WINDOWS[model] },
    capabilities: { capabilities: new Set() },
    events: { emit: (e) => void events.push(e) },
  };
  const ctx = policyCtx({ policy: { modelHandoff: true, pinnedModel: serving, levers: [] }, messages, ports });
  ctx.state.preparedFor = from;
  return { ctx, events };
}

const history = (n: number, chars = 4_000, from = 0): RunMessage[] =>
  Array.from({ length: n }, (_, i): RunMessage => ({ role: (from + i) % 2 === 0 ? "assistant" : "user", content: `row ${from + i} ${"x".repeat(chars)}` }));

describe("what the person steered in survives a hand-off whole", () => {
  it("a steer in the middle of the history is kept; a stall's nudge in the same place is not", async () => {
    const steer: RunMessage = { role: "user", content: "STEER use b.ts instead", person: true };
    const nudge: RunMessage = { role: "user", content: "NUDGE you narrated, call a tool" };
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }, ...history(10), steer, ...history(2, 4_000, 10), nudge, ...history(30, 4_000, 12), { role: "user", content: "LATEST" }];
    const { ctx } = ctxFor(rows);

    const result = await handOff(ctx);

    expect(result!.dropped).toBeGreaterThan(0);
    const kept = result!.messages;
    expect(kept).toContain(steer);
    expect(kept.find((m) => m === steer)!.content).toBe("STEER use b.ts instead");
    expect(kept).not.toContain(nudge);
    expect(kept.some((m) => m.content === "TASK")).toBe(true);
  });

  it("a follow-up the person queued is kept the same way", async () => {
    const followUp: RunMessage = { role: "user", content: "FOLLOW-UP and then tidy up", person: true };
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }, ...history(10), followUp, ...history(40, 4_000, 11), { role: "user", content: "LATEST" }];
    const { ctx } = ctxFor(rows);

    expect((await handOff(ctx))!.messages).toContain(followUp);
  });
});

describe("every real change of serving model tells the incoming model it took over", () => {
  it("a context that fits is kept whole and gains ONE short row", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }, { role: "assistant", content: "ok" }, { role: "user", content: "LATEST" }];
    const { ctx } = ctxFor(rows);

    const result = await handOff(ctx);

    expect(result!.dropped).toBe(0);
    const added = result!.messages.filter((m) => !rows.includes(m));
    expect(added).toHaveLength(1);
    expect(added[0]!.content).toBe("Handed off from p/big to p/small.");
    // before the latest directive, which stays the last thing the person said
    expect(result!.messages.at(-1)!.content).toBe("LATEST");
    expect(added[0]!.role).toBe("assistant");
  });

  it("a context whose core cannot fit is still told, and is still said not to fit", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }, { role: "assistant", content: "ok" }, { role: "user", content: `LATEST ${"z".repeat(80_000)}` }];
    const { ctx, events } = ctxFor(rows);

    const result = await handOff(ctx);

    expect(result!.messages.some((m) => m.content === "Handed off from p/big to p/small.")).toBe(true);
    expect(events.find((e) => e.kind === "model.preflight")).toMatchObject({ status: "degraded" });
  });

  it("a walk 200K to 16K to 200K tells the model both times, though the second hand-off drops nothing", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }, ...history(40), { role: "user", content: "LATEST" }];
    const { ctx } = ctxFor(rows, "p/small", "p/big");

    const first = await handOff(ctx);
    expect(first!.dropped).toBeGreaterThan(0);
    expect(first!.messages.some((m) => m.content.includes("Handed off from p/big to p/small."))).toBe(true);

    (ctx as { messages: readonly RunMessage[] }).messages = first!.messages;
    ctx.state.model = { ...ctx.state.model, model: "p/big" };
    const second = await handOff(ctx);

    expect(second!.dropped).toBe(0);
    expect(second!.messages.some((m) => m.content === "Handed off from p/small to p/big.")).toBe(true);
  });

  it("the same model again is nothing to say", async () => {
    const { ctx } = ctxFor([{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }], "p/small", "p/small");
    expect(await handOff(ctx)).toBeUndefined();
  });

  it("a window the model does not declare is no reason to stay silent", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
    const { ctx } = ctxFor(rows, "p/unknown", "p/big");

    const result = await handOff(ctx);

    expect(result!.dropped).toBe(0);
    expect(result!.messages.some((m) => m.content === "Handed off from p/big to p/unknown.")).toBe(true);
  });
});

describe("the note keeps the packer's role", () => {
  const noteOf = (rows: RunMessage[]) => rows.find((m) => m.content.includes("Handed off from p/big to p/small."))!;

  it("before a directive that follows it the note is the assistant's, so task, note and directive do not run together as user rows", async () => {
    // the latest directive is followed by more of the model's work than the window holds: it is re-injected after the note
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }, ...history(10), { role: "user", content: "LATEST directive" }, ...Array.from({ length: 16 }, (_, i): RunMessage => ({ role: "assistant", content: `work ${i} ${"w".repeat(4_000)}` }))];
    const { ctx } = ctxFor(rows);

    const kept = (await handOff(ctx))!.messages.filter((m) => m.role !== "system");

    const at = kept.indexOf(noteOf(kept));
    expect(kept[at + 1]!.content).toBe("LATEST directive");
    expect(kept[at]!.role).toBe("assistant");
  });

  it("before an assistant turn the note is the user's", async () => {
    const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }, ...history(40), { role: "user", content: "LATEST" }];
    const { ctx } = ctxFor(rows);

    const kept = (await handOff(ctx))!.messages.filter((m) => m.role !== "system");

    const at = kept.indexOf(noteOf(kept));
    expect(kept[at + 1]!.role).toBe(kept[at]!.role === "user" ? "assistant" : "user");
  });
});

describe("the request's volatile tail is charged", () => {
  // about 11K tokens of rows against a 16K window less its 4K reserve: fits alone, and no longer fits beside a 3K tail
  const rows = (): RunMessage[] => [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }, ...history(10, 4_000), { role: "user", content: "LATEST" }];

  it("a context that fits alone is cut when the tail the last request carried does not leave it room", async () => {
    const without = ctxFor(rows());
    expect((await handOff(without.ctx))!.dropped).toBe(0);

    const withTail = ctxFor(rows());
    measureTurnTail(withTail.ctx.state, [...rows(), volatileTail([`## brief\n${"b".repeat(12_000)}`]) as unknown as RunMessage]);
    expect((await handOff(withTail.ctx))!.dropped).toBeGreaterThan(0);
  });
});
