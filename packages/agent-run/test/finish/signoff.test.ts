/**
 * The sign-off requirement (`RunPolicy.signoff`): only a SUCCESSFUL
 * `builtin_kanban_signoff` for the exact role/lane slot satisfies it, and it holds a prose
 * answer exactly as it holds the `finish` tool.
 */
import { describe, expect, it } from "vitest";
import type { RunMessage } from "../../src/contract.js";
import { finishHook, signoffRecorded, signoffSettleBlock } from "../../src/policy/finish/index.js";
import { policyCtx } from "../support/policyContext.js";

const REQUIRED = { roleKey: "code-reviewer" };

function signoffCall(args: Record<string, unknown>, result: unknown): RunMessage[] {
  return [
    { role: "assistant", content: "", toolCalls: [{ id: "s1", name: "builtin_kanban_signoff", arguments: JSON.stringify(args) }] },
    { role: "tool", toolCallId: "s1", content: JSON.stringify(result) },
  ];
}

describe("signoffRecorded", () => {
  it("accepts a successful sign-off for the exact slot", () => {
    expect(signoffRecorded(signoffCall({ roleKey: "code-reviewer", verdict: "approved" }, { ok: true }), REQUIRED)).toBe(true);
  });

  it("rejects a failed call, another role, another lane, and no requirement", () => {
    expect(signoffRecorded(signoffCall({ roleKey: "code-reviewer" }, { ok: false, error: "x" }), REQUIRED)).toBe(false);
    expect(signoffRecorded(signoffCall({ roleKey: "qa" }, { ok: true }), REQUIRED)).toBe(false);
    expect(signoffRecorded(signoffCall({ roleKey: "code-reviewer" }, { ok: true }), { roleKey: "code-reviewer", laneKey: "review" })).toBe(false);
    expect(signoffRecorded(signoffCall({ roleKey: "code-reviewer" }, { ok: true }), undefined)).toBe(false);
  });
});

describe("signoffSettleBlock — the prose-answer hold", () => {
  it("holds a prose answer until the verdict is recorded, then records it on the state", () => {
    const owed = policyCtx({ policy: { signoff: REQUIRED } });
    expect(signoffSettleBlock(owed)).toContain("builtin_kanban_signoff");
    const signed = policyCtx({ policy: { signoff: REQUIRED }, messages: signoffCall({ roleKey: "code-reviewer" }, { ok: true }) });
    expect(signoffSettleBlock(signed)).toBeNull();
    expect(signed.state.finish.reviewVerdictRecorded).toBe(true);
  });

  it("never holds a run that owes no sign-off", () => {
    expect(signoffSettleBlock(policyCtx())).toBeNull();
  });

  it("is the finish module's own settleBlock", () => {
    expect(finishHook.settleBlock).toBe(signoffSettleBlock);
  });
});
