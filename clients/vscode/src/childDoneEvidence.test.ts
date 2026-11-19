import { describe, expect, it } from "vitest";

import {
  childSettledState,
  lastEditFailedCheck,
  realChangedFiles,
  REPORT_NOW_STEER,
  unfinishedReportReason,
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

  it("a review / explore child's report is its deliverable — no changed file is needed", () => {
    const report = "Compared the 63 ready tickets with ROADMAP §4.\n\nOutcome: done\nChanged: none\nChecked: ROADMAP.md lines 1-400\nOpen issues: none";
    for (const role of ["review", "explore", "plan", "verify"]) {
      expect(childSettledState({ stopped: false, answer: report, changedFiles: [], role }).state).toBe("done");
    }
    expect(childSettledState({ stopped: false, answer: report, changedFiles: [], role: "code" }).state).toBe("incomplete");
  });

  it("a run that died with an error is failed; a stop-requested child stays stopped", () => {
    expect(
      childSettledState({ stopped: false, snapshotError: "model 500", answer: "", changedFiles: ["src/a.ts"] }).state,
    ).toBe("failed");
    expect(childSettledState({ stopped: true, snapshotError: "", answer: "", changedFiles: [] }).state).toBe("stopped");
  });
});

/** The final reply of VS Code chat #273's child, as the host stored it. */
const CHAT_273_FINAL =
  "I have enough to produce the report. Two named-epic lookups are cheap …\n" +
  "```ask-user\n" +
  '{"question":"I\'ve completed the bulk read …"}\n' +
  "```";

/** The same reply as the chat rendered it, on one line. */
const CHAT_273_FINAL_FLAT =
  'I have enough to produce the report. Two named-epic lookups are cheap … ```ask-user {"question":"I\'ve completed the bulk read …"}';

describe("a child's final reply must BE its report (VS Code chat #273)", () => {
  it("regression: chat #273's ask-user ending is incomplete, not done — whatever the role", () => {
    for (const answer of [CHAT_273_FINAL, CHAT_273_FINAL_FLAT]) {
      expect(unfinishedReportReason(answer)).toContain("ask-user");
      for (const role of ["review", "explore", "code"]) {
        const verdict = childSettledState({ stopped: false, answer, changedFiles: [], role });
        expect(verdict.state).toBe("incomplete");
        expect(verdict.reason).toContain("asking the user");
      }
    }
  });

  it("regression: a readiness claim with no report after it is incomplete", () => {
    const answer = "I have enough to produce the report. Two named-epic lookups are cheap, so I will fold them in.";
    expect(unfinishedReportReason(answer)).toContain("without writing it");
    expect(childSettledState({ stopped: false, answer, changedFiles: [], role: "explore" }).state).toBe("incomplete");
  });

  it("a readiness claim followed by the report itself is done", () => {
    const answer = "I have everything I need.\n\nReady tickets cover ROADMAP §1-§3; §4 has none.\n\nOutcome: done\nChanged: none\nChecked: tasks list offsets 0-300\nOpen issues: none";
    expect(unfinishedReportReason(answer)).toBeNull();
    expect(childSettledState({ stopped: false, answer, changedFiles: [], role: "review" }).state).toBe("done");
  });

  it("a report with blank lines (no ask-user block) is not taken for one", () => {
    const answer = "Findings:\n\n\n- ROADMAP §4 has no tickets.\n\n\n\nOutcome: done\nChanged: none\nChecked: ROADMAP.md\nOpen issues: none";
    expect(unfinishedReportReason(answer)).toBeNull();
    expect(childSettledState({ stopped: false, answer, changedFiles: [], role: "explore" }).state).toBe("done");
  });

  it("a short explore report that names the next step is not falsely failed", () => {
    const answer = "The auth middleware lives in src/auth.ts:12 and is mounted in src/app.ts:40. Next I'll implement X in a.ts.";
    expect(unfinishedReportReason(answer)).toBeNull();
    expect(childSettledState({ stopped: false, answer, changedFiles: [], role: "explore" }).state).toBe("done");
  });

  it("the steer for the extra turn says it cannot ask and must state its coverage", () => {
    expect(REPORT_NOW_STEER).toContain("cannot ask the user");
    expect(REPORT_NOW_STEER).toContain("coverage");
  });
});
