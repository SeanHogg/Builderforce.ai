/**
 * A3's `finish` on the agent's guards (VS Code chat #146477): a run whose change is made
 * and verified that keeps idling is not escalated — after the first (asking)
 * steer, its next turn is the final report with no tools (`finalTurn`), and the detector's
 * note rides the turn's tail. The finish stays owed until that turn is answered.
 */
import { describe, expect, it } from "vitest";
import { NO_PROGRESS_TURNS } from "@builderforce/run-guards";
import { createGuardsHook, guardsTurnNote } from "../../src/policy/guards/index.js";
import { policyCtx } from "../support/policyContext.js";

describe("regression: chat #146477 — the guards bind A3's finish to a no-tools final turn", () => {
  it("regression: a verified run's second idle trip sets finalTurn; it is spent only by finalTurnDone", async () => {
    const events: Array<{ tool: string; result: string }> = [];
    const hook = createGuardsHook({ onEvent: async (e) => { events.push({ tool: e.tool, result: e.result }); } });
    const ctx = policyCtx({ policy: { levers: ["a3_progress_detector"] } });
    await hook.observe(ctx, { id: "e", name: "edit_file", args: { edits: [{ path: "src/a.ts", old_string: "x", new_string: "y" }] } }, { ok: true });
    await hook.endTurn?.(ctx, "");
    await hook.observe(ctx, { id: "t", name: "run_tests", args: {} }, { ok: true, passed: 4 });
    await hook.endTurn?.(ctx, "");
    for (let i = 0; i < 2 * NO_PROGRESS_TURNS; i++) {
      await hook.observe(ctx, { id: `s${i}`, name: "git_status", args: {} }, { ok: true, stdout: "" });
      await hook.endTurn?.(ctx, "");
    }
    expect(ctx.state.guards?.finishDue).toBe(true);
    expect(events.some((e) => /→ finish/.test(e.result))).toBe(true);
    expect(guardsTurnNote(ctx)).toMatch(/final report/i);

    // A peek: an eviction between the menu and the answer still owes the finish.
    expect(hook.finalTurn?.(ctx)).toBe(true);
    expect(hook.finalTurn?.(ctx)).toBe(true);
    hook.finalTurnDone?.(ctx);
    expect(ctx.state.guards?.finishDue).toBeUndefined();
    expect(hook.finalTurn?.(ctx)).toBe(false);
  });

  it("regression: a finish saved across a durable tick is still owed on the next turn", () => {
    const hook = createGuardsHook();
    const ctx = policyCtx({ policy: { levers: ["a3_progress_detector"] } });
    ctx.state.guards = { finishDue: true };
    expect(hook.finalTurn?.(ctx)).toBe(true);
    hook.finalTurnDone?.(ctx);
    expect(hook.finalTurn?.(ctx)).toBe(false);
  });
});

describe("regression: chat #157440 — the guards never ask a human whether to continue", () => {
  it("regression: chat #157440 — an escalation with no stronger model is a second steer; the third trip finishes on a no-tools report, no ask_human", async () => {
    const events: Array<{ tool: string; result: string }> = [];
    // No model / ladder ports: nothing stronger to move to.
    const hook = createGuardsHook({ onEvent: async (e) => { events.push({ tool: e.tool, result: e.result }); } });
    const ctx = policyCtx({ policy: { levers: ["a3_progress_detector"] } });
    const revertTurn = async (step: number) => {
      for (const [i, content] of ["A", "B", "A"].entries()) {
        await hook.observe(ctx, { id: `w${step}-${i}`, name: "write_file", args: { path: "notes.md", content } }, { ok: true });
      }
      await hook.endTurn?.(ctx, "");
    };
    await revertTurn(0);
    await revertTurn(1);
    // Trip 2: still the run's to finish — a second steer on the same model, never a claim of a stronger one.
    expect(hook.finalTurn?.(ctx)).toBe(false);
    expect(hook.beforeDispatch).toBeUndefined();
    const second = guardsTurnNote(ctx);
    expect(second).toContain("second warning");
    expect(second).not.toContain("stronger model");
    expect(second).toContain("notes.md");
    expect(events.at(-1)?.result).toBe("progress check 2: edit_revert → steer");
    // Trip 3: the run ends on its own honest report.
    await revertTurn(2);
    expect(hook.finalTurn?.(ctx)).toBe(true);
    expect(ctx.state.guards?.finishDue).toBe(true);
    const note = guardsTurnNote(ctx);
    expect(note).toMatch(/final report/i);
    expect(note).not.toContain("The work is done");
    expect(events.at(-1)?.result).toContain("→ finish (the run is not converging");
  });
});
