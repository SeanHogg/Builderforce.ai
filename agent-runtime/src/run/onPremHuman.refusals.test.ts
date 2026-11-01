/**
 * A governance gate's approval fails closed on EVERY path that builds the human channel (tickets build it with no wrapper), and a
 * refusal says why in a structured field: nobody answered in time, no approver could be reached, the run was stopped. A person's
 * "no" carries no refusal (it is a decline).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import { approvalGate, type HumanInputResult } from "../infra/approval-gate.js";
import { onPremHuman } from "./onPremHuman.js";

const GATE = { id: "ask-first", tool: "run_command", effect: "require-approval" as const };
const CALL = { tool: "run_command", args: { command: "ls" } };
const provider = (): CapabilityProvider => ({ capabilities: new Set() });

afterEach(() => {
  (approvalGate as unknown as { baseUrl: string | null }).baseUrl = null;
  vi.unstubAllGlobals();
});

describe("how an approval that nobody answered reads", () => {
  const approving = (result: HumanInputResult) => onPremHuman(() => provider(), vi.fn(async () => result));

  it("a person's no is a decline: no refusal field", async () => {
    expect(await approving({ decision: "rejected", responseText: "not on prod" }).approve?.(GATE, CALL)).toEqual({ kind: "answered", answer: "not on prod", approved: false });
  });

  it("nobody answered in time", async () => {
    expect(await approving({ decision: "timeout" }).approve?.(GATE, CALL)).toMatchObject({ approved: false, refusal: "timed_out" });
  });

  it("no approver could be reached (the gate's structured reason, not a guess)", async () => {
    expect(await approving({ decision: "rejected", reason: "unreachable" }).approve?.(GATE, CALL)).toMatchObject({ approved: false, refusal: "unreachable" });
  });

  it("the run was stopped (the gate's structured reason, not inferred from a signal)", async () => {
    expect(await approving({ decision: "rejected", reason: "stopped" }).approve?.(GATE, CALL)).toMatchObject({ approved: false, refusal: "stopped" });
  });
});

describe("a gate approval fails closed without the caller asking", () => {
  it("asks the gate to fail closed", async () => {
    const request = vi.fn(async (): Promise<HumanInputResult> => ({ decision: "approved" }));
    await onPremHuman(() => provider(), request).approve?.(GATE, CALL);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ failClosed: true }));
  });

  it("a failed approval request is refused as unreachable, not waved through (the default channel, as tickets build it)", async () => {
    approvalGate.init({ baseUrl: "https://bf.test", agentNodeId: "7", apiKey: "k" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    expect(await onPremHuman(() => provider()).approve?.(GATE, CALL)).toMatchObject({ kind: "answered", approved: false, refusal: "unreachable" });
  });

  it("no link at all is refused as unreachable too", async () => {
    expect(await onPremHuman(() => provider()).approve?.(GATE, CALL)).toMatchObject({ approved: false, refusal: "unreachable" });
  });

  it("an ordinary human ask (not a gate) keeps its standalone default: it is still auto-approved when the request fails", async () => {
    approvalGate.init({ baseUrl: "https://bf.test", agentNodeId: "7", apiKey: "k" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    expect(await approvalGate.request({ actionType: "deploy", description: "ship it" })).toEqual({ decision: "approved" });
  });
});
