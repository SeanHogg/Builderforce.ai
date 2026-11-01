/**
 * A model that keeps asking for a tool a governance gate refuses trips the failure breaker. The channel owns its closing
 * synthesis, so such a run used to end on its last tool result with nothing written to the person. A run that never wrote a word
 * now ends on a reply that says what stopped it and names the gate (blocked, declined, timed out or stopped alike). A run that did
 * say something is unchanged.
 *
 * The notice is the run's REPLY, never an errored turn: the embedded runner regex-classifies an errored message's text (auth,
 * billing, rate limit, failover, context overflow) and rotates the auth profile and repeats the run on a match, so a gate keyed
 * like `forbidden-paths` must not be able to cause that.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import { Agent } from "../builderforce/agent-loop/agent.js";
import type { AssistantMessage } from "../builderforce/model/types.js";
import {
  isAuthAssistantError,
  isBillingAssistantError,
  isFailoverAssistantError,
  isRateLimitAssistantError,
} from "../agents/embedded-helpers.js";
import { approvalGate } from "./approval-gate.js";
import { assistant, execTool, model, scripted, textOf, user } from "./host-policy-gates.testkit.js";

const BLOCK: PolicyGate = { id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" };
const callExec = (text?: string): AssistantMessage =>
  assistant([...(text ? [{ type: "text" as const, text }] : []), { type: "toolCall" as const, id: "c", name: "exec", arguments: {} }], "toolUse");

async function runRefusedForever(gates: PolicyGate[], turn: () => AssistantMessage) {
  const ran: string[] = [];
  const agent = new Agent({ model, systemPrompt: "sys", tools: [execTool(ran)], policyGates: gates });
  agent.streamFn = scripted(Array.from({ length: 12 }, turn), []);
  const produced = await agent.prompt([user("run the build")]);
  return { ran, produced };
}

afterEach(() => {
  (approvalGate as unknown as { baseUrl: string | null }).baseUrl = null;
  vi.unstubAllGlobals();
});

describe("a run whose calls a governance gate refused until its breaker tripped", () => {
  it("with nothing written to the person, ends on a reply that names the gate", async () => {
    const { ran, produced } = await runRefusedForever([BLOCK], () => callExec());

    expect(ran).toEqual([]);
    const last = produced.at(-1) as AssistantMessage;
    expect(last.role).toBe("assistant");
    expect(last.stopReason).toBe("stop");
    expect(textOf(last)).toContain("no-shell");
    expect(textOf(last)).toContain("refused or failed");
  });

  it("names a gate that asked for approval and was not granted it (no approver reachable)", async () => {
    const { ran, produced } = await runRefusedForever([{ id: "ask-first", tool: "exec", effect: "require-approval", reason: "needs a person" }], () => callExec());

    expect(ran).toEqual([]);
    const last = produced.at(-1) as AssistantMessage;
    expect(last.stopReason).toBe("stop");
    expect(textOf(last)).toContain("ask-first");
  });

  it("a gate keyed like an error class cannot make the runner rotate the profile or repeat the run", async () => {
    for (const id of ["forbidden-paths", "rate-limit-exceeded", "billing-required", "unauthorized-hosts", "context-length-exceeded"]) {
      const { produced } = await runRefusedForever([{ ...BLOCK, id }], () => callExec());
      const last = produced.at(-1) as AssistantMessage;

      // not an errored turn at all: nothing the runner classifies by text reads it
      expect(last.stopReason).not.toBe("error");
      expect(last.errorMessage).toBeUndefined();
      expect(isFailoverAssistantError(last)).toBe(false);
      expect(isAuthAssistantError(last)).toBe(false);
      expect(isRateLimitAssistantError(last)).toBe(false);
      expect(isBillingAssistantError(last)).toBe(false);
      // and the person reads the gate as it was authored
      expect(textOf(last)).toContain(id);
    }
  });

  it("having said something, is delivered as it always was: it ends on its last result", async () => {
    const { produced } = await runRefusedForever([BLOCK], () => callExec("I will try the shell."));

    expect(produced.at(-1)!.role).toBe("toolResult");
  });
});
