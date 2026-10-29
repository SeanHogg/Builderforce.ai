/**
 * The delegation nudge (WS8c) and the end-of-run backstop, through the sub-agents hook:
 * the nudge rides the read result that reaches `readsBeforeNudge`, once per run; the
 * backstop holds a settle while a requested delegation is undone.
 */
import { describe, expect, it } from "vitest";
import type { RunMessage } from "../../src/contract.js";
import { delegationBackstop, delegationNudge, subagentsHook } from "../../src/policy/subagents/index.js";
import { policyCtx } from "../support/policyContext.js";

const SPAWNING = ["read_file", "spawn_agent", "spawn_agents"];

function reads(n: number): RunMessage[] {
  const rows: RunMessage[] = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({ role: "assistant", content: "", toolCalls: [{ id: `r${i}`, name: "read_file", arguments: JSON.stringify({ path: `f${i}.ts` }) }] });
    rows.push({ role: "tool", toolCallId: `r${i}`, content: "{}" });
  }
  return rows;
}

const requested = { delegation: { requested: true, readsBeforeNudge: 3 } };

describe("delegationNudge", () => {
  it("fires once the run made readsBeforeNudge reads with no spawn — once per run", () => {
    const early = policyCtx({ policy: requested, tools: SPAWNING, messages: reads(2) });
    expect(delegationNudge(early)).toBeNull();
    const due = policyCtx({ policy: requested, tools: SPAWNING, messages: reads(3) });
    expect(delegationNudge(due)).toContain("STOP READING AND DELEGATE");
    expect(delegationNudge(due)).toBeNull();
  });

  it("is quiet when delegation was not requested, or the host cannot spawn", () => {
    expect(delegationNudge(policyCtx({ tools: SPAWNING, messages: reads(9) }))).toBeNull();
    expect(delegationNudge(policyCtx({ policy: requested, tools: ["read_file"], messages: reads(9) }))).toBeNull();
  });
});

describe("subagentsHook.nudge — on the read result", () => {
  it("attaches the advisory to the read that earned it, and leaves other calls alone", () => {
    const ctx = policyCtx({ policy: requested, tools: SPAWNING, messages: reads(3) });
    expect(subagentsHook.nudge(ctx, { id: "w", name: "write_file", args: {} }, { ok: true })).toBeUndefined();
    const nudged = subagentsHook.nudge(ctx, { id: "r2", name: "read_file", args: {} }, { ok: true, content: "x" });
    expect(nudged?.data).toMatchObject({ ok: true, content: "x" });
    expect(String((nudged?.data as { advisory?: string }).advisory)).toContain("STOP READING AND DELEGATE");
  });
});

describe("delegationBackstop", () => {
  it("names the spawn call while nothing has spawned, and clears once one was attempted", () => {
    const undone = policyCtx({ policy: requested, tools: SPAWNING });
    expect(delegationBackstop(undone)).toContain("spawn_agents");
    const spawned = policyCtx({
      policy: requested,
      tools: SPAWNING,
      messages: [{ role: "assistant", content: "", toolCalls: [{ id: "s", name: "spawn_agent", arguments: "{}" }] }],
    });
    expect(delegationBackstop(spawned)).toBeNull();
  });

  it("is the sub-agents module's own backstop", () => {
    expect(subagentsHook.backstop).toBe(delegationBackstop);
  });
});
