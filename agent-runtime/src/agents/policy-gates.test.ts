import { describe, expect, it } from "vitest";
import { allowedToolsAfterGates } from "../../test/helpers/gatedTools.js";
import { renderPolicyDirectives } from "@builderforce/agent-tools";

describe("on-prem governance — allowedToolsAfterGates", () => {
  it("returns every SDK tool when there are no gates", () => {
    // `Task` (the SDK's subagent tool) is part of the V2 surface — see SDK_TOOLS.
    expect(allowedToolsAfterGates(undefined)).toEqual([
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "Task",
    ]);
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

  it("keeps a tool when the block is path-scoped (per-call canUseTool refuses matching paths)", () => {
    const tools = allowedToolsAfterGates([
      { id: "g1", effect: "block", tool: "Write", paths: ["secrets/**"], reason: "no secrets" },
    ]);
    expect(tools).toContain("Write");
  });

  it("renderPolicyDirectives produces a binding governance block on-prem", () => {
    const block = renderPolicyDirectives([{ id: "g1", effect: "block", tool: "Bash", reason: "no shell in prod" }]);
    expect(block).toContain("Governance");
    expect(block).toContain("Bash");
    expect(block).toContain("no shell in prod");
  });
});
