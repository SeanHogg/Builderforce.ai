import { describe, expect, it } from "vitest";

import {
  childSettledState,
  lastEditFailedCheck,
  realChangedFiles,
  type ChildEvidenceStep,
} from "./childDoneEvidence";

const GREEN_RUN: ChildEvidenceStep[] = [
  { category: "tool", label: "read_file", args: { path: "src/a.ts" } },
  { category: "tool", label: "edit_file", args: { path: "src/a.ts" } },
  { category: "tool", label: "run_command", args: { command: "pnpm typecheck" }, result: { ok: true } },
];

describe("a child reports done only with evidence (chat #80006, R2)", () => {
  it("a child with real file evidence and a green final check still reports done", () => {
    const verdict = childSettledState({
      stopped: false,
      snapshotError: "",
      answer: "Fixed the off-by-one in src/a.ts and the typecheck passes.",
      changedFiles: realChangedFiles(["src/a.ts"]),
      trace: GREEN_RUN,
    });
    expect(verdict.state).toBe("done");
  });

  it("a child that changed only __note.txt is not done", () => {
    expect(
      realChangedFiles(["__note.txt", "notes/__probe.md", "tmp/__envprobe.json"]),
    ).toEqual([]);
    const verdict = childSettledState({
      stopped: false,
      snapshotError: "",
      answer: "Done — findings recorded.",
      changedFiles: realChangedFiles(["__note.txt"]),
      trace: [{ category: "tool", label: "write_file", args: { path: "__note.txt" } }],
    });
    expect(verdict.state).toBe("incomplete");
    expect(verdict.reason).toContain("changed no real file");
  });

  it("regression: a child that changed only __note.txt is not done", () => {
    const verdict = childSettledState({
      stopped: false,
      snapshotError: "",
      answer: "All recorded in __note.txt.",
      changedFiles: realChangedFiles(["__note.txt"]),
      trace: [{ category: "tool", label: "write_file", args: { path: "__note.txt" } }],
    });
    expect(verdict.state).toBe("incomplete");
  });

  it("regression: a child whose typecheck failed after its last edit is not done", () => {
    const trace: ChildEvidenceStep[] = [
      { category: "tool", label: "read_file", args: { path: "src/a.ts" } },
      { category: "tool", label: "edit_file", args: { path: "src/a.ts" } },
      { category: "tool", label: "run_command", args: { command: "pnpm exec tsc --noEmit" }, result: { ok: false, exitCode: 2 } },
    ];
    expect(lastEditFailedCheck(trace)).toBe(true);
    const verdict = childSettledState({
      stopped: false,
      snapshotError: "",
      answer: "Applied the fix; typecheck output looked fine to me.",
      changedFiles: ["src/a.ts"],
      trace,
    });
    expect(verdict.state).toBe("incomplete");
    expect(verdict.reason).toContain("failed after its last edit");
  });

  it("a green check after the last edit is not a failure", () => {
    expect(lastEditFailedCheck(GREEN_RUN)).toBe(false);
  });

  it("a failing run_command before the last edit does not veto a done", () => {
    const trace: ChildEvidenceStep[] = [
      { category: "tool", label: "run_command", args: { command: "pnpm typecheck" }, result: { ok: false } },
      { category: "tool", label: "edit_file", args: { path: "src/a.ts" } },
      { category: "tool", label: "run_command", args: { command: "pnpm typecheck" }, result: { ok: true } },
    ];
    expect(lastEditFailedCheck(trace)).toBe(false);
  });

  it("regression: a child that ended on an unanswered question is not done", () => {
    const verdict = childSettledState({
      stopped: false,
      snapshotError: "",
      answer: "Which package should hold the new helper — agent-tools or agent-skills?",
      changedFiles: ["src/helper.ts"],
      trace: GREEN_RUN,
    });
    expect(verdict.state).toBe("incomplete");
    expect(verdict.reason).toContain("unanswered question");
  });

  it("regression: a child that stalled (stopped making progress) is not done", () => {
    const verdict = childSettledState({
      stopped: false,
      snapshotError: "",
      answer: "I'll start by reading the trace to see where the run stopped making progress.",
      changedFiles: ["src/a.ts"],
      trace: GREEN_RUN,
    });
    expect(verdict.state).toBe("incomplete");
    expect(verdict.reason).toMatch(/described tool calls instead of making them/);
  });

  it("a run that died with an error is failed; a stop-requested child stays stopped", () => {
    expect(
      childSettledState({ stopped: false, snapshotError: "model 500", answer: "", changedFiles: ["src/a.ts"] }).state,
    ).toBe("failed");
    expect(childSettledState({ stopped: true, snapshotError: "", answer: "", changedFiles: [] }).state).toBe("stopped");
  });
});
