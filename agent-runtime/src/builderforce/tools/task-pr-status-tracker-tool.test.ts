/**
 * Unit tests for the Task PR Status Tracker tool.
 *
 * AC1–AC6 / F1–F5 coverage:
 *  - classifyPrStatus: F3 — Merged / Open / Closed (Unmerged)
 *  - deriveTaskSummary: F5 per-task summary, AC4 multi-PR logic
 *  - deduplicateByNumber: AC4 deduplication when same PR surfaces from multiple strategies
 *  - buildReportSummary: AC5 global rollup
 *  - buildTextReport: AC5 / F5 — verifies the human-readable output exists and is well-formed
 *  - runTaskPrStatus input validation: F1 / F4 / AC6
 */

import { describe, it, expect } from "vitest";
import {
  classifyPrStatus,
  deriveTaskSummary,
  deduplicateByNumber,
  buildReportSummary,
  buildTextReport,
  type GhPullRequest,
  type TaskStatusEntry,
  type PrResult,
} from "./task-pr-status-tracker-tool.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const basePr = (overrides: Partial<GhPullRequest> = {}): GhPullRequest => ({
  number: 1,
  title: "Fix LOGIN-42 — auth race",
  html_url: "https://github.com/o/r/pull/1",
  state: "open",
  merged_at: null,
  user: { login: "bot" },
  created_at: "2025-01-01T00:00:00Z",
  ...overrides,
});

// ---------------------------------------------------------------------------
// classifyPrStatus (F3, AC1, AC2, F3-closed)
// ---------------------------------------------------------------------------

describe("classifyPrStatus (F3)", () => {
  it("returns 'Merged' when merged_at is set — regardless of state (AC1)", () => {
    expect(classifyPrStatus(basePr({ state: "closed", merged_at: "2025-01-02T00:00:00Z" }))).toBe("Merged");
    // Edge case: GitHub can briefly leave state="open" after a merge event.
    expect(classifyPrStatus(basePr({ state: "open", merged_at: "2025-01-02T00:00:00Z" }))).toBe("Merged");
  });

  it("returns 'Closed (Unmerged)' when state is closed but merged_at is null (F3)", () => {
    expect(classifyPrStatus(basePr({ state: "closed", merged_at: null }))).toBe("Closed (Unmerged)");
  });

  it("returns 'Open' when state is open and merged_at is null (AC2)", () => {
    expect(classifyPrStatus(basePr({ state: "open", merged_at: null }))).toBe("Open");
  });
});

// ---------------------------------------------------------------------------
// deriveTaskSummary (F5, AC3, AC4)
// ---------------------------------------------------------------------------

describe("deriveTaskSummary (F5 + AC3/AC4)", () => {
  it("returns 'No PR Found' for an empty PR list (AC3)", () => {
    expect(deriveTaskSummary([])).toBe("No PR Found");
  });

  it("returns 'All PRs Merged' when every PR is Merged (AC1, F5)", () => {
    expect(deriveTaskSummary(["Merged"])).toBe("All PRs Merged");
    expect(deriveTaskSummary(["Merged", "Merged", "Merged"])).toBe("All PRs Merged");
  });

  it("returns 'PR(s) Open' when at least one PR is not Merged (AC2, AC4)", () => {
    expect(deriveTaskSummary(["Open"])).toBe("PR(s) Open");
    expect(deriveTaskSummary(["Merged", "Open"])).toBe("PR(s) Open");
    expect(deriveTaskSummary(["Merged", "Closed (Unmerged)"])).toBe("PR(s) Open");
    expect(deriveTaskSummary(["Open", "Closed (Unmerged)", "Merged"])).toBe("PR(s) Open");
  });

  it("returns 'PR(s) Open' when all PRs are Closed (Unmerged) — task not ready (F3+F5)", () => {
    expect(deriveTaskSummary(["Closed (Unmerged)", "Closed (Unmerged)"])).toBe("PR(s) Open");
  });
});

// ---------------------------------------------------------------------------
// deduplicateByNumber (AC4)
// ---------------------------------------------------------------------------

describe("deduplicateByNumber (AC4)", () => {
  it("removes duplicate PRs by number and keeps first occurrence", () => {
    const prs: GhPullRequest[] = [basePr({ number: 1, title: "first" }), basePr({ number: 2, title: "second" }), basePr({ number: 1, title: "duplicate" })];
    const result = deduplicateByNumber(prs);
    expect(result).toHaveLength(2);
    expect(result.find((p) => p.number === 1)!.title).toBe("first");
  });

  it("returns [] for empty input", () => {
    expect(deduplicateByNumber([])).toEqual([]);
  });

  it("returns same length when no duplicates (AC4 happy-path)", () => {
    expect(deduplicateByNumber([basePr({ number: 1 }), basePr({ number: 2 })])).toHaveLength(2);
  });

  it("handles a single PR (AC4 singleton)", () => {
    expect(deduplicateByNumber([basePr({ number: 42, title: "only" })])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildReportSummary (AC5 / F5 global rollup)
// ---------------------------------------------------------------------------

describe("buildReportSummary (AC5 global rollup)", () => {
  it("counts zeroes correctly for an empty task list", () => {
    expect(buildReportSummary([])).toEqual({ totalTasks: 0, allMerged: 0, someOpen: 0, noPrFound: 0 });
  });

  it("partitions tasks into the correct buckets", () => {
    const tasks: TaskStatusEntry[] = [
      { taskId: "A", prs: [], summary: "All PRs Merged" },
      { taskId: "B", prs: [], summary: "All PRs Merged" },
      { taskId: "C", prs: [], summary: "PR(s) Open" },
      { taskId: "D", prs: [], summary: "PR(s) Open" },
      { taskId: "E", prs: [], summary: "PR(s) Open" },
      { taskId: "F", prs: [], summary: "No PR Found" },
    ];
    expect(buildReportSummary(tasks)).toEqual({ totalTasks: 6, allMerged: 2, someOpen: 3, noPrFound: 1 });
  });

  it("sums correctly (total = allMerged + someOpen + noPrFound) invariant", () => {
    const tasks: TaskStatusEntry[] = [
      { taskId: "X", prs: [], summary: "All PRs Merged" },
      { taskId: "Y", prs: [], summary: "No PR Found" },
    ];
    const s = buildReportSummary(tasks);
    expect(s.totalTasks).toBe(s.allMerged + s.someOpen + s.noPrFound);
  });
});

// ---------------------------------------------------------------------------
// buildTextReport — AC5 + F5 human-readable report
// ---------------------------------------------------------------------------

describe("buildTextReport (AC5: clear & concise human-readable output + F5)", () => {
  const prMerged = (number: number, title: string): PrResult => ({
    number,
    title,
    url: `https://github.com/o/r/pull/${number}`,
    state: "Merged",
    author: "alice",
    createdAt: "2025-01-01T00:00:00Z",
    repo: "my-repo",
  });

  const prOpen = (number: number, title: string): PrResult => ({
    number,
    title,
    url: `https://github.com/o/r/pull/${number}`,
    state: "Open",
    author: "bob",
    createdAt: "2025-02-01T00:00:00Z",
  });

  it("includes headers and an overall summary line", () => {
    const report = buildTextReport({
      tasks: [{ taskId: "T-1", prs: [], summary: "No PR Found" }],
      summary: { totalTasks: 1, allMerged: 0, someOpen: 0, noPrFound: 1 },
    });
    expect(report).toContain("Task PR Status Report");
    expect(report).toContain("Total tasks:");
    expect(report).toContain("T-1");
    expect(report).toContain("No PR Found");
  });

  it("renders PR rows with URL and state for AC4 multi-PR display", () => {
    const report = buildTextReport({
      tasks: [
        {
          taskId: "FEAT-42",
          prs: [prMerged(10, "FEAT-42 fix"), prOpen(11, "FEAT-42 follow-up")],
          summary: "PR(s) Open",
        },
      ],
      summary: { totalTasks: 1, allMerged: 0, someOpen: 1, noPrFound: 0 },
    });
    expect(report).toContain("[#10]");
    expect(report).toContain("Merged");
    expect(report).toContain("[#11]");
    expect(report).toContain("Open");
    expect(report).toContain("https://github.com/o/r/pull/");
    expect(report).toContain("Summary:");
    expect(report).toContain("not ready");
  });

  it("renders 'ready for release' for All PRs Merged (AC1 + F5 summary)", () => {
    const report = buildTextReport({
      tasks: [{ taskId: "REL-1", prs: [prMerged(1, "done")], summary: "All PRs Merged" }],
      summary: { totalTasks: 1, allMerged: 1, someOpen: 0, noPrFound: 0 },
    });
    expect(report).toContain("ready for release");
  });
});

// ---------------------------------------------------------------------------
// runTaskPrStatus — validation path (AC6 / F1 / F4)
// ---------------------------------------------------------------------------

describe("runTaskPrStatus validation (AC6)", () => {
  // These guards run BEFORE any network call or token lookup, so they are
  // deterministic regardless of whether GITHUB_TOKEN is present in the env.

  it("throws informative error when taskIds is empty (F1 + AC6)", async () => {
    await expect(runTaskPrStatus({ taskIds: [], owner: "org" })).rejects.toThrow(/taskIds/);
  });

  it("throws informative error when owner is empty (F4 + AC6)", async () => {
    await expect(runTaskPrStatus({ taskIds: ["T-1"], owner: "" })).rejects.toThrow(/owner/i);
  });

  it("throws informative error when owner is only whitespace (F4 + AC6)", async () => {
    await expect(runTaskPrStatus({ taskIds: ["T-1"], owner: "   " })).rejects.toThrow(/owner/i);
  });
});
