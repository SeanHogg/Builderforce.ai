/**
 * A model that keeps asking for a tool a governance gate refuses trips the failure breaker. The channel owns its closing
 * synthesis, so such a run used to end on its last tool result with nothing written to the person. When a gate caused it
 * and the run never wrote a word, it now ends on an errored message that says what stopped it and names the gate. A run that
 * did say something is unchanged.
 */
import { describe, expect, it } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import { Agent } from "../builderforce/agent-loop/agent.js";
import type { AssistantMessage } from "../builderforce/model/types.js";
import { assistant, execTool, model, scripted, user } from "./host-policy-gates.testkit.js";

const BLOCK: PolicyGate = { id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" };
const callExec = (text?: string): AssistantMessage =>
  assistant([...(text ? [{ type: "text" as const, text }] : []), { type: "toolCall" as const, id: "c", name: "exec", arguments: {} }], "toolUse");

async function runRefusedForever(turn: () => AssistantMessage) {
  const ran: string[] = [];
  const agent = new Agent({ model, systemPrompt: "sys", tools: [execTool(ran)], policyGates: [BLOCK] });
  agent.streamFn = scripted(Array.from({ length: 12 }, turn), []);
  const produced = await agent.prompt([user("run the build")]);
  return { ran, produced };
}

describe("a run whose calls a governance gate refused until its breaker tripped", () => {
  it("with nothing written to the person, ends on a message that names the gate", async () => {
    const { ran, produced } = await runRefusedForever(() => callExec());

    expect(ran).toEqual([]);
    const last = produced.at(-1) as AssistantMessage;
    expect(last.role).toBe("assistant");
    expect(last.stopReason).toBe("error");
    expect(last.errorMessage).toContain("no-shell");
    expect(last.errorMessage).toContain("refused or failed");
  });

  it("having said something, is delivered as it always was: it ends on its last result", async () => {
    const { produced } = await runRefusedForever(() => callExec("I will try the shell."));

    expect(produced.at(-1)!.role).toBe("toolResult");
  });
});
