/**
 * The context policy's recall query — brought from
 * `brain-embedded/src/runStore/recallQuery.test.ts` with imports retargeted only.
 *
 * PRD 35 E2: recall searches with the request plus the focus files it names, never the
 * bare sentence alone.
 */
import { describe, expect, it } from "vitest";
import { MAX_RECALL_HINT_CHARS, recallQuery } from "../src/policy/context/recall.js";

describe("recallQuery", () => {
  it("is the request itself when the host gave no hint", () => {
    expect(recallQuery("review the PRD")).toBe("review the PRD");
    expect(recallQuery("review the PRD", "   ")).toBe("review the PRD");
    expect(recallQuery("review the PRD", null)).toBe("review the PRD");
  });

  it("appends the hint, whitespace collapsed", () => {
    expect(recallQuery("review the PRD ", "docs/specs/35.md\n  1 The rule  2 Why")).toBe(
      "review the PRD\n\ndocs/specs/35.md 1 The rule 2 Why",
    );
  });

  it("caps the hint and never builds a query from the hint alone", () => {
    const q = recallQuery("go", "x".repeat(MAX_RECALL_HINT_CHARS + 50));
    expect(q).toBe(`go\n\n${"x".repeat(MAX_RECALL_HINT_CHARS)}`);
    expect(recallQuery("", "docs/a.md")).toBe("");
  });
});
