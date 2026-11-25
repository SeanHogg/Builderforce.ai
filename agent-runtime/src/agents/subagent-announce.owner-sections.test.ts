import { describe, expect, it } from "vitest";
import { ownerSectionsOf } from "./subagent-announce.js";

describe("ownerSectionsOf", () => {
  it("hands the on-prem owner the open issues and unverified claims a child's findings carry", () => {
    const text = ownerSectionsOf(
      "Outcome: partial\nThe helper does not exist in this package.\nOpen issues:\n- b.tsx still imports the old modal",
    ).join("\n");
    expect(text).toContain("Open issues — yours before you finish");
    expect(text).toContain("- b.tsx still imports the old modal");
    expect(text).toContain("Unverified claims — check each with one search");
    expect(text).toContain("- The helper does not exist in this package.");
  });

  it("adds nothing for a clean report", () => {
    expect(ownerSectionsOf("Outcome: done\nChanged: a.ts\nOpen issues: none")).toEqual([]);
    expect(ownerSectionsOf("(no output)")).toEqual([]);
  });
});
