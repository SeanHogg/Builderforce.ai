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
import { createRunGovernance } from "../builderforce/agent-loop/run-governance.js";
import { approvalGate } from "./approval-gate.js";
import { resetHostPolicyGates, resolveHostPolicyGates } from "./host-policy-gates.js";
import { Type } from "@sinclair/typebox";
import { Agent } from "../builderforce/agent-loop/agent.js";
import { assistant, channelAgent, model, scripted, textOf, user } from "./host-policy-gates.testkit.js";

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
    const governance = createRunGovernance();
    const { agent } = channelAgent(await resolveHostPolicyGates(), [], { governance });

    await agent.prompt([user("run the build")]);

    // the withheld tool is called anyway by the scripted model: refused, and the run's scope is told which gate (a directive refuses nothing)
    expect(governance.refusals()).toEqual(["no-shell"]);
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

describe("what a gate judges on a channel run", () => {
  const writeTool = (ran: string[]) => ({
    name: "write_file",
    label: "write_file",
    description: "writes a file",
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id: string, params: unknown) => {
      ran.push((params as { path: string }).path);
      return { content: [{ type: "text" as const, text: "wrote" }], details: {} };
    },
  });
  const SRC_GATE = [{ id: "no-src", tool: "write_file", effect: "block" as const, paths: ["src/**"] }];

  async function write(path: string, workspaceDir?: string) {
    const ran: string[] = [];
    const agent = new Agent({ model, systemPrompt: "sys", tools: [writeTool(ran) as never], policyGates: SRC_GATE, ...(workspaceDir ? { workspaceDir } : {}) });
    agent.streamFn = scripted([assistant([{ type: "toolCall", id: "c1", name: "write_file", arguments: { path } }], "toolUse"), assistant([{ type: "text", text: "fin" }])], []);
    await agent.prompt([user("write it")]);
    return ran;
  }

  it("an absolute path inside the run's workspace is judged by its workspace-relative form (the checkout lives under a `src` directory)", async () => {
    const root = "/home/dev/src/proj";
    expect(await write(`${root}/docs/a.md`, root)).toEqual([`${root}/docs/a.md`]);
    expect(await write(`${root}/src/a.ts`, root)).toEqual([]);
  });

  it("with no workspace known the same absolute path falls back to tails and is refused (fail closed)", async () => {
    expect(await write("/home/dev/src/proj/docs/a.md")).toEqual([]);
  });
});

describe("a refused approval across the attempts of one run", () => {
  it("is not put to the approver again by a re-attempt that shares the run's governance scope", async () => {
    const asked = vi.spyOn(approvalGate, "request");
    const governance = createRunGovernance();
    const gates = [{ id: "ask-first", tool: "exec", effect: "require-approval" as const, reason: "needs a person" }];

    const first: string[] = [];
    await channelAgent(gates, first, { governance }).agent.prompt([user("run the build")]);
    expect(asked).toHaveBeenCalledTimes(1);

    // a re-attempt builds a fresh session (fresh run state) but the run's scope is the same
    const second: string[] = [];
    const retry = channelAgent(gates, second, { governance });
    const produced = await retry.agent.prompt([user("run the build")]);

    expect(asked).toHaveBeenCalledTimes(1);
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(textOf(produced.find((m) => m.role === "toolResult"))).toContain("ask-first");
    asked.mockRestore();
  });

  it("control: a re-attempt with its OWN scope asks again", async () => {
    const asked = vi.spyOn(approvalGate, "request");
    const gates = [{ id: "ask-first", tool: "exec", effect: "require-approval" as const }];
    await channelAgent(gates, [], { governance: createRunGovernance() }).agent.prompt([user("run it")]);
    await channelAgent(gates, [], { governance: createRunGovernance() }).agent.prompt([user("run it")]);

    expect(asked).toHaveBeenCalledTimes(2);
    asked.mockRestore();
  });
});
