import { describe, it, expect } from "vitest";
import {
  branchForTicket,
  classify,
  formatReview,
  formatRow,
  isOpenTicket,
  taskIdFromBranch,
  type ReviewRow,
  type ReviewTicket,
} from "./ticketBranchReview";
import type { BranchComparison } from "./gitBranchFacts";

const cmp = (ahead: number, behind: number, merge: BranchComparison["merge"], conflictFiles: string[] = []): BranchComparison => ({
  ahead, behind, merge, conflictFiles,
});
const ticket = (id: number, extra: Partial<ReviewTicket> = {}): ReviewTicket => ({ id, title: `Ticket ${id}`, status: "in_progress", ...extra });

describe("classify", () => {
  it("sorts every combination into the verdict a reviewer acts on", () => {
    expect(classify(ticket(1), undefined, false, undefined)).toBe("no_branch");
    expect(classify(ticket(1), "b", false, undefined)).toBe("branch_missing");
    expect(classify(ticket(1), "b", true, cmp(0, 5, "in_base"))).toBe("in_base");
    expect(classify(ticket(1), "b", true, cmp(3, 5, "in_base"))).toBe("in_base");
    expect(classify(ticket(1), "b", true, cmp(3, 5, "clean"))).toBe("ready");
    expect(classify(ticket(1), "b", true, cmp(3, 5, "conflicts", ["a.ts"]))).toBe("conflicts");
    expect(classify(ticket(1), "b", true, cmp(3, 5, "unknown"))).toBe("unknown");
  });

  it("reads a merged PR whose branch still differs as a squash-merge leftover, even when it 'conflicts'", () => {
    // Task #89 in the measured review: PR merged, branch 8 commits ahead — not pending work.
    expect(classify(ticket(89, { prState: "merged" }), "builderforce/task-89", true, cmp(8, 400, "conflicts", ["x.tsx"]))).toBe("merged_pr_leftover");
  });
});

describe("branch matching", () => {
  it("uses the ticket's own branch, else the task-<id> convention", () => {
    const names = new Set(["builderforce/task-58", "codex/other"]);
    expect(branchForTicket(ticket(1, { gitBranch: "feature/x" }), names)).toBe("feature/x");
    expect(branchForTicket(ticket(58), names)).toBe("builderforce/task-58");
    expect(branchForTicket(ticket(59), names)).toBeUndefined();
    expect(taskIdFromBranch("builderforce/task-1224")).toBe(1224);
    expect(taskIdFromBranch("codex/manager-reliability")).toBeUndefined();
  });

  it("treats done/cancelled as closed", () => {
    expect(isOpenTicket("in_progress")).toBe(true);
    expect(isOpenTicket("done")).toBe(false);
    expect(isOpenTicket("cancelled")).toBe(false);
    expect(isOpenTicket(undefined)).toBe(true);
  });
});

describe("formatReview", () => {
  const rows: ReviewRow[] = [
    { ticket: ticket(2395, { prNumber: 40, prState: "open" }), branch: "builderforce/task-2395", comparison: cmp(3, 12, "clean"), verdict: "ready" },
    { ticket: ticket(58, { status: "cancelled", prNumber: 30, prState: "closed" }), branch: "builderforce/task-58", comparison: cmp(21, 340, "conflicts", ["a.ts", "b.ts"]), verdict: "conflicts" },
    { ticket: ticket(7), verdict: "no_branch" },
  ];

  it("leads with counts, then each group in acting order, with the next step for each", () => {
    const out = formatReview({ repo: "Builderforce.ai", base: "origin/main", fetched: true, rows, untracked: [] });
    expect(out.summary).toEqual({ ready: 1, conflicts: 1, no_branch: 1 });
    expect(out.ready).toEqual(["#2395 [in_progress] builderforce/task-2395 +3/-12 PR#40 open — Ticket 2395"]);
    expect((out.conflicts as string[])[0]).toContain("conflicts: a.ts, b.ts");
    expect(out.no_branch).toBe("tickets #7");
    expect(Object.keys(out.next as object)).toEqual(["ready", "conflicts", "no_branch"]);
  });

  it("counts what did not fit rather than letting the transcript cap cut it mid-list", () => {
    const many: ReviewRow[] = Array.from({ length: 200 }, (_, i) => ({
      ticket: ticket(i + 1, { title: "x".repeat(60) }),
      branch: `builderforce/task-${i + 1}`,
      comparison: cmp(1, 1, "clean"),
      verdict: "ready" as const,
    }));
    const out = formatReview({ repo: ".", base: "origin/main", fetched: true, rows: many, untracked: [] });
    expect(JSON.stringify(out).length).toBeLessThan(6_000);
    expect((out.ready as string[]).length).toBeLessThan(200);
    expect(String(out.note)).toMatch(/only/);
  });

  it("returns one group in full when asked, and says when origin could not be fetched", () => {
    const out = formatReview({ repo: ".", base: "main", fetched: false, rows, untracked: [], only: "conflicts" });
    expect(out.ready).toBeUndefined();
    expect(out.conflicts).toBeDefined();
    expect(String(out.note)).toMatch(/Could not fetch/);
  });

  it("formats a remote-only branch and a missing PR plainly", () => {
    expect(formatRow({ ticket: ticket(5), branch: "b", remoteOnly: true, comparison: cmp(2, 0, "clean"), verdict: "ready" }))
      .toBe("#5 [in_progress] b (origin only) +2/-0 — Ticket 5");
  });
});
