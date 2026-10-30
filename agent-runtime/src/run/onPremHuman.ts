/**
 * The on-prem run's HUMAN port: how people are reached from this host — the process-wide
 * approval gate (`infra/approval-gate.ts`), which blocks in-process until a person answers
 * in the Builderforce portal. It never parks a run, so an answer always comes back inline.
 *
 *   - a QUESTION goes through the provider's `human` capability (the same ask the shared
 *     `ask_human` tool makes, with its timeout and "no human" notes);
 *   - an APPROVAL (a governance gate on a tool call) goes straight to the gate as an
 *     approval request, and its outcome is STRUCTURED: `approved` is the gate's decision,
 *     never read from the words of an answer.
 */

import type { HumanAnswer, HumanChannel } from "@builderforce/agent-run";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import { requestHumanInput, type HumanInputRequest, type HumanInputResult } from "../infra/approval-gate.js";

/** The longest an approval's arguments are shown to the approver. */
const ARGS_PREVIEW_CHARS = 500;

/** The channel over a provider (read late: the provider is built after the ports that need it). */
export function onPremHuman(
  provider: () => CapabilityProvider,
  requestHuman: (request: HumanInputRequest) => Promise<HumanInputResult> = requestHumanInput,
): HumanChannel {
  return {
    async ask(question, options): Promise<HumanAnswer> {
      const caps = provider();
      if (!caps.human) return { kind: "paused" };
      const result = await caps.human.ask(question, options?.length ? `Options: ${options.join(" | ")}` : undefined);
      if (result.paused) return { kind: "paused" };
      return { kind: "answered", answer: result.answer ?? result.note ?? result.error ?? "" };
    },

    async approve(gate, call): Promise<HumanAnswer> {
      const tool = call?.tool ?? gate.tool ?? "a tool";
      const args = call ? JSON.stringify(call.args).slice(0, ARGS_PREVIEW_CHARS) : "";
      const result = await requestHuman({
        kind: "approval",
        actionType: `tool.${tool}`,
        description: `Approve the agent's use of "${tool}"? ${call?.reason ?? gate.reason ?? ""}${args ? `\n\nArguments: ${args}` : ""}`.trim(),
        metadata: { gateId: gate.id, tool, ...(call ? { args: call.args } : {}) },
      });
      if (result.decision === "approved") return { kind: "answered", answer: result.responseText ?? "", approved: true };
      if (result.decision === "timeout") return { kind: "answered", answer: "No approver responded in time.", approved: false };
      return { kind: "answered", answer: result.responseText ?? "", approved: false };
    },
  };
}
