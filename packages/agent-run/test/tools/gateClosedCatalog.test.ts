/**
 * A surface whose own tools are the WHOLE catalog (`PlatformTools.closed`: the channel runner, the Creation Canvas) advertises its
 * own list, not the registry's. An unscoped `block` gate withholds a tool from that list too, and a call to it is still refused:
 * the withholding used to filter only the registry's tools, so a closed surface kept advertising the tool a tenant had blocked.
 */
import { describe, expect, it } from "vitest";
import type { Capability, PolicyGate } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type ModelRequest, type PlatformTools, type RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

function run(gates: PolicyGate[], over: Partial<PlatformTools> = {}) {
  const requests: ModelRequest[] = [];
  const executed: string[] = [];
  const script: ModelCompletion[] = [{ content: "", toolCalls: [{ id: "c1", name: "exec", arguments: "{}" }] }, { content: "fin" }];
  let n = 0;
  const ports: RunPorts = {
    model: { complete: async (request) => { requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest); return script[n++]!; } },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    platform: {
      closed: true,
      verbatimText: true,
      schemas: () => schemas(["exec", "read"]),
      selection: { query: "", limit: 50, required: new Set<string>() },
      execute: async (name) => { executed.push(name); return { data: "ok" }; },
      ...over,
    },
  };
  return { ports, requests, executed, policy: { ...TEST_POLICY, approvalGates: gates } };
}

const names = (request: ModelRequest | undefined): string[] => (request?.tools ?? []).map((t) => t.function.name);

describe("a block gate on a closed catalog", () => {
  it("withholds the tool from what the model is shown and refuses a call to it", async () => {
    const r = run([{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" }]);
    await runAgent({ task: TEST_TASK, policy: r.policy, ports: r.ports });

    expect(names(r.requests[0])).toEqual(["read"]);
    expect(r.executed).toEqual([]);
  });

  it("withholds it even when the surface pins it", async () => {
    const r = run([{ id: "no-shell", tool: "exec", effect: "block" }], { selection: { query: "", limit: 50, required: new Set(["exec"]) } });
    await runAgent({ task: TEST_TASK, policy: r.policy, ports: r.ports });

    expect(names(r.requests[0])).not.toContain("exec");
  });

  it("leaves the catalog alone with no gate, or a gate on another tool", async () => {
    for (const gates of [[], [{ id: "no-write", tool: "write_file", effect: "block" as const }]]) {
      const r = run(gates);
      await runAgent({ task: TEST_TASK, policy: r.policy, ports: r.ports });
      expect(names(r.requests[0]).sort()).toEqual(["exec", "read"]);
    }
  });
});
