import { describe, expect, it } from "vitest";
import { allowedToolsAfterGates, offeredTools } from "../../test/helpers/gatedTools.js";
import { gatewayHeaders } from "../run/gatewayModelTransport.js";

/**
 * The headers the run sends on every gateway request. They are the ONE seam a runner has to
 * declare what kind of traffic it is: the gateway attributes usage from them, and its
 * fail-closed BYO rule (GAP-B2/B4) uses them to tell a CLOUD agent execution — which must
 * run on the workspace's own provider credential — from ordinary on-prem traffic, which
 * keeps its platform-pool floor. (Cases carried from the SDK runner's header-line test:
 * the declaration is a header map now, the same names and values.)
 */
describe("gatewayHeaders", () => {
  it("defaults to on_prem — a self-hosted host is never fail-closed", () => {
    expect(gatewayHeaders({})).toEqual({ "x-builderforce-surface": "on_prem" });
  });

  it("declares a cloud run WITH its execution id, which is what arms the BYO gate", () => {
    expect(gatewayHeaders({ surface: "cloud", executionId: 42 })).toEqual({
      "x-builderforce-surface": "cloud",
      "x-builderforce-execution-id": "42",
    });
  });

  it("omits a missing/degenerate execution id rather than emitting a junk header", () => {
    expect(gatewayHeaders({ surface: "cloud" })).toEqual({ "x-builderforce-surface": "cloud" });
    expect(gatewayHeaders({ surface: "cloud", executionId: Number.NaN })).toEqual({
      "x-builderforce-surface": "cloud",
    });
  });

  it("falls back to on_prem for a blank surface", () => {
    expect(gatewayHeaders({ surface: "   ", executionId: 5 })).toEqual({
      "x-builderforce-surface": "on_prem",
      "x-builderforce-execution-id": "5",
    });
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
    // Asked of the live catalog: a surface that grants `orchestrate` is offered the spawn tool.
    expect(offeredTools(["orchestrate"])).toContain("spawn_agent");
    expect(offeredTools(["orchestrate"], [{ id: "g", effect: "block", tool: "Task" }])).not.toContain("spawn_agent");
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

  it("admits mounted MCP tool entries under the same gates", () => {
    // Asked of the live catalog: the memory tools the `memory` capability backs.
    const memory = "memory_recall";
    expect(offeredTools(["memory"])).toContain(memory);
    expect(offeredTools(["memory"], [{ id: "g", effect: "block", tool: memory }])).not.toContain(memory);
    // A catch-all block leaves only the control tool a run ends with.
    expect(offeredTools(["memory"], [{ id: "g", effect: "block", tool: "*" }])).toEqual(["finish"]);
  });
});
