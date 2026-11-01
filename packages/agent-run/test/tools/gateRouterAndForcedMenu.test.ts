/**
 * Two ways past a governance gate that a surface's own tool port could open, closed in the shared kernel hook (not in any one surface):
 *   - a call the surface REWRITES before it dispatches (`PlatformTools.preflight` -> `rewrite`: the Brain's tool router turns
 *     `builtin_tools_invoke {name}` into a call to `name`) used to be judged by the router's name, so a gate on the tool it reached never ran;
 *   - a menu the surface FORCES or extends (`PlatformTools.turn`) replaced the policy's selection whole, so an unscoped `block` gate's
 *     withholding (applied to the selection) was skipped for exactly the turns a surface shapes.
 */
import { describe, expect, it } from "vitest";
import type { Capability, PolicyGate } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type ModelRequest, type PlatformTools, type RunEvent, type RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

function run(gates: PolicyGate[], script: ModelCompletion[], over: Partial<PlatformTools> = {}) {
  const requests: ModelRequest[] = [];
  const events: RunEvent[] = [];
  const executed: string[] = [];
  let n = 0;
  const ports: RunPorts = {
    model: { complete: async (request) => { requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest); return script[n++]!; } },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (event) => void events.push(event) },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    platform: {
      closed: true,
      verbatimText: true,
      schemas: () => schemas(["route", "exec", "read"]),
      selection: { query: "", limit: 50, required: new Set<string>() },
      execute: async (name) => { executed.push(name); return { data: "ok" }; },
      ...over,
    },
  };
  return { ports, requests, events, executed, policy: { ...TEST_POLICY, approvalGates: gates } };
}

const names = (request: ModelRequest | undefined): string[] => (request?.tools ?? []).map((t) => t.function.name);
const NO_SHELL: PolicyGate = { id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" };

describe("a call the surface rewrites is gated by the tool it will run", () => {
  it("refuses a tool reached through the router, and never runs it", async () => {
    const r = run(
      [NO_SHELL],
      [{ content: "", toolCalls: [{ id: "c1", name: "route", arguments: JSON.stringify({ name: "exec" }) }] }, { content: "fin" }],
      { preflight: (call) => (call.name === "route" ? { rewrite: { name: String(call.args.name), args: {} } } : undefined) },
    );
    await runAgent({ task: TEST_TASK, policy: r.policy, ports: r.ports });

    expect(r.executed).toEqual([]);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "policy.blocked", tool: "exec", gateId: "no-shell" }));
  });

  it("still runs a rewritten call no gate names", async () => {
    const r = run(
      [NO_SHELL],
      [{ content: "", toolCalls: [{ id: "c1", name: "route", arguments: JSON.stringify({ name: "read" }) }] }, { content: "fin" }],
      { preflight: (call) => (call.name === "route" ? { rewrite: { name: String(call.args.name), args: {} } } : undefined) },
    );
    await runAgent({ task: TEST_TASK, policy: r.policy, ports: r.ports });

    expect(r.executed).toEqual(["read"]);
  });
});

describe("a menu the surface forces is withheld like the policy's selection", () => {
  it("does not advertise a tool an unscoped block gate withholds, even on a forced turn", async () => {
    const r = run([NO_SHELL], [{ content: "fin" }], { turn: () => ({ tools: schemas(["route", "exec", "read"]) }) });
    await runAgent({ task: TEST_TASK, policy: r.policy, ports: r.ports });

    expect(names(r.requests[0])).toEqual(["route", "read"]);
  });

  it("leaves a forced menu alone when no gate withholds anything", async () => {
    const r = run([], [{ content: "fin" }], { turn: () => ({ tools: schemas(["exec"]) }) });
    await runAgent({ task: TEST_TASK, policy: r.policy, ports: r.ports });

    expect(names(r.requests[0])).toEqual(["exec"]);
  });
});
