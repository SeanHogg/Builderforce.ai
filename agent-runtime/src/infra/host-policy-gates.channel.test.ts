/**
 * End to end for a CHANNEL run: the tenant's gates, fetched through the host's real link and parsed by the real
 * `coercePolicyGates`, are enforced by the agent a channel message is served by. A `block` gate withholds the tool
 * and refuses a model that asks for it anyway; an `inject-directive` gate reaches the model's prompt.
 *
 * The seam itself (`runEmbeddedAgent` feeding `resolveHostPolicyGates()` to the session's `policyGates`) is covered in
 * `agents/embedded-runner/run.policy-gates.test.ts`, the session-to-agent hop in
 * `builderforce/agent-loop/agent-session.policy-gates.test.ts`; this proves that what the host resolved is enforced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalGate } from "./approval-gate.js";
import { resetHostPolicyGates, resolveHostPolicyGates } from "./host-policy-gates.js";
import { channelAgent, textOf, user } from "./host-policy-gates.testkit.js";

/** The host is linked and the api answers with `gates`. */
function linkWithGates(gates: unknown[]) {
  approvalGate.init({ baseUrl: "https://bf.test", agentNodeId: "7", apiKey: "bfk_k" });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ gates }) })));
}

describe("tenant gates on a channel run", () => {
  beforeEach(() => resetHostPolicyGates());
  afterEach(() => {
    (approvalGate as unknown as { baseUrl: string | null }).baseUrl = null;
    vi.unstubAllGlobals();
  });

  it("a block gate withholds the tool and refuses a call to it, naming the gate", async () => {
    linkWithGates([{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off for this tenant" }]);
    const ran: string[] = [];
    const gates = await resolveHostPolicyGates();
    const { agent, seen } = channelAgent(gates, ran);

    const produced = await agent.prompt([user("run the build")]);

    expect(gates.map((g) => g.id)).toEqual(["no-shell"]);
    // withheld: the model was never offered it
    expect((seen[0]!.tools ?? []).map((t) => t.name)).not.toContain("exec");
    // and the call it makes anyway never reaches the tool
    expect(ran).toEqual([]);
    const result = produced.find((m) => m.role === "toolResult") as unknown as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("no-shell");
  });

  it("tells the host which gate refused (the structured path a memory flush and a run's result read)", async () => {
    linkWithGates([{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" }, { id: "careful", effect: "inject-directive", directive: "Be careful." }]);
    const refused: string[] = [];
    const { agent } = channelAgent(await resolveHostPolicyGates(), [], { onGovernanceRefusal: (id) => refused.push(id) });

    await agent.prompt([user("run the build")]);

    // the withheld tool is called anyway by the scripted model: refused, and the host is told which gate (a directive refuses nothing)
    expect(refused).toEqual(["no-shell"]);
  });

  it("an inject-directive gate reaches the model's prompt", async () => {
    linkWithGates([{ id: "careful", effect: "inject-directive", directive: "Never touch production." }]);
    const ran: string[] = [];
    const { agent, seen } = channelAgent(await resolveHostPolicyGates(), ran);

    await agent.prompt([user("deploy it")]);

    const prompt = seen[0]!.systemPrompt ?? "";
    expect(prompt).toContain("Governance (these gates are binding):");
    expect(prompt).toContain("Never touch production.");
    // the agent's own system prompt is still there, after the governance block
    expect(prompt.endsWith("\n\nsys")).toBe(true);
    // a directive is guidance: the tool is still offered and runs
    expect(ran).toEqual(["exec"]);
  });

  it("control: a host with no gates offers and runs the tool", async () => {
    // not linked: no call, no gates
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ran: string[] = [];
    const gates = await resolveHostPolicyGates();
    const { agent, seen } = channelAgent(gates, ran);

    await agent.prompt([user("run the build")]);

    expect(gates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((seen[0]!.tools ?? []).map((t) => t.name)).toContain("exec");
    expect(ran).toEqual(["exec"]);
  });
});
