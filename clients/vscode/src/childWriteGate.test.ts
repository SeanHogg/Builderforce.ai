import { describe, expect, it, vi } from "vitest";
import { createChildWriteGate } from "./childWriteGate";
import type { PolicyGate } from "@builderforce/agent-tools";

/**
 * The gate that lets a delegated sub-agent write to someone's working tree. What makes
 * it safe is an ORDER — policy, then preference, then the human — and an order is
 * exactly the kind of thing that rots silently, so each step is pinned here.
 */

const { requestRunConfirm } = vi.hoisted(() => ({ requestRunConfirm: vi.fn(async () => true) }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ requestRunConfirm }));

const gate = (over: Partial<Parameters<typeof createChildWriteGate>[0]> = {}) =>
  createChildWriteGate({
    chatId: 7,
    autoApprove: () => false,
    blockedByPolicy: (reason) => `blocked: ${reason}`,
    ...over,
  });

const policy = (tool: string, effect: PolicyGate["effect"]): PolicyGate => ({
  id: `g-${tool}`,
  tool,
  effect,
  reason: `${tool} is governed`,
});

const call = { name: "write_file", args: { path: "a.ts" } };

describe("createChildWriteGate", () => {
  it("asks the human, on the parent run's own chat cell", async () => {
    requestRunConfirm.mockResolvedValueOnce(true);
    await expect(gate()(call)).resolves.toEqual({ ok: true });
    expect(requestRunConfirm).toHaveBeenCalledWith(7, call);
  });

  it("refuses a declined write with a reason that tells the child not to retry", async () => {
    requestRunConfirm.mockResolvedValueOnce(false);
    const decision = await gate()(call);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toContain("declined");
  });

  it("lets Auto through without a prompt, exactly as it does for the parent", async () => {
    requestRunConfirm.mockClear();
    await expect(gate({ autoApprove: () => true })(call)).resolves.toEqual({ ok: true });
    expect(requestRunConfirm).not.toHaveBeenCalled();
  });

  it("reads the Auto switch LIVE, so flipping it mid-run takes effect on the next call", async () => {
    let auto = false;
    const decide = gate({ autoApprove: () => auto });
    requestRunConfirm.mockClear();
    requestRunConfirm.mockResolvedValueOnce(true);
    await decide(call);
    expect(requestRunConfirm).toHaveBeenCalledTimes(1);
    auto = true;
    await decide(call);
    expect(requestRunConfirm).toHaveBeenCalledTimes(1);
  });

  it("prompts through a require-approval gate even with Auto on", async () => {
    // An "acceptEdits" preference cannot waive a COMPILED policy — the same rule the
    // parent's own gate follows.
    requestRunConfirm.mockClear();
    requestRunConfirm.mockResolvedValueOnce(true);
    const decide = gate({ autoApprove: () => true, gates: [policy("write_file", "require-approval")] });
    await expect(decide(call)).resolves.toEqual({ ok: true });
    expect(requestRunConfirm).toHaveBeenCalledTimes(1);
  });

  it("refuses a blocked call outright, and never asks — a block is not askable", async () => {
    requestRunConfirm.mockClear();
    const decide = gate({ autoApprove: () => true, gates: [policy("write_file", "block")] });
    const decision = await decide(call);
    expect(decision).toEqual({ ok: false, reason: "blocked: write_file is governed" });
    expect(requestRunConfirm).not.toHaveBeenCalled();
  });
});
