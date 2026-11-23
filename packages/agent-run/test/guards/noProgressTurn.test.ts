/**
 * The no-progress breaker: a run whose calls keep being answered from its OWN read cache is circling. The counter
 * (`CacheServedStreak`) and the forced turn a due streak earns (`policy/guards/forced/turns.ts` `noProgressTurn`) both live in the
 * kernel. Ported from the Brain's `runStore/cacheServedStreak.test.ts`, with the same assertions about which turn is forced.
 */
import { describe, expect, it } from "vitest";
import { reduceRunPolicy } from "@builderforce/run-policy";
import { guardsTurnNote } from "../../src/policy/guards/index.js";
import { CACHE_SERVED_STREAK, CacheServedStreak, MAX_NO_PROGRESS_TURNS } from "../../src/policy/tools/cacheServedStreak.js";
import { QUESTION, SELECTED, ladderRun, names, type LadderRun } from "../support/forcedLadder.js";

/** `n` cache answers, two to a turn — a run circling over several turns. */
const circle = (run: LadderRun, n = CACHE_SERVED_STREAK): void => {
  for (let i = 0; i < n; i++) run.cache.served(Math.floor(i / 2));
};
const WITH_HAND_OFF = [...SELECTED, "hand_off"];

describe("CacheServedStreak", () => {
  it("counts cache answers and clears on a call the host ran", () => {
    const s = new CacheServedStreak();
    for (let i = 0; i < CACHE_SERVED_STREAK - 1; i++) s.served(i);
    s.ran();
    s.served(9);
    expect(s.count).toBe(1);
    expect(s.due()).toBe(false);
  });

  it("is not circling when one turn fans out every repeat", () => {
    const s = new CacheServedStreak();
    for (let i = 0; i < CACHE_SERVED_STREAK + 2; i++) s.served(4);
    expect(s.due()).toBe(false);
    s.served(5);
    expect(s.due()).toBe(true);
  });

  it(`is due at ${CACHE_SERVED_STREAK} in a row, at most ${MAX_NO_PROGRESS_TURNS} times a run`, () => {
    const s = new CacheServedStreak();
    let fired = 0;
    for (let round = 0; round < MAX_NO_PROGRESS_TURNS + 2; round++) {
      for (let i = 0; i < CACHE_SERVED_STREAK; i++) s.served(round * 10 + i);
      if (s.due()) {
        s.consume();
        fired++;
      }
    }
    expect(fired).toBe(MAX_NO_PROGRESS_TURNS);
  });
});

describe("the no-progress turn", () => {
  it("is nothing while the run is still making real calls", async () => {
    const run = ladderRun({ phase: "code", request: "complete the implementation" });
    circle(run, CACHE_SERVED_STREAK - 1);
    expect((await run.turn(3)).menu).toBeUndefined();
  });

  it("forces the hand-off while planning (chat #5739 run 5: 52 plan turns of cache answers)", async () => {
    const run = ladderRun({ phase: "plan", request: "complete the implementation" });
    circle(run);
    const { menu } = await run.turn(9, WITH_HAND_OFF);
    expect(names(menu?.tools)).toEqual(["hand_off"]);
    expect(menu?.toolChoice).toBe("required");
    expect(run.ctx.state.model.handOffForced).toBe(true);
    expect(run.events.some((e) => e.tool === "loop.no_progress")).toBe(true);
  });

  it("ends planning and forces the change once the forced hand-off was ignored", async () => {
    const run = ladderRun({ phase: "plan", request: "complete the implementation" });
    circle(run);
    await run.turn(9, SELECTED);
    circle(run);
    const { menu } = await run.turn(12, WITH_HAND_OFF);
    expect(run.ctx.state.model.phase).toBe("code");
    expect(names(menu?.tools)).toEqual(["edit_file", "write_file", "ask_user"]);
  });

  it("forces the change tools while coding", async () => {
    const run = ladderRun({ phase: "code", request: "complete the implementation" });
    circle(run);
    const { menu } = await run.turn(30);
    expect(names(menu?.tools)).toEqual(["edit_file", "write_file", "ask_user"]);
    expect(run.ctx.state.model.changeForced).toBe(true);
  });

  it("keeps the streak for a turn that can force the change", async () => {
    const run = ladderRun({ phase: "code", request: "complete the implementation" });
    circle(run);
    expect((await run.turn(30, ["read_file"])).menu).toBeUndefined();
    expect(names((await run.turn(31)).menu?.tools)).toEqual(["edit_file", "write_file", "ask_user"]);
  });

  it("never forces a run that has already made its change, or handed it off", async () => {
    const edited = ladderRun({ phase: "code", request: "complete the implementation", codeChanged: true });
    circle(edited);
    expect((await edited.turn(30)).menu).toBeUndefined();
    const handedOff = ladderRun({ phase: "code", request: "complete the implementation" });
    handedOff.facts.progressed = true;
    circle(handedOff);
    expect((await handedOff.turn(30)).menu).toBeUndefined();
  });

  it("never forces a review — verifying re-reads the author files by design", async () => {
    const run = ladderRun({ phase: "code", request: "complete the implementation" });
    run.ctx.state.model = reduceRunPolicy(run.ctx.state.model, { type: "verify_started" });
    circle(run);
    expect((await run.turn(30)).menu).toBeUndefined();
  });

  it("never forces a run that was asked a question", async () => {
    const run = ladderRun({ phase: "code", request: QUESTION });
    circle(run);
    expect((await run.turn(30)).menu).toBeUndefined();
  });

  it("names ask_user in the brief only when it is offered", async () => {
    const run = ladderRun({ phase: "code", request: "complete the implementation", canAskUser: false });
    circle(run);
    const { menu } = await run.turn(30);
    expect(names(menu?.tools)).toEqual(["edit_file", "write_file"]);
    expect(menu?.tail.join("\n")).not.toContain("ask_user");
  });
});

describe("the budgets' turns (the plan budget and the change budget)", () => {
  it("a planner that spent its analysis budget gets the hand-off turn alone, once; if it still does not hand off, planning ends", async () => {
    const run = ladderRun({ phase: "plan" });
    run.ctx.state.model = { ...run.ctx.state.model, planTurns: 20 };
    const first = await run.turn(21, WITH_HAND_OFF);
    expect(names(first.menu?.tools)).toEqual(["hand_off"]);
    expect(first.menu?.toolChoice).toBe("required");
    expect(run.events.some((e) => e.tool === "loop.hand_off_due")).toBe(true);
    const second = await run.turn(22, WITH_HAND_OFF);
    expect(run.ctx.state.model.phase).toBe("code");
    expect(second.menu).toBeUndefined();
    // Once coding, the plan is handed off: the hand-off tool is gone from the menu.
    expect(names(second.selected)).not.toContain("hand_off");
  });

  it("a coder that spent the same budget without changing anything is forced to change, once (STOP READING)", async () => {
    const run = ladderRun({ phase: "code", codeTurns: 40 });
    const first = await run.turn(41);
    expect(first.menu?.tail.join("\n")).toContain("STOP READING");
    expect(first.menu?.toolChoice).toBe("required");
    expect(run.events.some((e) => e.tool === "loop.change_due")).toBe(true);
    expect((await run.turn(42)).menu).toBeUndefined();
  });

  it("a QUICK pass is budgeted by a quick pass's length", async () => {
    const run = ladderRun({ phase: "code", codeTurns: 9, skipVerify: true });
    expect((await run.turn(10)).menu?.tail.join("\n")).toContain("STOP READING");
  });

  it("regression: chat #157440 — a finishing run gets its record turn before any change-only turn", async () => {
    const control = ladderRun({ phase: "code", codeTurns: 40, request: "Review the PRD and create tickets for the open items, then fix the first one" });
    expect((await control.turn(41)).menu?.tail.join("\n")).toContain("STOP READING");

    const OBLIGATION = ["builtin_tasks_create", "builtin_tasks_update", "builtin_tickets_from_delta"];
    const run = ladderRun({ phase: "code", codeTurns: 40, request: "Review the PRD and create tickets for the open items, then fix the first one", obligation: OBLIGATION });
    run.ctx.state.guards = { forced: { recordLeft: 2 } };
    const record = await run.turn(41);
    expect(names(record.menu?.tools).sort()).toEqual([...OBLIGATION].sort());
    expect(record.menu?.toolChoice).toBeUndefined();
    expect(record.menu?.final).toBeUndefined();
    expect(record.menu?.tail.join("\n")).not.toContain("STOP READING");
    expect(record.menu?.tail.join("\n")).toContain("You are FINISHING");
  });

  const stalled = () => ladderRun({ phase: "code", codeTurns: 40, request: "Review the PRD and create tickets for the open items, then fix the first one", obligation: ["builtin_tasks_create", "builtin_tasks_update"] });

  it("regression: chat #128305 — the finishing run's last (no-tool) turn is marked FINAL; its record turns are not, and finishing is sticky", async () => {
    const run = stalled();
    run.ctx.state.guards = { forced: { recordLeft: 1 } };
    expect(run.finishing()).toBe(false);
    const record = await run.turn(41);
    expect(names(record.menu?.tools).length).toBeGreaterThan(0);
    expect(record.menu?.final).toBeUndefined();
    expect(run.finishing()).toBe(true);
    const last = await run.turn(42);
    expect(last.menu?.tools).toEqual([]);
    expect(last.menu?.final).toBe(true);
    // The finish is spent, the run is not un-finished: a later ordinary menu leaves `finishing` set.
    await run.turn(43);
    expect(run.finishing()).toBe(true);
  });

  it("a finish / record turn never carries the steer note", async () => {
    const run = stalled();
    run.ctx.state.guards = { forced: { recordLeft: 1 }, progress: { steer: "PROGRESS CHECK steer: keep going" } };
    expect(guardsTurnNote(run.ctx)).toContain("PROGRESS CHECK steer");
    await run.turn(41);
    expect(guardsTurnNote(run.ctx)).not.toContain("PROGRESS CHECK steer");
  });
});
