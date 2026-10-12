import { describe, expect, it } from "vitest";
import { renderWorkspaceRules, withRunPreamble } from "./runPreamble";

describe("withRunPreamble", () => {
  it("leaves the prompt untouched with no gates and no rules", () => {
    expect(withRunPreamble("BASE", {})).toBe("BASE");
    expect(withRunPreamble("BASE", { gates: [], rules: "   " })).toBe("BASE");
  });

  it("orders governance, then workspace rules, then the host prompt", () => {
    const out = withRunPreamble("BASE", {
      gates: [{ id: "g", effect: "block", tool: "git_push", reason: "frozen" }],
      rules: "Always write tests.",
    });
    const governance = out.indexOf("Governance");
    const rules = out.indexOf("Always write tests.");
    expect(governance).toBe(0);
    expect(rules).toBeGreaterThan(governance);
    expect(out.endsWith("\n\nBASE")).toBe(true);
  });
});

describe("renderWorkspaceRules", () => {
  it("names its source and truncates an oversized file", () => {
    expect(renderWorkspaceRules("Use pnpm.")).toContain(".builderforce/rules.md");
    expect(renderWorkspaceRules("x".repeat(20_000))).toContain("(rules truncated)");
  });
});
