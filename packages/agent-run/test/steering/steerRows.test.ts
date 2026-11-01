/**
 * The rows the person's words become carry that mark (a model hand-off keeps them whole; a stall's nudge, written by the agent, does
 * not), and a command that never started because a steer was already waiting says so truthfully.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type ModelRequest, type PlatformTools, type RunMessage, type RunPorts } from "../../src/index.js";
import { INTERRUPTED_BY_STEER } from "../../src/policy/steering/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

function scripted(answers: ModelCompletion[], extra: Partial<RunPorts> = {}) {
  const requests: ModelRequest[] = [];
  const appended: RunMessage[] = [];
  let n = 0;
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push({ ...request, messages: [...request.messages] });
        const answer = answers[n++];
        if (!answer) throw new Error("script exhausted");
        return answer;
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined, appended: (row) => void appended.push(row) },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    ...extra,
  };
  return { ports, requests, appended };
}

const platform = (names: string[], over: Partial<PlatformTools> = {}): PlatformTools => ({
  closed: true,
  verbatimText: true,
  schemas: () => schemas(names),
  selection: { query: "", limit: 50, required: new Set<string>() },
  execute: async () => ({ data: "ok" }),
  ...over,
});

describe("the person's words are marked on the rows they become", () => {
  it("a steer and a follow-up carry the mark; the agent's own stall nudge does not", async () => {
    let drains = 0;
    let followed = false;
    const run = scripted(
      [{ content: "Let me search for that now." }, { content: "Done with b.ts." }, { content: "Tidied." }],
      {
        platform: platform(["read"]),
        steering: {
          drain: () => (++drains === 2 ? ["actually use b.ts instead"] : []),
          followUp: () => (followed ? [] : ((followed = true), ["and then tidy up"])),
        },
      },
    );

    await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: run.ports });

    const users = run.appended.filter((r) => r.role === "user");
    const steer = users.find((r) => r.content === "actually use b.ts instead");
    const followUp = users.find((r) => r.content === "and then tidy up");
    expect(steer?.person).toBe(true);
    expect(followUp?.person).toBe(true);
    const nudges = users.filter((r) => r !== steer && r !== followUp);
    expect(nudges.length).toBeGreaterThan(0);
    expect(nudges.every((r) => r.person === undefined)).toBe(true);
  });
});

describe("a command that never started because a steer was already waiting", () => {
  it("is not run, its row fails and says it did not start, and it is not counted as a failure", async () => {
    let ran = false;
    const run = scripted([{ content: "", toolCalls: [{ id: "c1", name: "exec", arguments: "{}" }] }, { content: "fin" }], {
      platform: platform(["exec"], { interruptible: (name) => name === "exec", execute: async () => ((ran = true), { data: "ran" }) }),
      steering: { drain: () => [], hasInterrupt: () => true },
    });

    const outcome = await runAgent({ task: TEST_TASK, policy: TEST_POLICY, ports: run.ports });

    expect(ran).toBe(false);
    expect(outcome.kind).toBe("finished");
    const row = run.requests[1]!.messages.find((m) => m.role === "tool")!;
    expect(row.isError).toBe(true);
    expect(row.content).toContain(INTERRUPTED_BY_STEER);
    expect(INTERRUPTED_BY_STEER).toContain("had not started");
    expect(INTERRUPTED_BY_STEER).not.toContain("was stopped before it finished");
  });
});
