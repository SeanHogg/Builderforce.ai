/**
 * A3's forced-turn ladder (`policy/guards/forced`): which turn a trip forces, on the editor's vocabulary the surface binds as data.
 * Ported from the Brain's `RunProgressGuard` / `progressGuardTurn` tests (`progressGuard.ladder|finish|inlineHandOff|test.ts`) with the same
 * assertions about the turn that is forced — the Brain no longer owns the ladder; the kernel does.
 */
import { describe, expect, it } from "vitest";
import { initialRunPolicy, offersHandOff } from "@builderforce/run-policy";
import { createGuardsHook, guardsTurnNote } from "../../src/policy/guards/index.js";
import { policyCtx } from "../support/policyContext.js";
import { QUESTION, READY, ladderRun, names, tripFinish } from "../support/forcedLadder.js";

describe("the ladder on the editor", () => {
  it("forces the change tools on a change request when the escalation is due", async () => {
    const run = ladderRun();
    for (let i = 0; i < 4; i++) await run.unkept(i);
    const { menu } = await run.turn(4);
    expect(names(menu?.tools)).toEqual(["edit_file", "write_file", "ask_user"]);
    expect(menu?.toolChoice).toBe("required");
    expect(run.forced()).toHaveLength(1);
  });

  it("steers a question run instead of forcing it to change anything", async () => {
    const run = ladderRun({ request: QUESTION });
    for (let i = 0; i < 4; i++) await run.unkept(i);
    expect((await run.turn(4)).menu).toBeUndefined();
    expect(guardsTurnNote(run.ctx)).toContain("PROGRESS CHECK 2");
    expect(run.forced()).toHaveLength(0);
    expect(run.ctx.state.model).toEqual(initialRunPolicy({ startPhase: "code" }));
  });

  it("regression: chat #157440 — a change request that changed nothing gets ONE forced change turn at trip 3, then the next trip finishes: no tools, never ask_user", async () => {
    for (const canAskUser of [true, false]) {
      const run = ladderRun({ canAskUser });
      for (let i = 0; i < 4; i++) await run.unkept(i);
      await run.turn(4);
      for (let i = 4; i < 6; i++) await run.unkept(i);
      // Trip 3: the run can still do the work — the finish is deferred once for the change tools.
      const deferred = (await run.turn(6)).menu;
      expect(names(deferred?.tools)).toContain("edit_file");
      // The guard's own forced turn never offers a question.
      expect(names(deferred?.tools)).not.toContain("ask_user");
      expect(deferred?.tail.join("\n")).not.toContain("ask_user");
      expect(deferred?.toolChoice).toBe("required");
      // Trip 4: really finishes.
      for (let i = 6; i < 8; i++) await run.unkept(i);
      const turn = (await run.turn(8)).menu;
      expect(turn?.tools).toEqual([]);
      expect(turn?.toolChoice).toBeUndefined();
      const brief = turn?.tail.join("\n") ?? "";
      expect(brief).toContain("final report");
      expect(brief).not.toContain("The work is done");
      expect(brief).not.toContain("Stop the run");
      expect(run.forced().map((e) => e.forced)).toEqual(["change", "change", "finish"]);
    }
  });

  it("regression: chat #157440 — a planner whose menu has no edit tool: planning ends, the run is steered, and the next turn is code", async () => {
    const run = ladderRun({ phase: "plan" });
    expect(offersHandOff(run.ctx.state.model)).toBe(true);
    const planMenu = ["read_file", "search_code", "hand_off"];
    for (let i = 0; i < 4; i++) await run.unkept(i);
    await run.turn(4, planMenu);
    for (let i = 4; i < 6; i++) await run.unkept(i);
    // Trip 3: nothing to force on a plan menu — no finish, no forced turn: planning ends and the advice opens the turn.
    expect((await run.turn(6, planMenu)).menu).toBeUndefined();
    expect(offersHandOff(run.ctx.state.model)).toBe(false);
    expect(run.ctx.state.model.phase).toBe("code");
    expect(guardsTurnNote(run.ctx)).toContain("PROGRESS CHECK 3");
    expect(run.events.some((e) => e.tool === "loop.plan_budget_spent")).toBe(true);
    expect(run.forced().some((e) => e.forced === "finish")).toBe(false);
    // The deferral is spent: the next trip really finishes.
    for (let i = 6; i < 8; i++) await run.unkept(i);
    expect((await run.turn(8)).menu?.tools).toEqual([]);
  });

  it("regression: chat #157440 — a run that already changed code is not deferred: its third trip finishes", async () => {
    const run = ladderRun({ codeChanged: true });
    for (let i = 0; i < 6; i++) {
      await run.unkept(i);
      if (i === 3) await run.turn(4);
    }
    expect((await run.turn(6)).menu?.tools).toEqual([]);
  });
});

describe("regression: chat #146477 — escalation never forces an edit on a run that already changed code", () => {
  it("a run that has codeChanged is steered, never forced; one that has not is forced to change", async () => {
    const changed = ladderRun({ codeChanged: true });
    for (let i = 0; i < 4; i++) await changed.unkept(i);
    expect((await changed.turn(4)).menu).toBeUndefined();
    expect(guardsTurnNote(changed.ctx)).toContain("PROGRESS CHECK 2");
    const fresh = ladderRun();
    for (let i = 0; i < 4; i++) await fresh.unkept(i);
    expect(fresh.forced()).toEqual([]);
    expect(names((await fresh.turn(4)).menu?.tools)).toContain("edit_file");
    expect(fresh.forced().map((e) => e.forced)).toEqual(["change"]);
  });

  it("a run that handed off but changed nothing itself is still forced", async () => {
    const run = ladderRun();
    run.facts.progressed = true;
    for (let i = 0; i < 4; i++) await run.unkept(i);
    expect(run.forced().map((e) => e.forced)).toEqual([]);
    expect((await run.turn(4)).menu?.toolChoice).toBe("required");
    expect(run.forced().map((e) => e.forced)).toEqual(["change"]);
  });

  it("a verified run that goes idle finishes with a no-tools turn that requires no call and carries the final-report note", async () => {
    const run = ladderRun({ codeChanged: true });
    await tripFinish(run);
    const turn = (await run.turn(11)).menu;
    expect(turn?.tools).toEqual([]);
    expect(turn?.toolChoice).toBeUndefined();
    expect(turn?.tail.join("\n")).toMatch(/final report/i);
    expect(turn?.final).toBe(true);
    // The note is the turn's brief — not shown again as a steer.
    expect(guardsTurnNote(run.ctx)).toBe("");
    expect(run.forced().map((e) => e.forced)).toEqual(["finish"]);
    // Taken once.
    expect((await run.turn(12)).menu).toBeUndefined();
  });
});

describe("regression: chat #157440 — a forced finish offers only the obligation tools", () => {
  const OBLIGATION = ["builtin_tasks_create", "builtin_tasks_update", "builtin_tickets_from_delta", "builtin_chats_list_tickets"];
  it("the finish turn offers the ticket obligations, no write/exec/ask tool, and says to file what is still open", async () => {
    const run = ladderRun({ codeChanged: true, obligation: OBLIGATION });
    await tripFinish(run);
    const turn = (await run.turn(11)).menu;
    expect(names(turn?.tools).sort()).toEqual([...OBLIGATION].sort());
    for (const banned of ["edit_file", "write_file", "run_command", "read_file", "ask_user", "builtin_kanban_coordinate"]) expect(names(turn?.tools)).not.toContain(banned);
    expect(turn?.toolChoice).toBeUndefined();
    const brief = turn?.tail.join("\n") ?? "";
    expect(brief).toMatch(/final report/i);
    expect(brief).toMatch(/file a ticket for EVERY item/i);
    expect(brief).toMatch(/no more code changes/i);
    expect(run.forced().map((e) => e.recordTools)).toEqual([OBLIGATION.length]);
  });

  it("finish stays finish — later turns offer only the obligations, then nothing", async () => {
    const run = ladderRun({ codeChanged: true, obligation: OBLIGATION });
    await tripFinish(run);
    expect(names((await run.turn(11)).menu?.tools)).toHaveLength(OBLIGATION.length);
    for (let i = 1; i < 3; i++) {
      // A ticket call ran; even a new trip never reopens the full menu.
      await run.call("builtin_tasks_create", { title: `item ${i}` }, { ok: true, id: i });
      await run.endTurn();
      expect(names((await run.turn(11 + i)).menu?.tools).sort()).toEqual([...OBLIGATION].sort());
    }
    const last = (await run.turn(20)).menu;
    expect(last?.tools).toEqual([]);
    expect(last?.tail.join("\n")).toMatch(/final report/i);
    // The finish is spent: an ordinary turn again only if something new is due.
    expect((await run.turn(21)).menu).toBeUndefined();
  });

  it("a run with no obligations (chat mode, no ticket tools) still finishes with no tools", async () => {
    const run = ladderRun({ codeChanged: true });
    await tripFinish(run);
    expect((await run.turn(11)).menu?.tools).toEqual([]);
    expect((await run.turn(12)).menu).toBeUndefined();
  });
});

describe("regression: chat #165961 — a coder after an INLINE hand-off owes the change", () => {
  /** The planner's two trips (steer, then the escalation its forced hand-off took) are spent; the run handed off. */
  async function handedOffRun(inline: boolean) {
    const run = ladderRun({ request: "fix the regression where an interrupted run loses its title, and add unit tests" });
    for (let i = 0; i < 4; i++) await run.unkept(i);
    // Nothing to force on this menu: the escalation is taken (and steered), so only the coder's trips remain.
    await run.turn(5, ["read_file"]);
    run.facts.progressed = !inline;
    return run;
  }
  const stallCoder = async (run: Awaited<ReturnType<typeof handedOffRun>>, from: number) => {
    for (let i = from; i < from + 2; i++) await run.unkept(100 + i);
  };

  it("the coder that stops with zero edits is not accepted: its finish is deferred for ONE forced change turn, then the run ends cleanly on a no-tool final report", async () => {
    const run = await handedOffRun(true);
    await stallCoder(run, 0);
    const deferred = (await run.turn(20)).menu;
    expect(deferred?.final).toBeUndefined();
    expect(names(deferred?.tools)).toEqual(["edit_file", "write_file"]);
    expect(deferred?.toolChoice).toBe("required");
    expect(run.finishing()).toBe(false);
    // The next trip really finishes: no tools, the run's final report (chat #128305 — never sent back by a gate).
    await stallCoder(run, 2);
    const final = (await run.turn(23)).menu;
    expect(final?.tools).toEqual([]);
    expect(final?.final).toBe(true);
    expect(run.finishing()).toBe(true);
  });

  it("a fan-out hand-off still finishes at its coder's trip 3 (the coders made the change)", async () => {
    const run = await handedOffRun(false);
    await stallCoder(run, 0);
    const turn = (await run.turn(20)).menu;
    expect(turn?.tools).toEqual([]);
    expect(turn?.final).toBe(true);
  });
});

describe("the detector the ladder runs", () => {
  it("keeps an escalation due until a turn takes it, whatever the turns in between", async () => {
    const run = ladderRun();
    for (let i = 0; i < 4; i++) await run.unkept(i);
    // A budget forced the next turn, so nothing took the escalation; a quiet turn follows.
    await run.call("edit_file", { path: "src/a.ts", old_string: "a", new_string: "b" });
    await run.endTurn("");
    expect(run.ctx.state.guards?.forced?.due).toMatchObject({ kind: "escalate", signal: { kind: "unkept_ready" } });
    await run.turn(5, ["read_file"]);
    expect(run.ctx.state.guards?.forced?.due).toBeUndefined();
  });

  it("never shows the detector's 'stronger model' note: the editor forces a turn instead", async () => {
    const run = ladderRun();
    for (let i = 0; i < 4; i++) await run.unkept(i);
    expect(guardsTurnNote(run.ctx)).not.toContain("stronger model");
  });

  it("a hand-off after the claim clears the count", async () => {
    const run = ladderRun();
    await run.unkept(0);
    await run.call("hand_off", { summary: "s", tasks: [{ title: "t" }] });
    await run.endTurn(READY);
    // The count started over: one more unkept claim is the first again, not a trip.
    await run.unkept(1);
    expect(run.actions()).toEqual([]);
  });

  it("is inert with the lever off: no trip, no steer — the budgets still hold", async () => {
    const run = ladderRun({ lever: false });
    for (let i = 0; i < 8; i++) await run.unkept(i);
    expect(run.actions()).toEqual([]);
    expect(guardsTurnNote(run.ctx)).toBe("");
    expect((await run.turn(8)).menu).toBeUndefined();
  });

  it("trace rows tell the surface the kernel step they belong to", async () => {
    const rows: Array<{ tool: string; step?: number }> = [];
    const hook = createGuardsHook({
      onEvent: (row, at) => { rows.push({ tool: row.tool, step: at?.step }); },
      progress: {
        facts: { budgeted: () => true, codeChanged: () => false, progressed: () => false, canAskUser: () => true, obligationTools: () => [] },
        turns: { handOffTool: "hand_off", askTool: "ask_user", recordTurns: 3 },
      },
    });
    const ctx = policyCtx({ policy: { levers: ["a3_progress_detector"] } });
    ctx.step = 3;
    await hook.observe(ctx, { id: "r1", name: "read_file", args: { path: "f0.ts" } }, { ok: true });
    await hook.endTurn!(ctx, READY);
    expect(rows).toEqual([{ tool: "loop.progress_advisory", step: 3 }]);
  });
});
