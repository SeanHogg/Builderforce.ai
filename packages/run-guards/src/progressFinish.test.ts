import { describe, expect, it } from "vitest";
import { ProgressDetector, type ProgressAction, type ProgressDetectorPorts } from "./progressDetector.js";
import { NO_PROGRESS_TURNS, NoProgressTracker } from "./noProgress.js";
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

  it("regression: a finish is offered once — idle again after it (across a resume) climbs to a pause", () => {
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
    expect(play(resumed, idleTurns())[NO_PROGRESS_TURNS - 1]?.kind).toBe("pause");
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
