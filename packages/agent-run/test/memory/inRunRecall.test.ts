/**
 * Recall and remember DURING a run (PRD 35 §7 "Recall / remember during a run", the row the PRD names as most at risk). The
 * model's `memory_recall` / `memory_remember` calls reach whatever backs the surface's `memory` capability (the SSM store
 * on-prem, the project facts in the cloud and the editor) through the agent's one tool registry: the arguments the model
 * wrote arrive at the capability, and what it answers is what the model reads on its next turn. The old homes (the SDK's
 * `sdk-memory-server`, each surface's own tool) are deleted, so this pins the one home rather than proving parity.
 */
import { describe, expect, it } from "vitest";
import type { Capability, CapabilityProvider } from "@builderforce/agent-tools";
import { runAgent, type ModelRequest, type RunPorts } from "../../src/index.js";
import { TEST_POLICY } from "../support/policyContext.js";

function memory() {
  const recalled: Array<{ query: string; limit?: number }> = [];
  const remembered: Array<{ key: string; content: string; opts?: unknown }> = [];
  const provider: CapabilityProvider = {
    capabilities: new Set<Capability>(["memory"]),
    memory: {
      recall: async (query, limit) => {
        recalled.push({ query, ...(limit !== undefined ? { limit } : {}) });
        return { ok: true, query, entries: [{ key: "deploy-command", content: "pnpm run ship" }] } as never;
      },
      remember: async (key, content, opts) => {
        remembered.push({ key, content, opts });
        return { ok: true, key } as never;
      },
    },
  };
  return { provider, recalled, remembered };
}

function ports(provider: CapabilityProvider, requests: ModelRequest[], script: Array<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>): RunPorts {
  let n = 0;
  return {
    model: { complete: async (request) => { requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest); return script[n++]!; } },
    capabilities: provider,
    store: { load: () => undefined, save: () => undefined },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
}

describe("memory_recall and memory_remember inside a run", () => {
  it("recall reaches the capability with the model's arguments, and its entries are what the model reads next", async () => {
    const mem = memory();
    const requests: ModelRequest[] = [];
    const outcome = await runAgent({
      task: { prompt: "How do we deploy?", dispatch: { source: "chat" } },
      policy: { ...TEST_POLICY, role: "code" },
      ports: ports(mem.provider, requests, [
        { content: "", toolCalls: [{ id: "r1", name: "memory_recall", arguments: '{"query":"deploy command","limit":3}' }] },
        { content: "", toolCalls: [{ id: "f1", name: "finish", arguments: '{"summary":"pnpm run ship"}' }] },
      ]),
    });

    expect(outcome).toMatchObject({ kind: "finished", output: "pnpm run ship" });
    // Before turn 1 the context policy recalls on the task itself (best effort, 8 entries); the model's own call follows.
    expect(mem.recalled).toEqual([{ query: "How do we deploy?", limit: 8 }, { query: "deploy command", limit: 3 }]);
    const second = requests[1]!.messages;
    const toolRow = second.find((m) => m.role === "tool");
    expect(toolRow?.content).toContain("deploy-command");
    expect(toolRow?.content).toContain("pnpm run ship");
  });

  it("remember stores the fact under the model's key, and a blank recall query is refused without touching the store", async () => {
    const mem = memory();
    const requests: ModelRequest[] = [];
    const outcome = await runAgent({
      task: { prompt: "Note the deploy command.", dispatch: { source: "chat" } },
      policy: { ...TEST_POLICY, role: "code" },
      ports: ports(mem.provider, requests, [
        { content: "", toolCalls: [{ id: "r0", name: "memory_recall", arguments: '{"query":"  "}' }] },
        { content: "", toolCalls: [{ id: "m1", name: "memory_remember", arguments: '{"key":"deploy-command","content":"pnpm run ship"}' }] },
        { content: "", toolCalls: [{ id: "f1", name: "finish", arguments: '{"summary":"noted"}' }] },
      ]),
    });

    expect(outcome.kind).toBe("finished");
    expect(mem.recalled).toEqual([{ query: "Note the deploy command.", limit: 8 }]); // the context policy's own; the blank query never reached the store
    expect(mem.remembered).toHaveLength(1);
    expect(mem.remembered[0]).toMatchObject({ key: "deploy-command", content: "pnpm run ship" });
    expect(requests[1]!.messages.find((m) => m.role === "tool")?.content).toContain("query is required");
  });

  it("a surface without the memory capability is not offered the tools", async () => {
    const requests: ModelRequest[] = [];
    await runAgent({
      task: { prompt: "Hi", dispatch: { source: "chat" } },
      policy: { ...TEST_POLICY, role: "code" },
      ports: ports({ capabilities: new Set<Capability>() }, requests, [{ content: "", toolCalls: [{ id: "f1", name: "finish", arguments: '{"summary":"ok"}' }] }]),
    });
    const offered = (requests[0]!.tools ?? []).map((t) => t.function.name);
    expect(offered).not.toContain("memory_recall");
    expect(offered).not.toContain("memory_remember");
  });
});
