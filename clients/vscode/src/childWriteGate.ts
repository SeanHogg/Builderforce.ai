/**
 * Whether a DELEGATED sub-agent may make one write to the user's working tree.
 *
 * A child used to be unconditionally read-only here, and the reason was mechanical
 * rather than principled: the approval prompt is raised by the Brain run cell that owns
 * the chat UI, and a nested loop had no way to reach it — so a writable child would have
 * been a disk write nobody approved. The cell's confirm channel is now callable from
 * outside (`requestRunConfirm`), so the child can ask the same question the parent asks,
 * on the same modal, and the restriction can go.
 *
 * What it must NOT become is a way around governance. So this gate answers with the same
 * three outcomes the parent's own tool seam produces, in the same order:
 *
 *   • a `block` gate refuses outright, and says why, so the model routes around it
 *     rather than retrying — a compiled policy is not something a child can ask past;
 *   • a `require-approval` gate always prompts, even with Auto on, because an
 *     "acceptEdits" preference cannot waive a compiled policy;
 *   • otherwise the run's live Auto switch decides, exactly as it does for the parent.
 *
 * ONE implementation for both editor surfaces: the native `@builderforce` participant
 * and the host-owned webview run raise their prompt through the same run cell, so a
 * gate that held in one and not the other would be the drift this file exists to
 * prevent.
 */

import { requestRunConfirm } from "@seanhogg/builderforce-brain-embedded";
import { evaluatePolicyGate, type PolicyGate } from "@builderforce/agent-tools";

/** Approved, or refused with a reason the model can act on. */
export type ChildWriteDecision = { ok: true } | { ok: false; reason: string };

export interface ChildWriteGateDeps {
  /** The chat whose run cell owns the prompt — the child asks on the parent's modal. */
  chatId: number;
  /** The tenant's effective governance gates for this run. */
  gates?: readonly PolicyGate[];
  /** Read the run's LIVE Auto switch, so flipping it mid-run takes effect on the next
   *  call rather than after the run — the same rule the parent's gate follows. */
  autoApprove(): boolean;
  /** Localized refusal text for a blocked call. */
  blockedByPolicy(reason: string): string;
}

export function createChildWriteGate(
  deps: ChildWriteGateDeps,
): (req: { name: string; args: Record<string, unknown> }) => Promise<ChildWriteDecision> {
  return async (req) => {
    const decision = evaluatePolicyGate(deps.gates, req.name);
    if (decision.action === "block") {
      return { ok: false, reason: deps.blockedByPolicy(decision.reason) };
    }
    // A compiled policy outranks the preference: `require-approval` prompts even when
    // the user has Auto on.
    if (decision.action !== "require-approval" && deps.autoApprove()) return { ok: true };
    const approved = await requestRunConfirm(deps.chatId, { name: req.name, args: req.args });
    return approved
      ? { ok: true }
      : { ok: false, reason: "The person running this declined that change. Do not retry it; report what you found instead." };
  };
}
