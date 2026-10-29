/**
 * Governance gates at dispatch (PRD 35 §6.9, WS5): what `RunPolicy.approvalGates` does to a
 * call on every surface. A `block` refuses it, an unscoped `block` withholds the tool from
 * the catalog, a `require-approval` asks the human channel ONCE per call (and proceeds on
 * the answer, or parks the run), the control tools stay reachable under a catch-all gate,
 * and the code map is written on every terminal outcome.
 */

import { describe, expect, it } from "vitest";
import type { Capability, PolicyGate } from "@builderforce/agent-tools";
import {
  isToolWithheld,
  runAgent,
  type HumanChannel,
  type ModelCompletion,
  type ModelRequest,
  type RunEvent,
  type RunOutcome,
  type RunPorts,
  type RunState,
} from "../../src/index.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

const WRITE = (path: string): ModelCompletion => ({
  content: "",
  toolCalls: [{ id: `w-${path}`, name: "write_file", arguments: JSON.stringify({ path, content: "x" }) }],
});
const READ = (path: string): ModelCompletion => ({
  content: "",
  toolCalls: [{ id: `r-${path}`, name: "read_file", arguments: JSON.stringify({ path }) }],
});
const SAY = (content: string): ModelCompletion => ({ content });

/** Build a run's ports around a script; `writes` records every file the provider was asked to write. */
function setup(script: Array<ModelCompletion | Error>, over: { human?: HumanChannel; caps?: Capability[]; commits?: unknown[] } = {}) {
  const requests: ModelRequest[] = [];
  const events: RunEvent[] = [];
  const writes: string[] = [];
  let call = 0;
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
        const answer = script[call++];
        if (!answer) throw new Error("script exhausted");
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
    capabilities: {
      capabilities: new Set<Capability>(over.caps ?? ["repo.write", "repo.read", "repo.delete"]),
      repoRead: {
        listFiles: async () => ({ ok: true, paths: [] }),
        readFile: async (path: string) => ({ ok: true, path, content: "x" }),
        searchCode: async (query: string) => ({ ok: true, query, total: 0, matches: [] }),
      },
      repoWrite: {
        writeFile: async (path: string) => {
          writes.push(path);
          return { ok: true };
        },
        editFile: async () => ({ ok: false }),
        deleteFile: async () => ({ ok: true, deleted: true }),
      },
    },
    store: {
      load: () => undefined,
      save: () => undefined,
      commitMemory: (consolidated: unknown) => void over.commits?.push(consolidated),
    },
    events: { emit: (event) => void events.push(event) },
    human: over.human ?? { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  return { ports, requests, writes, events };
}

const gate = (over: Partial<PolicyGate>): PolicyGate => ({ id: "g", effect: "block", ...over }) as PolicyGate;
const policyWith = (approvalGates: PolicyGate[]) => ({ ...TEST_POLICY, approvalGates });
const toolNames = (request: ModelRequest | undefined) => (request?.tools ?? []).map((t) => t.function.name);

describe("a block gate", () => {
  it("refuses the call without running the tool, names the gate, and says so on the timeline", async () => {
    const { ports, writes, events } = setup([WRITE("secrets/key.txt"), SAY("blocked")]);
    const outcome = await runAgent({
      task: TEST_TASK,
      policy: policyWith([gate({ id: "no-secrets", tool: "write_file", paths: ["secrets/**"], reason: "do not write secrets" })]),
      ports,
    });
    expect(writes).toEqual([]);
    expect(JSON.stringify(outcome.state.messages)).toContain("do not write secrets");
    expect(events).toContainEqual(expect.objectContaining({ kind: "policy.blocked", tool: "write_file", gateId: "no-secrets", reason: "do not write secrets" }));
  });
});

describe("a require-approval gate", () => {
  const approvalGate = gate({ id: "ask-first", effect: "require-approval", tool: "write_file", reason: "writes need a person" });
  const approved = { kind: "answered", answer: "yes", approved: true } as const;

  it("asks the approver ONCE per call, handing it the call, and proceeds on an approving answer", async () => {
    const asked: Array<{ gate: string; tool?: string; path?: unknown }> = [];
    const human: HumanChannel = {
      ask: async () => ({ kind: "paused" }),
      approve: async (g, call) => {
        asked.push({ gate: g.id, tool: call?.tool, path: call?.args.path });
        return approved;
      },
    };
    const { ports, writes } = setup([WRITE("a.ts"), WRITE("a.ts"), WRITE("b.ts"), SAY("done")], { human });
    const outcome = await runAgent({ task: TEST_TASK, policy: policyWith([approvalGate]), ports });
    expect(outcome.kind).toBe("finished");
    // The identical retried call rides the first answer; a DIFFERENT call is asked on its own merits.
    expect(asked).toEqual([
      { gate: "ask-first", tool: "write_file", path: "a.ts" },
      { gate: "ask-first", tool: "write_file", path: "b.ts" },
    ]);
    expect(writes).toEqual(["a.ts", "a.ts", "b.ts"]);
  });

  it("declines the call when the approver rejects it — the tool does not run", async () => {
    const human: HumanChannel = {
      ask: async () => ({ kind: "paused" }),
      approve: async () => ({ kind: "answered", answer: "not on prod", approved: false }),
    };
    const { ports, writes } = setup([WRITE("a.ts"), SAY("declined")], { human });
    const outcome = await runAgent({ task: TEST_TASK, policy: policyWith([approvalGate]), ports });
    expect(writes).toEqual([]);
    expect(JSON.stringify(outcome.state.messages)).toContain("The approver declined");
    expect(outcome.state.approvedCalls ?? []).toEqual([]);
  });

  it("reads the structured decision, never the words of the answer", async () => {
    const human: HumanChannel = { ask: async () => ({ kind: "paused" }), approve: async () => ({ kind: "answered", answer: "approve", approved: false }) };
    const { ports, writes } = setup([WRITE("a.ts"), SAY("declined")], { human });
    await runAgent({ task: TEST_TASK, policy: policyWith([approvalGate]), ports });
    expect(writes).toEqual([]);
  });

  it("parks the run when the approver parks, WITHOUT asking a second time, and the tool is not reported done", async () => {
    let asks = 0;
    const human: HumanChannel = {
      // If the run asked again, this would answer in-run and report the call as done.
      ask: async () => {
        asks += 1;
        return { kind: "answered", answer: "yes" };
      },
      approve: async () => ({ kind: "paused", approvalId: "appr-9" }),
    };
    const { ports, writes, events } = setup([WRITE("a.ts")], { human });
    const parked: RunOutcome = await runAgent({ task: TEST_TASK, policy: policyWith([approvalGate]), ports });
    expect(parked.kind).toBe("paused");
    expect(parked.kind === "paused" && parked.approvalId).toBe("appr-9");
    expect(asks).toBe(0);
    expect(writes).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ kind: "tool.dispatched", tool: "write_file", ok: false }));
  });

  it("proceeds after the resume: the parked call is in approvedCalls, and the identical retried call runs", async () => {
    let approvals = 0;
    const human: HumanChannel = {
      ask: async () => ({ kind: "paused" }),
      approve: async () => {
        approvals += 1;
        return { kind: "paused" };
      },
    };
    const first = setup([WRITE("a.ts")], { human });
    const parked: RunOutcome = await runAgent({ task: TEST_TASK, policy: policyWith([approvalGate]), ports: first.ports });
    expect(parked.kind).toBe("paused");
    expect(parked.state.approvedCalls).toHaveLength(1);

    const resumed = setup([WRITE("a.ts"), SAY("done")], { human });
    const outcome = await runAgent({ task: TEST_TASK, policy: policyWith([approvalGate]), ports: resumed.ports, resume: parked.state as RunState });
    expect(outcome.kind).toBe("finished");
    expect(resumed.writes).toEqual(["a.ts"]);
    expect(approvals).toBe(1);
  });

  it("falls back to a plain question when the surface has no approver — an answer is not an approval", async () => {
    const asked: string[] = [];
    const human: HumanChannel = {
      ask: async (question) => {
        asked.push(question);
        return { kind: "answered", answer: "sure" };
      },
    };
    const { ports, writes } = setup([WRITE("a.ts"), SAY("declined")], { human });
    const outcome = await runAgent({ task: TEST_TASK, policy: policyWith([approvalGate]), ports });
    expect(asked).toHaveLength(1);
    expect(writes).toEqual([]);
    expect(JSON.stringify(outcome.state.messages)).toContain("The approver declined");
  });
});

describe("the catalog under a gate", () => {
  it("keeps the control tools reachable under a gate that names no tool", async () => {
    const { ports, requests } = setup([SAY("done")]);
    await runAgent({ task: TEST_TASK, policy: policyWith([gate({ id: "all" })]), ports });
    expect(toolNames(requests[0])).toContain("finish");
    expect(toolNames(requests[0])).not.toContain("write_file");
  });

  it("an unscoped block on Write withholds write_file and delete_file", async () => {
    const { ports, requests } = setup([SAY("done")]);
    await runAgent({ task: TEST_TASK, policy: policyWith([gate({ tool: "Write" })]), ports });
    expect(toolNames(requests[0])).not.toContain("write_file");
    expect(toolNames(requests[0])).not.toContain("delete_file");
    expect(toolNames(requests[0])).toContain("read_file");
  });

  it("names the SDK vocabulary by its catalog synonyms", () => {
    expect(isToolWithheld([gate({ tool: "Task" })], "spawn_agent")).toBe(true);
    expect(isToolWithheld([gate({ tool: "Task" })], "spawn_agents")).toBe(true);
    expect(isToolWithheld([gate({ tool: "Glob" })], "list_files")).toBe(true);
    expect(isToolWithheld([gate({ tool: "Grep" })], "search_code")).toBe(true);
    expect(isToolWithheld([gate({ tool: "write_file" })], "delete_file")).toBe(true);
    expect(isToolWithheld([gate({ tool: "delete_file" })], "write_file")).toBe(false);
    expect(isToolWithheld([gate({ tool: "Write", paths: ["secrets/**"] })], "write_file")).toBe(false);
  });
});

describe("the run-end code map", () => {
  const reads = [READ("api/src/run/a.ts"), READ("api/src/run/b.ts"), READ("api/src/run/c.ts")];
  const keys = (commits: unknown[]) => commits.map((c) => (c as { key?: string }).key);

  it("is written when the run fails", async () => {
    const commits: unknown[] = [];
    const { ports } = setup([...reads, new Error("model down")], { commits });
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });
    expect(outcome.kind).toBe("failed");
    expect(keys(commits)).toEqual(["codemap:api/src/run"]);
  });

  it("is written when the run is cancelled", async () => {
    const commits: unknown[] = [];
    const controller = new AbortController();
    const { ports } = setup([...reads, SAY("never")], { commits });
    const model = ports.model;
    let calls = 0;
    ports.model = {
      complete: async (request, signal) => {
        calls += 1;
        if (calls === 4) controller.abort();
        return model.complete(request, signal);
      },
    };
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports, signal: controller.signal });
    expect(outcome.kind).toBe("failed");
    expect(keys(commits)).toEqual(["codemap:api/src/run"]);
  });

  it("is written when the run finishes", async () => {
    const commits: unknown[] = [];
    const { ports } = setup([...reads, SAY("done")], { commits });
    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports });
    expect(outcome.kind).toBe("finished");
    expect(keys(commits)).toEqual(["codemap:api/src/run"]);
  });
});
