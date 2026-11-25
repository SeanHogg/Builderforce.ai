import { describe, expect, it } from "vitest";
import { LIVE_FANOUT_NEXT, RESOLVE_OPEN_ISSUES, VERIFY_DELEGATION_STEP, VERIFY_STEP, childReportText, ownerSections, ownerSectionsChars } from "./live-subagent-tools.js";

const report = { handle: "a1", name: "Developer", label: "#7 Drawer", state: "done" as const, output: "Moved it." };

describe("childReportText", () => {
  it("hands the owner each open issue as work it must resolve", () => {
    const text = childReportText({ ...report, openIssues: ["b.tsx still imports the old modal"] });
    expect(text).toContain("yours before you finish");
    expect(text).toContain(RESOLVE_OPEN_ISSUES);
    expect(text).toContain("- b.tsx still imports the old modal");
  });

  it("makes a failed slice the owner's to finish, even when it named nothing", () => {
    expect(childReportText({ ...report, state: "failed", output: "model unavailable" })).toContain("the whole slice: it failed");
  });

  it("adds nothing for a clean report", () => {
    expect(childReportText(report)).not.toContain("Open issues");
    expect(childReportText(report)).not.toContain("Unverified claims");
  });

  it("tells the owner to check each unverified claim before relaying it", () => {
    const text = childReportText({ ...report, unverifiedClaims: ["X does not exist.", "Y is impossible."] });
    expect(text).toContain("Unverified claims — check each with one search before relaying or acting on it:\n- X does not exist.\n- Y is impossible.");
  });

  it("renders a capped claims list with its 'more' marker as a bullet, like open issues", () => {
    const text = childReportText({ ...report, unverifiedClaims: ["X does not exist.", "…and 3 more — see the full report"] });
    expect(text).toContain("- …and 3 more — see the full report");
  });

  it("counts the owner sections against the report budget", () => {
    expect(ownerSectionsChars(report)).toBe(0);
    const claims = { ...report, unverifiedClaims: ["X does not exist."] };
    expect(ownerSectionsChars(claims)).toBe(ownerSections(claims)[1].length + 2);
  });
});

describe("verifying on the cheaper tier", () => {
  it("tells the owner to hand checking to a verify sub-agent and keep the fixing", () => {
    expect(VERIFY_DELEGATION_STEP).toContain('role "verify"');
    expect(VERIFY_DELEGATION_STEP).toContain("Fix what it reports");
    expect(LIVE_FANOUT_NEXT).toContain(VERIFY_DELEGATION_STEP);
    expect(LIVE_FANOUT_NEXT).toContain("resolve every open issue");
  });

  it("falls back to the run's own narrowest checks where it cannot spawn", () => {
    expect(VERIFY_STEP.startsWith(VERIFY_DELEGATION_STEP)).toBe(true);
    expect(VERIFY_STEP).toContain("Where you cannot spawn");
  });
});
