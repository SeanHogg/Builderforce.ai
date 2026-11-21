import { describe, expect, it } from "vitest";
import { CLAIMED_COMPLETE_PROGRESS_CAP } from "@builderforce/agent-loop";
import type { TicketValue } from "@builderforce/local-first";
import { railTicketProgress } from "./railPayloads";

const row = (extra: Partial<TicketValue> & { progressPct?: number; railKind?: string }) =>
  ({ projectId: "p", title: "t", status: "in_progress", ...extra }) as TicketValue & { progressPct?: number; railKind?: string };

/** The rail applies the same "only a closed lane emits 100" rule as the server. */
describe("railTicketProgress", () => {
  it("regression: an open task-table row still carrying 100 reads the claimed-complete rung", () => {
    for (const railKind of ["task", "epic", "gap"]) {
      expect(railTicketProgress(row({ railKind, status: "in_progress", progressPct: 100 })).progressPct)
        .toBe(CLAIMED_COMPLETE_PROGRESS_CAP);
    }
  });

  it("regression: a locally authored row (no railKind) is a task — open at 100 reads the cap", () => {
    expect(railTicketProgress(row({ status: "in_review", progressPct: 100 })).progressPct)
      .toBe(CLAIMED_COMPLETE_PROGRESS_CAP);
  });

  it("a closed task-table lane reads 100 whatever percent the record carries", () => {
    expect(railTicketProgress(row({ railKind: "epic", status: "done", progressPct: 60 })))
      .toMatchObject({ progressPct: 100, done: 1, total: 1 });
  });

  it("regression: a spec/roadmap row at 100 in its own terminal status stays 100", () => {
    expect(railTicketProgress(row({ railKind: "spec", status: "complete", progressPct: 100 })).progressPct).toBe(100);
    expect(railTicketProgress(row({ railKind: "roadmap", status: "shipped", progressPct: 100 })).progressPct).toBe(100);
  });

  it("regression: an active initiative / objective / portfolio / poker row at 100 reads the claimed-complete rung", () => {
    for (const railKind of ["initiative", "objective", "portfolio", "poker"]) {
      expect(railTicketProgress(row({ railKind, status: "active", progressPct: 100 })).progressPct)
        .toBe(CLAIMED_COMPLETE_PROGRESS_CAP);
    }
  });

  it("a non-task tier closed in its own vocabulary reads 100 whatever percent the record carries", () => {
    expect(railTicketProgress(row({ railKind: "initiative", status: "completed", progressPct: 50 })))
      .toMatchObject({ progressPct: 100, done: 1, total: 1 });
    expect(railTicketProgress(row({ railKind: "spec", status: "complete", progressPct: 0 })).progressPct).toBe(100);
    expect(railTicketProgress(row({ railKind: "objective", status: "achieved", progressPct: 60 })).progressPct).toBe(100);
  });

  it("regression: an archived record still in the backlog lane reads archived, 100, closed", () => {
    for (const railKind of ["task", "epic", "gap"]) {
      expect(railTicketProgress(row({ railKind, status: "backlog", archived: true, progressPct: 0 })))
        .toMatchObject({ status: "archived", progressPct: 100, done: 1, total: 1 });
    }
    // A locally authored record (no railKind, no progress) too.
    expect(railTicketProgress(row({ status: "backlog", archived: true })))
      .toMatchObject({ status: "archived", progressPct: 100 });
  });

  it("an open, unarchived backlog row is unchanged", () => {
    expect(railTicketProgress(row({ railKind: "task", status: "backlog", archived: false, progressPct: 0, done: 0, total: 1 })))
      .toMatchObject({ status: "backlog", progressPct: 0, done: 0, total: 1 });
  });

  it("a task-lane word does not close a spec: an open spec keeps its raw figure", () => {
    expect(railTicketProgress(row({ railKind: "spec", status: "in_progress", progressPct: 50 })).progressPct).toBe(50);
  });
});
