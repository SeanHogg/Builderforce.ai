import { describe, expect, it, vi } from "vitest";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import type { HumanInputResult } from "../infra/approval-gate.js";
import { onPremHuman } from "./onPremHuman.js";

const provider = (human?: CapabilityProvider["human"]): CapabilityProvider => ({ capabilities: new Set(), ...(human ? { human } : {}) });
const GATE = { id: "ask-first", effect: "require-approval" as const, tool: "run_command", reason: "shell needs a person" };
const CALL = { tool: "run_command", args: { command: "ls" }, reason: "shell needs a person" };

describe("onPremHuman — approve", () => {
  const approving = (result: HumanInputResult) => {
    const request = vi.fn(async () => result);
    return { channel: onPremHuman(() => provider(), request), request };
  };

  it("puts the call in front of the approver and reads the gate's decision as the structured outcome", async () => {
    const { channel, request } = approving({ decision: "approved", responseText: "go ahead" });
    expect(await channel.approve?.(GATE, CALL)).toEqual({ kind: "answered", answer: "go ahead", approved: true });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "approval",
        actionType: "tool.run_command",
        description: expect.stringContaining('"command":"ls"'),
        metadata: { gateId: "ask-first", tool: "run_command", args: { command: "ls" } },
      }),
    );
  });

  it("reads a rejection and a timeout as NOT approved", async () => {
    expect(await approving({ decision: "rejected", responseText: "not on prod" }).channel.approve?.(GATE, CALL)).toEqual({
      kind: "answered",
      answer: "not on prod",
      approved: false,
    });
    expect(await approving({ decision: "timeout" }).channel.approve?.(GATE, CALL)).toMatchObject({ kind: "answered", approved: false });
  });

  it("never reads approval out of the words of a free-text answer", async () => {
    expect(await approving({ decision: "answered", responseText: "approved!" }).channel.approve?.(GATE, CALL)).toMatchObject({ approved: false });
  });
});

describe("onPremHuman — ask", () => {
  it("asks through the provider's human capability and returns the answer inline", async () => {
    const ask = vi.fn(async () => ({ paused: false, answer: "CSV" }));
    const channel = onPremHuman(() => provider({ ask }));
    expect(await channel.ask("CSV or XLSX?", ["CSV", "XLSX"])).toEqual({ kind: "answered", answer: "CSV" });
    expect(ask).toHaveBeenCalledWith("CSV or XLSX?", "Options: CSV | XLSX");
  });

  it("has nobody to ask without the capability", async () => {
    expect(await onPremHuman(() => provider()).ask("anyone?")).toEqual({ kind: "paused" });
  });
});
