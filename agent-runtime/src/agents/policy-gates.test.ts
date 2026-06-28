import { describe, expect, it } from "vitest";
import { allowedToolsAfterGates } from "./claude-agent-sdk-runner.js";
import { renderPolicyDirectives } from "@builderforce/agent-tools";

describe("on-prem governance — allowedToolsAfterGates", () => {
  it("returns every SDK tool when there are no gates", () => {
    expect(allowedToolsAfterGates(undefined)).toEqual(["Read", "Write", "Edit", "Bash", "Glob", "Grep"]);
  });

  it("removes a tool a block gate names (case-insensitive)", () => {
    const tools = allowedToolsAfterGates([{ id: "g1", effect: "block", tool: "bash" }]);
    expect(tools).not.toContain("Bash");
    expect(tools).toContain("Read");
  });

  it("removes every tool when a block gate has no tool / '*'", () => {
    expect(allowedToolsAfterGates([{ id: "g1", effect: "block" }])).toEqual([]);
    expect(allowedToolsAfterGates([{ id: "g1", effect: "block", tool: "*" }])).toEqual([]);
  });

  it("ignores non-block gates for the allowlist (they render as directives instead)", () => {
    const tools = allowedToolsAfterGates([{ id: "g1", effect: "require-approval", tool: "Write" }]);
    expect(tools).toContain("Write");
  });

  it("renderPolicyDirectives produces a binding governance block on-prem", () => {
    const block = renderPolicyDirectives([{ id: "g1", effect: "block", tool: "Bash", reason: "no shell in prod" }]);
    expect(block).toContain("Governance");
    expect(block).toContain("Bash");
    expect(block).toContain("no shell in prod");
  });
});
