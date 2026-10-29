/**
 * The on-prem conformance case (PRD 35 §3.3, WS5): the scripted task through the ports the
 * on-prem adapter builds — a session-file store (state crosses as JSON), the relay's steering
 * queue, governance gates from the dispatch, the node provider's capability set — gives the
 * SAME trace and outcome as every other entry point, and the on-prem-specific duties hold:
 * a path-scoped `block` refuses the call, an unscoped one withholds the tool, and a steer
 * that lands during the last turn is taken instead of lost.
 *
 * Ports only. The adapter itself (`agent-runtime/src/run/onPremAdapter.ts`) is node-bound and
 * is proven by agent-runtime's own tests; this proves the agent honours what it hands over.
 */

import { describe, expect, it } from "vitest";
import type { RunPorts, RunOutcome, ModelRequest, SteeringSource } from "../../src/index.js";
import { runAgent } from "../../src/index.js";
import {
  SCRIPTED_TASK,
  jsonStore,
  policyFor,
  providerOf,
  recordingModel,
  traceSink,
  type ScriptedTurn,
} from "../support/harness.js";

const HELLO: ScriptedTurn[] = [
  { content: "", toolCalls: [{ id: "call-1", name: "finish", arguments: '{"summary":"Hello! Done."}' }], model: "fake-model" },
  { content: "Hello! Done.", model: "fake-model" },
];

/** The ports the on-prem adapter builds, around a script and the surface-specific bits. */
function onPremPorts(
  script: ScriptedTurn[],
  over: { requests?: ModelRequest[]; steering?: SteeringSource; services?: Parameters<typeof providerOf>[1]; caps?: Parameters<typeof providerOf>[0] } = {},
) {
  const store = jsonStore();
  const trace = traceSink();
  const ports: RunPorts = {
    model: recordingModel(script, over.requests),
    capabilities: providerOf(over.caps ?? [], over.services),
    store,
    events: trace.sink,
    human: { ask: async () => ({ kind: "paused" }) },
    ...(over.steering ? { steering: over.steering } : {}),
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  return { ports, store, trace };
}

describe("conformance — the on-prem adapter's ports", () => {
  it("gives the same trace and outcome as the editor's, the entry-point label apart", async () => {
    const onPrem = onPremPorts(HELLO);
    const editor = onPremPorts(HELLO);
    const a = await runAgent({ task: SCRIPTED_TASK, policy: policyFor("on-prem"), ports: onPrem.ports });
    const b = await runAgent({ task: SCRIPTED_TASK, policy: policyFor("vscode"), ports: editor.ports });

    expect(onPrem.trace.events).toEqual(editor.trace.events);
    expect(a.kind).toEqual("finished");
    expect(a.kind === "finished" && b.kind === "finished" && a.output === b.output).toBe(true);
    expect(onPrem.trace.outcomes.map((row) => row.entryPoint)).toEqual(["on-prem"]);
    expect(editor.trace.outcomes.map((row) => row.entryPoint)).toEqual(["vscode"]);
  });

  it("resumes one step at a time from the session file to the same trace", async () => {
    const continuous = onPremPorts(HELLO);
    await runAgent({ task: SCRIPTED_TASK, policy: policyFor("on-prem"), ports: continuous.ports });

    // One model for the whole run (a tick resumes the same conversation); one store, one sink.
    const stepped = onPremPorts(HELLO);
    let outcome: RunOutcome = await runAgent({ task: SCRIPTED_TASK, policy: policyFor("on-prem"), ports: stepped.ports, maxSteps: 1 });
    for (let tick = 0; outcome.kind === "yielded"; tick += 1) {
      if (tick > 100) throw new Error("the run never finished after 100 ticks");
      outcome = await runAgent({ task: SCRIPTED_TASK, policy: policyFor("on-prem"), ports: stepped.ports, resume: stepped.store.saved, maxSteps: 1 });
    }

    expect(outcome.kind).toEqual("finished");
    expect(stepped.trace.events).toEqual(continuous.trace.events);
  });

  it("refuses a write under a path-scoped block gate without running the tool", async () => {
    const written: string[] = [];
    const { ports } = onPremPorts(
      [
        { toolCalls: [{ id: "w1", name: "write_file", arguments: '{"path":"secrets/key.txt","content":"x"}' }] },
        { content: "blocked" },
      ],
      {
        caps: ["repo.write"],
        services: {
          repoWrite: {
            writeFile: async (path: string) => {
              written.push(path);
              return { ok: true };
            },
            editFile: async () => ({ ok: false }),
            deleteFile: async () => ({ ok: false }),
          },
        },
      },
    );
    const policy = policyFor("on-prem", {
      approvalGates: [{ id: "no-secrets", effect: "block", tool: "write_file", paths: ["secrets/**"], reason: "do not write secrets" }],
    });

    const outcome = await runAgent({ task: SCRIPTED_TASK, policy, ports });

    expect(written).toEqual([]);
    expect(outcome.kind).toEqual("finished");
    expect(JSON.stringify(outcome.state.messages)).toContain("no-secrets");
  });

  it("does not advertise a tool an unscoped block gate withholds", async () => {
    const offered = async (gated: boolean): Promise<string[]> => {
      const requests: ModelRequest[] = [];
      const { ports } = onPremPorts([{ content: "ok" }], { requests, caps: ["repo.read", "repo.edit"] });
      const policy = policyFor("on-prem", gated ? { approvalGates: [{ id: "g", effect: "block", tool: "edit_file" }] } : {});
      await runAgent({ task: SCRIPTED_TASK, policy, ports });
      return (requests[0]?.tools ?? []).map((t) => t.function.name);
    };

    expect(await offered(false)).toContain("edit_file");
    const withheld = await offered(true);
    expect(withheld).not.toContain("edit_file");
    expect(withheld).toContain("read_file");
  });

  it("takes a steer that lands during the last turn instead of finishing past it", async () => {
    const requests: ModelRequest[] = [];
    let given = false;
    const steering: SteeringSource = {
      // Nothing is waiting at the start; the user types while the first turn is in flight.
      drain: () => {
        if (given || requests.length === 0) return [];
        given = true;
        return ["also add tests"];
      },
    };
    const { ports, trace } = onPremPorts([{ content: "first pass" }, { content: "steered pass" }], { requests, steering });

    const outcome = await runAgent({ task: SCRIPTED_TASK, policy: policyFor("on-prem"), ports });

    expect(outcome.kind === "finished" && outcome.output).toEqual("steered pass");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain("also add tests");
    const kinds = trace.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "steer.applied")).toHaveLength(1);
  });
});
