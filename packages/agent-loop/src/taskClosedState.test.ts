import { describe, expect, it } from "vitest";
import { isClosedTask, isClosedTaskStatus, parseTaskListScope, scopeNeedsArchived, taskInScope } from "./taskClosedState";

describe("taskClosedState", () => {
  it("treats done and cancelled (both spellings) as closed", () => {
    for (const s of ["done", "cancelled", "canceled", "Cancelled", "completed"]) expect(isClosedTaskStatus(s)).toBe(true);
    for (const s of ["todo", "in_progress", "blocked", "", null, undefined]) expect(isClosedTaskStatus(s)).toBe(false);
  });

  it("treats an archived ticket as closed whatever its lane", () => {
    expect(isClosedTask({ status: "in_progress", archived: true })).toBe(true);
    expect(isClosedTask({ status: "in_progress", archived: false })).toBe(false);
  });

  it("splits a list into open and closed scopes", () => {
    const rows = [
      { status: "todo" },
      { status: "cancelled" },
      { status: "done" },
      { status: "in_review", archived: true },
    ];
    expect(rows.filter((r) => taskInScope(r, "open"))).toEqual([{ status: "todo" }]);
    expect(rows.filter((r) => taskInScope(r, "closed"))).toHaveLength(3);
    expect(rows.filter((r) => taskInScope(r, "all"))).toHaveLength(4);
  });

  it("parses untrusted scopes and knows which need archived rows", () => {
    expect(parseTaskListScope("closed", "open")).toBe("closed");
    expect(parseTaskListScope("bogus", "all")).toBe("all");
    expect(parseTaskListScope(undefined, "open")).toBe("open");
    expect(scopeNeedsArchived("open")).toBe(false);
    expect(scopeNeedsArchived("closed")).toBe(true);
  });
});
