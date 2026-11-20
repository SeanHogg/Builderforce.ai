import { describe, expect, it } from "vitest";
import { ProgressDetector, type ProgressAction, type ProgressDetectorPorts } from "./progressDetector.js";
import { NO_PROGRESS_TURNS, NoProgressTracker } from "./noProgress.js";
import { READ_ONLY_STREAK_TURNS } from "./readOnlyStreak.js";
import { MAX_WAIT_TURNS } from "./waitCeiling.js";
import { EditRevertTracker } from "./editRevert.js";
import { isReadOnlyShellCall } from "./readOnlyShell.js";
import { progressTraceStep } from "./progressTrace.js";
import { isVcsBookkeeping, runsCheck } from "./checkCommand.js";

// VS Code chat #146477 (VSIX 2026.10.186): a correct, type-checked change was tripped three
// times and parked on ask_user — batched edits were invisible, the background tsc's passing
// result (polled via command_status) was not a check, and the finished run's wrap-up read as
// a stall. These ports are a faithful local stand-in for brain-embedded's RunProgressGuard
// (`isReadOnlyCall`, `isUnscopedMutation`, `isMutatingPlatformTool`, `expectsChange`).

const DEDUP_READS = new Set(["read_file", "search_code", "list_files", "find_symbol", "file_outline", "semantic_search", "repo_map", "read_compressed", "local_research", "recall_facts"]);
const READ_ONLY_PLATFORM_SUFFIXES = ["_list", "_get", "_search", "_list_tickets", "_read", "_query"];
const UNSCOPED_MUTATION_TOOLS = new Set(["run_command", "canvas_run_build_command", "git_sync_latest", "git_undo", "git_redo", "git_cleanup_merged"]);
const isReadOnlyPlatform = (t: string) => t.startsWith("builtin_") && READ_ONLY_PLATFORM_SUFFIXES.some((s) => t.endsWith(s));

const brainPorts: ProgressDetectorPorts = {
  isReadOnly: (tool, args) => DEDUP_READS.has(tool) || isReadOnlyPlatform(tool) || isReadOnlyShellCall(tool, args),
  isUnscopedMutation: (tool, args) => UNSCOPED_MUTATION_TOOLS.has(tool) && !isReadOnlyShellCall(tool, args),
  isPlatformProgress: (tool) => tool.startsWith("builtin_") && !isReadOnlyPlatform(tool),
  expectsChange: () => true,
};

const AUTH = "frontend/src/components/auth/AuthShell.tsx";
const LOGIN = "frontend/src/app/login/LoginPageClient.tsx";
const REGISTER = "frontend/src/app/register/RegisterPageClient.tsx";
const ok = (data: Record<string, unknown> = {}) => ({ data: { ok: true, ...data } });

type Call = [tool: string, args: Record<string, unknown>, result: { data: unknown; isError?: boolean }];

/** The incident's 22 turns, call for call. */
const INCIDENT: Call[][] = [
  [["search_code", { query: "Welcome back" }, ok()]],
  [["read_file", { path: AUTH }, ok()]],
  [["read_file", { path: LOGIN }, ok()]],
  [["search_code", { query: "LoRA" }, ok()]],
  [["list_files", { path: "frontend/src/app/login" }, ok()]],
  [["read_file", { path: "frontend/src/components/auth/AuthPills.tsx" }, ok()]],
  // 7: the batched multi-file form — no top-level path.
  [["edit_file", { edits: [
    { path: AUTH, old_string: "<h1>Welcome back</h1>", new_string: "" },
    { path: AUTH, old_string: "<Pills left />", new_string: "" },
    { path: LOGIN, old_string: "<AuthShell>", new_string: "<AuthShell pills=\"right\">" },
  ] }, ok({ files: [{ path: AUTH, ok: true }, { path: LOGIN, ok: true }] })]],
  [["edit_file", { path: LOGIN, old_string: "Sign in", new_string: "" }, ok()]],
  [["read_file", { path: LOGIN }, ok({ covered: true })]],
  [["edit_file", { path: LOGIN, old_string: "<div className=\"left\">", new_string: "<div className=\"left compact\">" }, ok()]],
  // 11: the junk edit trip 2's forced turn produced — it failed only because the text was not there.
  [["edit_file", { path: LOGIN, old_string: "Create Your account", new_string: "REMOVED" }, { data: { ok: false, error: "oldString not found in file" }, isError: true }]],
  [["git_diff", {}, ok({ diff: "…" })], ["list_files", { path: "frontend/src/app" }, ok()]],
  [["read_file", { path: REGISTER }, ok()]],
  [["edit_file", { path: REGISTER, old_string: "Create your account", new_string: "" }, ok()]],
  [["run_command", { command: "cat package.json | grep scripts" }, ok({ stdout: "\"scripts\": {" })]],
  [["run_command", { command: "cat package.json | grep next" }, ok({ stdout: "\"next\": \"15\"" })]],
  // 17: the type-check, in the background — a job id, no answer yet.
  [["run_command", { command: "pnpm exec tsc --noEmit", background: true }, ok({ background: true, id: "job-1", status: "running", note: "Running in the background (job job-1)." })]],
  // 18: its answer, through the poll.
  [["command_status", { id: "job-1", waitMs: 120000 }, ok({ id: "job-1", status: "exited", exitCode: 0, output: "" })]],
  [["git_status", {}, ok({ stdout: " M AuthShell.tsx" })], ["builtin_chats_list_tickets", {}, ok({ tickets: [] })]],
  [["git_status", {}, ok({ stdout: " M AuthShell.tsx" })]],
  [["git_diff", {}, ok({ diff: "…" })]],
  [["builtin_tickets_from_delta", {}, ok({ taskId: 1 })]],
];

function play(d: ProgressDetector, turns: Call[][]): Array<ProgressAction | null> {
  return turns.map((calls) => {
    for (const [tool, args, result] of calls) d.observe(tool, args, result);
    return d.endTurn();
  });
}

/** A stretch of wrap-up turns long enough to trip the idle window once. */
const idleTurns = (): Call[][] => Array.from({ length: NO_PROGRESS_TURNS }, (): Call[] => [["git_status", {}, ok({ stdout: "" })]]);

const trips = (actions: Array<ProgressAction | null>) => actions.filter((a): a is Exclude<ProgressAction, { kind: "advisory" }> => !!a && a.kind !== "advisory");

describe("regression: chat #146477 — a finished, verified change is never escalated or paused", () => {
  it("regression: replaying the incident never escalates or pauses, and the wrap-up ends in finish", () => {
    const d = new ProgressDetector({}, brainPorts);
    const actions = play(d, INCIDENT);
    const kinds = trips(actions).map((a) => a.kind);
    expect(kinds).not.toContain("escalate");
    expect(kinds).not.toContain("pause");
    // Only the six opening reads may steer (a read-only streak on a change request).
    expect(trips(actions).every((a) => a.kind === "steer" && a.signal.kind === "read_only_streak")).toBe(true);
    expect(d.workVerified).toBe(true);

    // More wrap-up with nothing left to do: the idle window trips — as a FINISH.
    const wrapUp = play(d, Array.from({ length: NO_PROGRESS_TURNS }, (): Call[] => [["git_status", {}, ok({ stdout: "" })]]));
    const last = wrapUp[wrapUp.length - 1];
    expect(wrapUp.slice(0, -1).every((a) => a === null)).toBe(true);
    expect(last).toMatchObject({ kind: "finish", signal: { kind: "no_progress" } });
    expect(last && last.kind === "finish" ? last.note : "").toMatch(/final report/i);
    expect(d.steerNote()).toMatch(/Make no more tool calls/);
    expect(d.snapshot().tripsBySignal?.no_progress).toBe(1);
    expect(progressTraceStep(last!).result).toContain("→ finish");
  });

  it("regression: the batched edit_file counts as a write of every file it changes", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, INCIDENT.slice(0, 7));
    const s = d.snapshot();
    expect(s.writtenPaths).toEqual(expect.arrayContaining([AUTH, LOGIN]));
    expect(s.edits?.map(([p]) => p)).toEqual(expect.arrayContaining([AUTH, LOGIN]));
    expect(s.work).toEqual({ wrote: true });
  });

  it("regression: a batched edit to files the run never touched is ground progress", () => {
    const t = new NoProgressTracker();
    t.observe("read_file", { path: "a.ts" }, { ok: true, wrote: false });
    t.endTurn();
    t.observe("edit_file", { edits: [{ path: "b.ts", old_string: "x", new_string: "y" }, { file_path: "c.ts", oldString: "p", newString: "q" }] }, { ok: true, wrote: true });
    expect(t.endTurn()).toBe(0);
    expect(t.lastTurnGround).toBe(true);
    expect(t.snapshot().seen).toEqual(expect.arrayContaining(["b.ts", "c.ts"]));
  });

  it("regression: the command_status poll of a background check is the check, judged on its answer", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, INCIDENT.slice(0, 17));
    expect(d.workVerified).toBe(false);
    expect(d.snapshot().progress?.checkJobs).toEqual(["job-1"]);
    expect(d.snapshot().progress?.lastCheck).toBeUndefined();
    play(d, INCIDENT.slice(17, 18));
    expect(d.snapshot().progress?.lastCheck).toBeDefined();
    expect(d.workVerified).toBe(true);
  });

  it("regression: a background check that exits non-zero, or a poll of an unrelated job, does not verify", () => {
    const failing = new ProgressDetector({}, brainPorts);
    play(failing, [
      [["edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok()]],
      [["run_command", { command: "pnpm test", background: true }, ok({ background: true, id: "job-7", status: "running" })]],
      [["command_status", { id: "job-7" }, ok({ id: "job-7", status: "running", output: "…" })]],
    ]);
    expect(failing.workVerified).toBe(false);
    play(failing, [[["command_status", { id: "job-7" }, ok({ id: "job-7", status: "exited", exitCode: 1, output: "1 failed" })]]]);
    expect(failing.workVerified).toBe(false);

    const unrelated = new ProgressDetector({}, brainPorts);
    play(unrelated, [
      [["edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok()]],
      [["run_command", { command: "pnpm dev", background: true }, ok({ background: true, id: "job-2", status: "running" })]],
      [["command_status", { id: "job-2" }, ok({ id: "job-2", status: "exited", exitCode: 0 })]],
    ]);
    expect(unrelated.workVerified).toBe(false);
  });

  it("regression: a write after the passing check un-verifies the run, so its idle stretch climbs the ladder", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [
      [["edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok()]],
      [["run_tests", {}, ok({ passed: 3 })]],
      [["edit_file", { path: "a.ts", old_string: "y", new_string: "z" }, ok()]],
    ]);
    expect(d.workVerified).toBe(false);
    const idle = play(d, Array.from({ length: NO_PROGRESS_TURNS }, (): Call[] => [["git_status", {}, ok()]]));
    expect(idle[idle.length - 1]?.kind).toBe("steer");
  });

  it("regression: edit_revert keeps the ladder even when the work is verified", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [
      [["edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok()]],
      [["run_tests", {}, ok()]],
    ]);
    expect(d.workVerified).toBe(true);
    const [a] = play(d, [[["edit_file", { edits: [{ path: "a.ts", old_string: "y", new_string: "x" }] }, ok()]]]);
    expect(a).toMatchObject({ kind: "steer", signal: { kind: "edit_revert", target: "a.ts" } });
  });
});

describe("regression: a verified first part does not end a multi-part task", () => {
  it("regression: part A edited and checked, then reading for part B, gets a steer — not a finish — at trip 1", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [
      [["edit_file", { path: "src/partA.ts", old_string: "a", new_string: "A" }, ok()]],
      [["run_command", { command: "pnpm exec tsc --noEmit" }, ok({ exitCode: 0, stdout: "" })]],
    ]);
    expect(d.workVerified).toBe(true);
    const reads = play(d, Array.from({ length: 6 }, (_, i): Call[] => [["read_file", { path: `src/partB/f${i}.ts` }, ok()]]));
    const trip = trips(reads)[0];
    expect(trip?.kind).toBe("steer");
    expect(trip && trip.kind === "steer" ? trip.note : "").toMatch(/Otherwise make the next change/);
  });
});

describe("regression: a pass needs a real check runner, and bookkeeping is not a write", () => {
  it("regression: commands that only MENTION a test are not checks", () => {
    for (const command of ["ls tests/", "grep -r foo tests/", "git commit -m \"fix tests\"", "cat src/a.test.ts"]) expect(runsCheck(command)).toBe(false);
    for (const command of ["pnpm exec tsc --noEmit", "cd api && npm test", "npx vitest run src/a.test.ts", "FOO=1 pnpm --filter web run typecheck", "cargo test", "yarn lint", "pnpm test:unit"]) expect(runsCheck(command)).toBe(true);
  });

  it("regression: `ls tests/` after an edit does not verify the run", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [
      [["edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok()]],
      [["run_command", { command: "ls tests/" }, ok({ exitCode: 0, stdout: "a.test.ts" })]],
      [["run_command", { command: "grep -r foo tests/" }, ok({ exitCode: 0 })]],
    ]);
    expect(d.workVerified).toBe(false);
  });

  it("regression: git add / commit / push after the passing check keep the run verified", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [
      [["edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok()]],
      [["run_command", { command: "pnpm test" }, ok({ exitCode: 0 })]],
      [["run_command", { command: "git add a.ts" }, ok({ exitCode: 0 })], ["run_command", { command: "git commit -m \"fix tests\"" }, ok({ exitCode: 0 })]],
      [["run_command", { command: "git push" }, ok({ exitCode: 0 })]],
    ]);
    expect(d.workVerified).toBe(true);
    expect(isVcsBookkeeping("git status")).toBe(true);
    expect(isVcsBookkeeping("git checkout main")).toBe(false);
  });
});

describe("regression: batched edits reach EditRevertTracker", () => {
  it("regression: an edit A→B in one batch undone B→A in a later batch is a revert", () => {
    const t = new EditRevertTracker();
    expect(t.record("edit_file", { edits: [{ path: "a.ts", old_string: "A", new_string: "B" }, { path: "b.ts", old_string: "p", new_string: "q" }] }, { ok: true })).toBeNull();
    expect(t.record("edit_file", { edits: [{ path: "c.ts", old_string: "m", new_string: "n" }, { path: "a.ts", old_string: "B", new_string: "A" }] }, { ok: true })).toEqual({ path: "a.ts", tool: "edit_file", restores: "inverse_edit" });
  });

  it("regression: a failed batch forgets every path it names (none of it applied)", () => {
    const t = new EditRevertTracker();
    t.record("edit_file", { edits: [{ path: "a.ts", old_string: "A", new_string: "B" }] }, { ok: true });
    t.record("edit_file", { edits: [{ path: "a.ts", old_string: "Z", new_string: "Y" }] }, { ok: false });
    expect(t.record("edit_file", { path: "a.ts", old_string: "B", new_string: "A" }, { ok: true })).toBeNull();
  });
});

describe("regression: the new state survives a snapshot and resume", () => {
  it("regression: background check job ids and the verified flag round-trip through plain JSON", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [
      [["edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok()]],
      [["run_command", { command: "pnpm exec tsc --noEmit", background: true }, ok({ background: true, id: "job-1", status: "running" })]],
    ]);
    const mid = JSON.parse(JSON.stringify(d.snapshot()));
    expect(mid.progress.checkJobs).toEqual(["job-1"]);
    expect(mid.work).toEqual({ wrote: true });

    // A durable tick later: the poll still belongs to the check.
    const resumed = new ProgressDetector(mid, brainPorts);
    play(resumed, [[["command_status", { id: "job-1" }, ok({ id: "job-1", status: "exited", exitCode: 0 })]]]);
    const after = JSON.parse(JSON.stringify(resumed.snapshot()));
    expect(after.work).toEqual({ wrote: true, verified: true });

    const again = new ProgressDetector(after, brainPorts);
    expect(again.workVerified).toBe(true);
    // The first verified trip only asks; the second finishes.
    const first = play(again, idleTurns())[NO_PROGRESS_TURNS - 1];
    expect(first?.kind).toBe("steer");
    expect(first && first.kind === "steer" ? first.note : "").toMatch(/If the request is fully done/);
    expect(play(again, idleTurns())[NO_PROGRESS_TURNS - 1]?.kind).toBe("finish");
  });

  it("regression: a finish is offered once — idle again after it (across a resume) climbs to the third-rung finish", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [
      [["edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok()]],
      [["run_tests", {}, ok()]],
    ]);
    expect(play(d, idleTurns())[NO_PROGRESS_TURNS - 1]?.kind).toBe("steer");
    expect(play(d, idleTurns())[NO_PROGRESS_TURNS - 1]?.kind).toBe("finish");
    const saved = JSON.parse(JSON.stringify(d.snapshot()));
    expect(saved.work).toEqual({ wrote: true, verified: true, finishOffered: true });
    const resumed = new ProgressDetector(saved, brainPorts);
    expect(play(resumed, idleTurns())[NO_PROGRESS_TURNS - 1]).toMatchObject({ kind: "finish", trip: 3, verified: true });
  });

  it("regression: a new write after a finish earns a fresh finish once it is verified again", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [[["edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok()]], [["run_tests", {}, ok()]]]);
    play(d, idleTurns());
    expect(play(d, idleTurns())[NO_PROGRESS_TURNS - 1]?.kind).toBe("finish");
    play(d, [[["edit_file", { path: "b.ts", old_string: "p", new_string: "q" }, ok()]], [["run_tests", {}, ok({ passed: 5 })]]]);
    expect(d.snapshot().work?.finishOffered).toBeUndefined();
    const next = play(d, idleTurns())[NO_PROGRESS_TURNS - 1];
    expect(next?.kind).toBe("finish");
  });

  it("regression: an older snapshot without the new fields resumes as no work yet", () => {
    const d = new ProgressDetector({ progress: { seen: ["a.ts"], idleTurns: 0 } }, brainPorts);
    expect(d.workVerified).toBe(false);
    expect(d.snapshot().work).toBeUndefined();
    expect(d.snapshot().progress?.checkJobs).toBeUndefined();
  });
});

// VS Code chat #157440: an orchestrator fanned out four sub-agents that wrote ~60 files, then
// type-checked, tested and committed — and still ended on the third-trip pause ("Continue with
// guidance / Stop the run"). Its writes came back in `wait_agents` RESULTS, which the detector
// never read, so the run never had verified work; and the third rung asked a human.
describe("regression: chat #157440 — an autonomous run never asks whether to continue", () => {
  const CHILD_FILES = ["docs/prd/a.md", "api/src/a.ts", "api/src/b.ts", "frontend/src/c.tsx"];
  const report = (handle: string, state: "done" | "failed" | "stopped" = "done") => ({ handle, name: "Dev", state, label: "slice", output: "Implemented." });

  it("regression: chat #157440 — wait_agents changedFiles + a passing type-check make idle wrap-up a verified finish, never escalate/pause", () => {
    const d = new ProgressDetector({}, brainPorts);
    const actions = play(d, [
      [["spawn_agents", { workstreams: [{ task: "a" }, { task: "b" }] }, ok({ running: ["a1", "a2"] })]],
      [["wait_agents", {}, ok({ reports: [], running: ["a1", "a2"], note: "a1, a2 still running" })]],
      [["wait_agents", {}, ok({ reports: [report("a1")], running: ["a2"], changedFiles: CHILD_FILES.slice(0, 2) })]],
      [["wait_agents", {}, ok({ reports: [report("a2")], running: [], changedFiles: CHILD_FILES.slice(2) })]],
      [["run_command", { command: "pnpm type-check" }, ok({ exitCode: 0, stdout: "" })]],
      [["run_command", { command: "git add -A" }, ok({ exitCode: 0 })], ["run_command", { command: "git commit -m \"implement the PRD\"" }, ok({ exitCode: 0 })]],
    ]);
    expect(trips(actions)).toEqual([]);
    expect(d.workVerified).toBe(true);
    expect(d.snapshot().writtenPaths).toEqual(expect.arrayContaining(CHILD_FILES));

    // Idle wrap-up: git_status / git diff turns until the idle window trips, twice.
    const wrapUp = (): Call[][] => Array.from({ length: NO_PROGRESS_TURNS }, (_, i): Call[] => [
      i % 2 ? ["run_command", { command: "git diff" }, ok({ exitCode: 0, stdout: "" })] : ["git_status", {}, ok({ stdout: "" })],
    ]);
    const kinds = trips([...play(d, wrapUp()), ...play(d, wrapUp())]);
    expect(kinds.map((a) => a.kind)).toEqual(["steer", "finish"]);
    const finish = kinds[1]!;
    expect(finish).toMatchObject({ kind: "finish", verified: true });
    expect(finish.kind === "finish" ? finish.note : "").toContain("The work is done");
    expect(kinds.some((a) => a.kind === "escalate")).toBe(false);
  });

  it("regression: chat #157440 — a delegation that only returned a report is progress, not an idle turn", () => {
    const t = new NoProgressTracker();
    t.observe("read_file", { path: "a.ts" }, { ok: true, wrote: false });
    t.endTurn();
    t.observe("wait_agents", {}, { ok: true, wrote: false, delegationReported: true });
    expect(t.endTurn()).toBe(0);
    expect(t.lastTurnGround).toBe(true);
  });

  it("regression: chat #157440 — an unverified stalled run's third trip is a finish with the stalled note", () => {
    const d = new ProgressDetector({}, brainPorts);
    let n = 0;
    const stretch = (): Call[][] => Array.from({ length: READ_ONLY_STREAK_TURNS }, (): Call[] => [["read_file", { path: `src/f${(n += 1)}.ts` }, ok()]]);
    const kinds = trips([...play(d, stretch()), ...play(d, stretch()), ...play(d, stretch())]);
    expect(kinds.map((a) => a.kind)).toEqual(["steer", "escalate", "finish"]);
    const third = kinds[2]!;
    expect(third).toMatchObject({ kind: "finish", trip: 3, verified: false, signal: { kind: "read_only_streak" } });
    const note = third.kind === "finish" ? third.note : "";
    expect(note).not.toContain("The work is done");
    expect(note).toMatch(/final report/i);
    expect(note).toMatch(/what is NOT done/);
    expect(note).toMatch(/do not ask the user whether to continue/);
    expect(note).toContain("read-only calls in a row");
    // A no-tools turn cannot make an edit: the final note never asks for one.
    expect(note).not.toMatch(/make the first concrete edit/i);
    expect(d.steerNote()).toBe(note);
    expect(progressTraceStep(third).result).toContain("→ finish (the run is not converging");
  });

  it("regression: chat #157440 — a hung child: endless identical waits pass the ceiling and reach finish", () => {
    expect(MAX_WAIT_TURNS).toBe(3 * NO_PROGRESS_TURNS);
    const d = new ProgressDetector({}, brainPorts);
    const waits = Array.from({ length: 40 }, (): Call[] => [["wait_agents", {}, ok({ reports: [], running: ["a1"], note: "still running" })]]);
    // The host ends the run on the first finish; a detector driven on keeps finishing.
    const actions = trips(play(d, waits)).slice(0, 3);
    expect(actions.map((a) => a.kind)).toEqual(["steer", "escalate", "finish"]);
    expect(actions.every((a) => a.signal.kind === "no_progress")).toBe(true);
    // The first trip waited out the ceiling before its idle window.
    const first = play(new ProgressDetector({}, brainPorts), waits).findIndex((a) => a !== null);
    expect(first).toBe(MAX_WAIT_TURNS + NO_PROGRESS_TURNS - 1);
  });

  it("regression: chat #157440 — a dev server's command_status that never exits is no exemption either", () => {
    const d = new ProgressDetector({}, brainPorts);
    const polls = Array.from({ length: 40 }, (): Call[] => [["command_status", { id: "dev-1" }, ok({ id: "dev-1", status: "running", output: "ready" })]]);
    expect(trips(play(d, polls)).slice(0, 3).map((a) => a.kind)).toEqual(["steer", "escalate", "finish"]);
  });

  it("regression: chat #157440 — idle reads plus one wait in the same turn are judged by the reads: no_progress trips", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [[["read_file", { path: "a.ts" }, ok()]]]);
    const mixed = Array.from({ length: NO_PROGRESS_TURNS }, (): Call[] => [
      ["git_status", {}, ok({ stdout: "" })],
      ["wait_agents", {}, ok({ reports: [], running: ["a1"] })],
    ]);
    expect(trips(play(d, mixed)).map((a) => a.signal.kind)).toEqual(["no_progress"]);
  });

  it("regression: chat #157440 — waits that keep bringing children's reports back are never tripped", () => {
    const d = new ProgressDetector({}, { ...brainPorts, isReadOnly: (tool, args) => tool === "wait_agents" || brainPorts.isReadOnly!(tool, args) });
    const handles = Array.from({ length: 6 }, (_, i) => `a${i + 1}`);
    const every = MAX_WAIT_TURNS - 2;
    // One child reports every MAX_WAIT_TURNS - 2 turns: the delivered report is ground, and the ceiling starts over.
    const waits = Array.from({ length: 6 * every }, (_, t): Call[] => {
      const finished = t > 0 && t % every === 0 ? [report(handles[t / every - 1]!)] : [];
      return [["wait_agents", {}, ok({ reports: finished, running: handles.slice(Math.floor(t / every)) })]];
    });
    expect(trips(play(d, waits))).toEqual([]);
  });

  it("regression: chat #157440 — waits that alternate between two children (or two jobs) still hit the ceiling and reach finish", () => {
    const d = new ProgressDetector({}, brainPorts);
    const alternating = Array.from({ length: 40 }, (_, t): Call[] => [
      t % 2
        ? ["wait_agents", { agents: ["a2"] }, ok({ reports: [], running: ["a2"] })]
        : ["wait_agents", { agents: ["a1"] }, ok({ reports: [], running: ["a1"] })],
    ]);
    expect(trips(play(d, alternating)).slice(0, 3).map((a) => a.kind)).toEqual(["steer", "escalate", "finish"]);
    const jobs = new ProgressDetector({}, brainPorts);
    const polls = Array.from({ length: 40 }, (_, t): Call[] => [["command_status", { id: `job-${t % 2}` }, ok({ id: `job-${t % 2}`, status: "running" })]]);
    expect(trips(play(jobs, polls)).slice(0, 3).map((a) => a.kind)).toEqual(["steer", "escalate", "finish"]);
  });

  it("regression: chat #157440 — the wait ceiling's count survives a snapshot and resume", () => {
    const d = new ProgressDetector({}, brainPorts);
    const wait = (): Call[] => [["wait_agents", {}, ok({ reports: [], running: ["a1"] })]];
    play(d, Array.from({ length: MAX_WAIT_TURNS }, wait));
    const saved = JSON.parse(JSON.stringify(d.snapshot()));
    expect(saved.progress).toMatchObject({ waitTurns: MAX_WAIT_TURNS, waitDigest: expect.any(String) });
    const resumed = new ProgressDetector(saved, brainPorts);
    // Past the ceiling at once: the idle window runs from the next turn.
    const after = play(resumed, Array.from({ length: NO_PROGRESS_TURNS }, wait));
    expect(after[NO_PROGRESS_TURNS - 1]).toMatchObject({ kind: "steer", signal: { kind: "no_progress" } });
    // A fresh detector omits both fields.
    expect(new ProgressDetector({}, brainPorts).snapshot().progress).not.toHaveProperty("waitTurns");
  });

  it("regression: chat #157440 — a wait that returns running: [] is not exempt: a real loop still trips", () => {
    const d = new ProgressDetector({}, brainPorts);
    const empty = Array.from({ length: NO_PROGRESS_TURNS }, (): Call[] => [["wait_agents", {}, ok({ reports: [], running: [] })]]);
    expect(trips(play(d, empty)).map((a) => a.signal.kind)).toEqual(["no_progress"]);
  });

  it("regression: chat #157440 — only a delegation's changedFiles count: any other tool's earn no credit", () => {
    const d = new ProgressDetector({}, brainPorts);
    play(d, [[["builtin_docs_get", {}, ok({ changedFiles: ["api/src/a.ts"] })]]]);
    expect(d.snapshot().work).toBeUndefined();
    expect(d.snapshot().writtenPaths ?? []).not.toContain("api/src/a.ts");
  });

  it("regression: chat #157440 — a failed or stopped child that changed nothing is not progress; a done one is", () => {
    const t = (reports: unknown[]) => {
      const d = new ProgressDetector({}, brainPorts);
      play(d, [[["read_file", { path: "a.ts" }, ok()]]]);
      play(d, [[["wait_agents", {}, ok({ reports, running: [] })]]]);
      return d.snapshot().progress?.idleTurns;
    };
    expect(t([report("a1", "failed"), report("a2", "stopped")])).toBe(1);
    expect(t([report("a1", "done")])).toBe(0);
    expect(t([{ ...report("a1", "stopped"), changedFiles: ["x.ts"] }])).toBe(0);
  });

  it("regression: chat #157440 — a child report injected as a message credits its files like a wait_agents result", () => {
    const d = new ProgressDetector({}, brainPorts);
    d.observeChildReport({ state: "done", changedFiles: CHILD_FILES });
    expect(d.endTurn()).toBeNull();
    play(d, [[["run_command", { command: "pnpm type-check" }, ok({ exitCode: 0, stdout: "" })]]]);
    expect(d.workVerified).toBe(true);
    expect(d.snapshot().writtenPaths).toEqual(expect.arrayContaining(CHILD_FILES));
  });
});
