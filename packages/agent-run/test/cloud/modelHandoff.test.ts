/**
 * Characterization — the model hand-off, END TO END through `runAgent`. These are the cases of the retired
 * `api/.../cloudAgent/cloudRunModelPolicy.test.ts` (`completeUnderRunPolicy`, `cloudStallStep`) with the source's own
 * inputs and expected values; only the call shape is the agent's:
 *   - the api test drove `completeUnderRunPolicy(state, call, onRetry)`; here the run's model port is the `call`, the
 *     `model.cascade` event is `onRetry`, and the request the port saw is the `CloudTurnRequest` (the contract's
 *     `ModelRequest` omits `strict` when it is false, so the source's `strict: false` reads `strict ?? false`);
 *   - the status the gateway answered is a `ModelTransportError` the port throws.
 */
import { describe, expect, it } from "vitest";
import type { ModelCompletion, ModelRequest, RunEvent, RunPolicy, RunPorts, RunState } from "../../src/contract.js";
import { ModelTransportError } from "../../src/contract.js";
import { initialModelRunState, stallStep } from "../../src/policy/model/index.js";
import { MAX_ANNOUNCEMENT_RECOVERIES } from "../../src/policy/stall/index.js";
import { runAgent } from "../../src/runAgent.js";
import { freshState } from "../../src/runState.js";
import { openingRows } from "../../src/turnContext.js";
import { TEST_POLICY } from "../support/policyContext.js";

const TASK = { prompt: "Do the work.", dispatch: { source: "chat" as const } };
const SEARCH = { content: "", toolCalls: [{ id: "a", name: "tool_search", arguments: '{"query":"zzzz"}' }] };

/** A gateway answer: an HTTP status and (on success) the model that served it, as the source's `answer` helper. */
type Answer = { status: number; resolvedModel?: string };
const answer = (status: number, resolvedModel?: string): Answer => ({ status, ...(resolvedModel ? { resolvedModel } : {}) });

function build(answers: Answer[]) {
  const asked: ModelRequest[] = [];
  const events: RunEvent[] = [];
  let i = 0;
  let acted = false;
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        asked.push(request);
        const next = answers[Math.min(i++, answers.length - 1)]!;
        if (next.status >= 400) throw new ModelTransportError(`the gateway answered ${next.status}`, next.status);
        // The first successful turn acts (so the run takes a second turn); the next one speaks.
        const turn: ModelCompletion = acted ? { content: "done" } : SEARCH;
        acted = true;
        return { ...turn, ...(next.resolvedModel ? { model: next.resolvedModel } : {}) };
      },
    },
    capabilities: { capabilities: new Set() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (e) => { events.push(e); } },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  return { ports, asked, events };
}

const policyFor = (model: string, strict: boolean): RunPolicy => ({ ...TEST_POLICY, modelStart: { model, strict } });
const shape = (r: ModelRequest) => [r.model, r.strict ?? false, r.role] as const;

describe("completeUnderRunPolicy — through the run", () => {
  it("asks for the seed, then LOCKS onto what served turn 1", async () => {
    const run = build([answer(200, "served-coder")]);
    await runAgent({ task: TASK, policy: policyFor("seed-coder", false), ports: run.ports });
    expect(run.asked.map(shape)).toEqual([["seed-coder", false, "code"], ["served-coder", false, "code"]]);
  });

  it("drops a strict pin on 429 and re-asks once on the cascade, recording the hand-off", async () => {
    const run = build([answer(429), answer(200, "sonnet")]);
    const outcome = await runAgent({ task: TASK, policy: policyFor("opus", true), ports: run.ports, maxSteps: 1 });
    expect(run.asked.slice(0, 2).map((r) => [r.model, r.strict ?? false])).toEqual([["opus", true], [undefined, false]]);
    expect(run.events).toContainEqual(expect.objectContaining({ kind: "model.cascade", from: "opus", status: 429 }));
    // Locked onto the cascade's answer for the rest of the run, never strict again.
    expect(outcome.state.model.model).toBe("sonnet");
    expect(outcome.state.model.strictPin).toBe(false);
  });

  it("cascades a project Evermind decline (400) but fails a 400 from anything else fast", async () => {
    const declined = build([answer(400), answer(200, "sonnet")]);
    const done = await runAgent({ task: TASK, policy: policyFor("evermind/p7", true), ports: declined.ports });
    expect(done.kind).not.toBe("failed");
    expect(declined.asked.length).toBeGreaterThanOrEqual(2);

    const refused = build([answer(400)]);
    const failed = await runAgent({ task: TASK, policy: policyFor("opus", true), ports: refused.ports });
    expect(failed.kind).toBe("failed");
    expect(refused.asked).toHaveLength(1);
  });

  it("spends a forced tool choice on exactly one request", async () => {
    const policy = policyFor("m", false);
    const run = build([answer(200, "m")]);
    const resume: RunState = { ...freshState(policy, TASK), messages: openingRows(TASK), forceToolChoice: "required" };
    const outcome = await runAgent({ task: TASK, policy, ports: run.ports, resume, maxSteps: 1 });
    expect(run.asked[0]!.toolChoice).toBe("required");
    expect(outcome.state.forceToolChoice).toBeUndefined();
  });
});

describe("cloudStallStep — the stall step the run takes", () => {
  const promise = { text: "I'll search the codebase for the handler.", toolCallCount: 0, toolNames: ["read_file", "write_file"], requestText: "Fix the handler" };

  it("re-prompts, then fails over onto the coding surface, then stops", () => {
    let state = initialModelRunState({ pick: { model: "grok", strict: false }, delegatedRole: undefined });
    const surface = { codingModels: ["grok", "sonnet"] };
    for (let i = 0; i < MAX_ANNOUNCEMENT_RECOVERIES; i += 1) {
      const r = stallStep(state, { ...promise, resolvedModel: "grok" }, surface);
      expect(r.step.kind).toBe("nudge");
      expect(r.state.forceToolChoice).toBe("required");
      state = r.state;
    }
    const failover = stallStep(state, { ...promise, resolvedModel: "grok" }, surface);
    expect(failover.step).toMatchObject({ kind: "failover", to: "sonnet" });
    expect(failover.state.stallRecoveries).toBe(0);
    expect(failover.state.policy.model).toBe("sonnet");
  });
});
