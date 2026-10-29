import { describe, expect, it } from "vitest";
import { childReportText, isChildReportText } from "./live-subagent-tools.js";

const report = { handle: "a1", name: "Developer", label: "Implement the drawer", state: "done" as const, output: "Moved it." };

describe("isChildReportText — an owner's wake turn, not a person's request", () => {
  it("recognises the reports its children hand it, alone or joined", () => {
    expect(isChildReportText(childReportText(report))).toBe(true);
    expect(isChildReportText([childReportText(report), childReportText({ ...report, handle: "a2" })].join("\n\n"))).toBe(true);
  });

  it("reads a person's message as a request", () => {
    expect(isChildReportText("Implement the drawer")).toBe(false);
    expect(isChildReportText("")).toBe(false);
    expect(isChildReportText(undefined)).toBe(false);
  });
});
