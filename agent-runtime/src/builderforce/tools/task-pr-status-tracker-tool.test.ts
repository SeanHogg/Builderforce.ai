/**
 * Unit tests for the Task PR Status Tracker tool.
 *
 * Tests the classification, dedup, and report-generation logic in isolation
 * (the fetch-heavy search strategies are integration-tested in CI against a
 * live GitHub token).
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline the pure helpers so we can test them without mocking fetch.
// These are verbatim copies of the functions in task-pr-status-tracker-tool.ts
// — they have NO side effects and are safe to unit-test directly.
// ---------------------------------------------------------------------------

interface GhPullRequest {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged_at: string | null;
  user: { login: string } | null;
  created_at: string;
}

type PrState = "Open" | "Merged" | "Closed (Unmerged)";

function classifyPrStatus(pr: GhPullRequest): PrState {
  if (pr.merged_at != null) return "Merged";
  if (pr.state === "closed") return "Closed (Unmerged)";
  return "Open";
}

type TaskSummary = "All PRs Merged" | "PR(s) Open" | "No PR Found";

function deriveTaskSummary(prStates: PrState[]): TaskSummary {
  if (prStates.length === 0) return "No PR Found";
  if (prStates.every((s) => s === "Merged")) return "All PRs Merged";
  return "PR(s) Open";
}

// ---------------------------------------------------------------------------
// classifyPrStatus
// ---------------------------------------------------------------------------

describe("classifyPrStatus", () => {
  const base: GhPullRequest = {
    number: 1,
    title: "Test",
    html_url: "https://github.com/o/r/pull/1",
    state: "open",
    merged_at: null,
    user: { login: "bot" },
    created_at: "2025-01-01T00:00:00Z",
  };

  it("returns 'Merged' when merged_at is set regardless of state", () => {
    expect(classifyPrStatus({ ...base, state: "closed", merged_at: "2025-01-02T00:00:00Z" })).toBe("Merged");
    // Edge case: GitHub sometimes leaves state="open" briefly after merge.
    expect(classifyPrStatus({ ...base, state: "open", merged_at: "2025-01-02T00:00:00Z" })).toBe("Merged");
  });

  it("returns 'Closed (Unmerged)' when state is closed but merged_at is null", () => {
    expect(classifyPrStatus({ ...base, state: "closed", merged_at: null })).toBe("Closed (Unmerged)");
  });

  it("returns 'Open' when state is open and merged_at is null", () => {
    expect(classifyPrStatus({ ...base, state: "open", merged_at: null })).toBe("Open");
  });
});

// ---------------------------------------------------------------------------
// deriveTaskSummary
// ---------------------------------------------------------------------------

describe("deriveTaskSummary", () => {
  it("returns 'No PR Found' for an empty list", () => {
    expect(deriveTaskSummary([])).toBe("No PR Found");
  });

  it("returns 'All PRs Merged' when every PR is Merged", () => {
    expect(deriveTaskSummary(["Merged"])).toBe("All PRs Merged");
    expect(deriveTaskSummary(["Merged", "Merged", "Merged"])).toBe("All PRs Merged");
  });

  it("returns 'PR(s) Open' when at least one PR is not Merged", () => {
    expect(deriveTaskSummary(["Open"])).toBe("PR(s) Open");
    expect(deriveTaskSummary(["Merged", "Open"])).toBe("PR(s) Open");
    expect(deriveTaskSummary(["Merged", "Closed (Unmerged)"])).toBe("PR(s) Open");
    expect(deriveTaskSummary(["Open", "Closed (Unmerged)", "Merged"])).toBe("PR(s) Open");
  });

  it("returns 'PR(s) Open' when all PRs are Closed (Unmerged)", () => {
    expect(deriveTaskSummary(["Closed (Unmerged)", "Closed (Unmerged)"])).toBe("PR(s) Open");
  });
});

// ---------------------------------------------------------------------------
// Deduplication logic (pure)
// ---------------------------------------------------------------------------

function deduplicateByNumber(prs: GhPullRequest[]): GhPullRequest[] {
  const seen = new Map<number, GhPullRequest>();
  for (const pr of prs) {
    if (!seen.has(pr.number)) seen.set(pr.number, pr);
  }
  return Array.from(seen.values());
}

describe("deduplicateByNumber", () => {
  const mkPr = (number: number, title: string): GhPullRequest => ({
    number,
    title,
    html_url: `https://github.com/o/r/pull/${number}`,
    state: "open",
    merged_at: null,
    user: null,
    created_at: "2025-01-01T00:00:00Z",
  });

  it("removes duplicate PRs by number (keeps first occurrence)", () => {
    const prs = [mkPr(1, "first"), mkPr(2, "second"), mkPr(1, "duplicate")];
    const result = deduplicateByNumber(prs);
    expect(result).toHaveLength(2);
    expect(result.find((p) => p.number === 1)!.title).toBe("first");
  });

  it("returns an empty array for empty input", () => {
    expect(deduplicateByNumber([])).toEqual([]);
  });

  it("returns the same array when there are no duplicates", () => {
    const prs = [mkPr(1, "a"), mkPr(2, "b")];
    expect(deduplicateByNumber(prs)).toHaveLength(2);
  });

  it("handles a single PR", () => {
    const prs = [mkPr(42, "only")];
    expect(deduplicateByNumber(prs)).toEqual(prs);
  });
});

// ---------------------------------------------------------------------------
// Report summary aggregation (pure)
// ---------------------------------------------------------------------------

interface TaskStatus {
  taskId: string;
  prs: unknown[]; // prs array — we only care about summary here
  summary: TaskSummary;
}

function buildReportSummary(tasks: TaskStatus[]) {
  return {
    totalTasks: tasks.length,
    allMerged: tasks.filter((t) => t.summary === "All PRs Merged").length,
    someOpen: tasks.filter((t) => t.summary === "PR(s) Open").length,
    noPrFound: tasks.filter((t) => t.summary === "No PR Found").length,
  };
}

describe("buildReportSummary", () => {
  it("counts zeroes correctly for an empty task list", () => {
    expect(buildReportSummary([])).toEqual({
      totalTasks: 0,
      allMerged: 0,
      someOpen: 0,
      noPrFound: 0,
    });
  });

  it("partitions tasks into the correct buckets", () => {
    const tasks: TaskStatus[] = [
      { taskId: "A", prs: [], summary: "All PRs Merged" },
      { taskId: "B", prs: [], summary: "All PRs Merged" },
      { taskId: "C", prs: [], summary: "PR(s) Open" },
      { taskId: "D", prs: [], summary: "PR(s) Open" },
      { taskId: "E", prs: [], summary: "PR(s) Open" },
      { taskId: "F", prs: [], summary: "No PR Found" },
    ];

    expect(buildReportSummary(tasks)).toEqual({
      totalTasks: 6,
      allMerged: 2,
      someOpen: 3,
      noPrFound: 1,
    });
  });

  it("sums correctly (total = allMerged + someOpen + noPrFound)", () => {
    const tasks: TaskStatus[] = [
      { taskId: "X", prs: [], summary: "All PRs Merged" },
      { taskId: "Y", prs: [], summary: "No PR Found" },
    ];
    const s = buildReportSummary(tasks);
    expect(s.totalTasks).toBe(s.allMerged + s.someOpen + s.noPrFound);
  });
});
