import { describe, expect, it } from "vitest";
import { allowedToolsAfterGates, buildGatewayHeaders } from "./claude-agent-sdk-runner.js";

/**
 * The header string the SDK sends on every gateway request. It is the ONE seam a
 * runner has to declare what kind of traffic it is: the gateway attributes usage
 * from it, and its fail-closed BYO rule (GAP-B2/B4) uses it to tell a CLOUD agent
 * execution — which must run on the workspace's own provider credential — from
 * ordinary on-prem traffic, which keeps its platform-pool floor.
 */
describe("buildGatewayHeaders", () => {
  it("defaults to on_prem — a self-hosted host is never fail-closed", () => {
    expect(buildGatewayHeaders({})).toBe("x-builderforce-surface: on_prem");
  });

  it("declares a cloud run WITH its execution id, which is what arms the BYO gate", () => {
    expect(buildGatewayHeaders({ surface: "cloud", executionId: 42 })).toBe(
      "x-builderforce-surface: cloud, x-builderforce-execution-id: 42",
    );
  });

  it("omits a missing/degenerate execution id rather than emitting a junk header", () => {
    expect(buildGatewayHeaders({ surface: "cloud" })).toBe("x-builderforce-surface: cloud");
    expect(buildGatewayHeaders({ surface: "cloud", executionId: Number.NaN })).toBe(
      "x-builderforce-surface: cloud",
    );
  });

  it("falls back to on_prem for a blank surface", () => {
    expect(buildGatewayHeaders({ surface: "   ", executionId: 5 })).toBe(
      "x-builderforce-surface: on_prem, x-builderforce-execution-id: 5",
    );
  });
});

describe("allowedToolsAfterGates", () => {
  it("keeps the full vocabulary with no gates", () => {
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

  // `allowedTools` is passed verbatim to the SDK, so this list is what the agent CAN
  // call, not merely what a gate can remove. Delegation is a V1 capability
  // (`sessions_spawn`); dropping the name here reduced V2 below parity.
  it("advertises the subagent tool so V2 can delegate", () => {
    expect(allowedToolsAfterGates(undefined)).toContain("Task");
  });

  it("lets a block gate withhold delegation", () => {
    expect(
      allowedToolsAfterGates([{ id: "g", effect: "block", tool: "task" } as never]),
    ).not.toContain("Task");
  });

  it("removes a blocked tool (case-insensitive)", () => {
    expect(
      allowedToolsAfterGates([{ id: "g", effect: "block", tool: "bash" } as never]),
    ).not.toContain("Bash");
  });

  it("a wildcard block removes every tool", () => {
    expect(allowedToolsAfterGates([{ id: "g", effect: "block", tool: "*" } as never])).toEqual([]);
  });
});
