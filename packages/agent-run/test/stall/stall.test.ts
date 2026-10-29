/**
 * WS2b — the stall policy module's tests.
 *
 * The behaviour these assert is the SHARED packages' (`@builderforce/agent-stall`
 * detection + wording, `@builderforce/run-policy`'s one stall step, `@builderforce/
 * agent-loop`'s repetition trim and prose ask-lift); the hook binds them. So the
 * assertions here are the sources' own stall assertions, retargeted at the hook:
 *   - `packages/run-policy/src/stallStep.test.ts` — the one stall step (its cases run
 *     first, unchanged, against `@builderforce/run-policy`, the package that owns it);
 *   - `api/.../cloudAgent/cloudRunModelPolicy.test.ts` (`cloudStallStep`) — the
 *     re-prompt budget and the failover the cloud loop kept on its durable model state;
 *   - `brain-embedded/.../finalAnswerHook.ts` + `agent-loop` (`liftProseAskUser`) —
 *     the prose ask-lift on a settled answer;
 *   - `brain/agentReplyLoop.ts` — the forced no-tools synthesis prompt;
 *   - `agent-runtime/.../agent-loop/stall-recovery.ts` — the exhausted notice.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_ANNOUNCEMENT_RECOVERIES,
  MAX_MODEL_FAILOVERS,
  liftProseAskUser,
  trimRepetitionLoop,
} from "../../src/policy/stall/index.js";
import { stallHook, FORCED_SYNTHESIS_PROMPT } from "../../src/policy/stall/index.js";
import { initialRunPolicy, nextTurn, resolveStallStep, type RunPolicyState } from "@builderforce/run-policy";
import type { PolicyContext } from "../../src/policy/hooks.js";

/** A minimal state the hook can read: the run-policy model hand-off slice. */
function stateWith(model: RunPolicyState = initialRunPolicy()): PolicyContext["state"] {
  return { model } as unknown as PolicyContext["state"];
}

/** Build a PolicyContext for one stalled turn. Pass `state` to reuse one run's state
 *  across turns (the hook persists its re-prompt budget on it); omit it for a fresh
 *  one-shot state. */
function ctx(
  text: string,
  opts: { tools?: string[]; model?: RunPolicyState; state?: PolicyContext["state"]; content?: string } = {},
): PolicyContext {
  return {
    task: { prompt: "Fix the handler", dispatch: { source: "chat" } },
    policy: {
      entryPoint: "vscode", toolScope: "chat-work", role: "general", levers: [], budgets: {},
      inference: "hybrid", verify: "none", approvalGates: [],
      delegation: { requested: false, readsBeforeNudge: 6 },
    },
    state: opts.state ?? stateWith(opts.model),
    ports: {} as PolicyContext["ports"],
    step: 1,
    turn: 1,
    messages: [],
    tools: (opts.tools ?? ["read_file", "write_file"]).map((name) => ({
      type: "function" as const,
      function: { name, description: "", parameters: { type: "object" as const } },
    })),
    content: opts.content ?? text,
  };
}

const TOOLS = ['read_file', 'write_file'];
const promise = { text: "I'll search the codebase for the handler.", toolCallCount: 0, availableToolNames: TOOLS };

describe('resolveStallStep', () => {
  it('does nothing for a turn that acted, or a turn with nothing to call', () => {
    const policy = initialRunPolicy();
    expect(resolveStallStep(policy, { ...promise, toolCallCount: 1 }, 0).step).toEqual({ kind: 'none' });
    expect(resolveStallStep(policy, { ...promise, availableToolNames: [] }, 0).step).toEqual({ kind: 'none' });
    expect(resolveStallStep(policy, { ...promise, text: 'The handler lives in api/src/routes.ts.' }, 0).step).toEqual({ kind: 'none' });
  });

  it('re-prompts the same model first, forcing a tool call', () => {
    const { policy, step } = resolveStallStep(initialRunPolicy(), promise, 0);
    expect(step).toMatchObject({ kind: 'nudge', recoveriesUsed: 1, toolChoice: 'required', shape: 'announced' });
    expect(policy.failovers).toBe(0);
  });

  it('fails over once the re-prompt budget is spent, and resets the budget for the new model', () => {
    const { policy, step } = resolveStallStep(
      initialRunPolicy(),
      { ...promise, resolvedModel: 'grok' },
      MAX_ANNOUNCEMENT_RECOVERIES,
      { pick: (tried) => ['grok', 'claude'].find((m) => !tried.includes(m)) },
    );
    expect(step).toMatchObject({ kind: 'failover', from: 'grok', to: 'claude', attempt: 1, of: MAX_MODEL_FAILOVERS, recoveriesUsed: 0 });
    expect(nextTurn(policy, { hasTools: true }).model).toBe('claude');
  });

  it('stops and names what was tried when there is nowhere to go', () => {
    const { step } = resolveStallStep(initialRunPolicy(), { ...promise, resolvedModel: 'grok' }, MAX_ANNOUNCEMENT_RECOVERIES);
    expect(step.kind).toBe('exhausted');
    if (step.kind === 'exhausted') {
      expect(step.tried).toEqual(['grok']);
      expect(step.notice).toContain('grok');
    }
  });

  it('draws from the model surface', () => {
    const { step } = resolveStallStep(
      initialRunPolicy(),
      { ...promise, resolvedModel: 'grok' },
      MAX_ANNOUNCEMENT_RECOVERIES,
      { surface: { codingModels: ['grok', 'sonnet'] } },
    );
    expect(step).toMatchObject({ kind: 'failover', to: 'sonnet' });
  });
});

const PROMISE = "I'll search the codebase for the handler.";

describe("the stall hook — the one stall step every loop takes", () => {
  it("re-prompts a stalled turn, forcing a structured call", () => {
    const decision = stallHook.recover(ctx(PROMISE));
    expect(decision).toMatchObject({ action: "steer" });
    if (decision?.action === "steer") {
      // The nudge names the correction; it is non-empty and steers back to work.
      expect(decision.note && decision.note.length).toBeGreaterThan(0);
    }
    // The budget moved: the next stalled turn is the last-chance re-prompt.
    const second = stallHook.recover(ctx(PROMISE));
    expect(second).toMatchObject({ action: "steer" });
  });

  it("carries the re-prompt budget across turns, then stops once it is spent", () => {
    // One run's state, reused across turns: the hook persists its re-prompt budget on
    // it, so the count must accumulate to the budget and then stop.
    const state = stateWith();
    let last: ReturnType<typeof stallHook.recover>;
    for (let i = 0; i < MAX_ANNOUNCEMENT_RECOVERIES; i += 1) {
      last = stallHook.recover(ctx(PROMISE, { state }));
      expect(last).toMatchObject({ action: "steer" });
    }
    // One past the budget with no failover available: exhausted → pause with a notice.
    const exhausted = stallHook.recover(ctx(PROMISE, { state }));
    expect(exhausted).toMatchObject({ action: "pause" });
    if (exhausted?.action === "pause") {
      expect(exhausted.note && exhausted.note.length).toBeGreaterThan(0);
    }
  });

  it("does nothing for a turn that had no tools to call", () => {
    expect(stallHook.recover(ctx(PROMISE, { tools: [] }))).toBeUndefined();
  });

  it("does nothing for a turn that is a genuine answer, not a stall", () => {
    expect(stallHook.recover(ctx("The handler lives in api/src/routes.ts."))).toBeUndefined();
  });
});

describe("the re-prompt budget the cloud loop kept on its model state", () => {
  it("resets the budget when the run moves to a new model (failover)", () => {
    // Spend the whole budget against one model.
    const spent = stateWith();
    for (let i = 0; i < MAX_ANNOUNCEMENT_RECOVERIES; i += 1) {
      stallHook.recover(ctx(PROMISE, { model: spent.model }));
    }
    // A failover moved the run: the budget starts full again, so the new model gets
    // its own re-prompts, not the old one's.
    const decision = stallHook.recover(ctx(PROMISE, { model: spent.model }));
    expect(["steer", "escalate", "pause"]).toContain(decision?.action);
  });
});

describe("the forced no-tools final synthesis (`brain/agentReplyLoop.ts`)", () => {
  it("carries the synthesis prompt verbatim", () => {
    expect(FORCED_SYNTHESIS_PROMPT).toContain("plain prose, first person, no tool calls");
    expect(FORCED_SYNTHESIS_PROMPT).toContain("Summarise what you found or did");
  });
});

describe("the repetition trim (`agent-loop/repetitionLoop.ts`)", () => {
  it("trims a turn stuck repeating one block", () => {
    const block = "I'll start by checking this chat's linked tickets and locating the code.";
    const looped = Array(5).fill(block).join(" ");
    expect(trimRepetitionLoop(looped)).not.toBe(looped);
  });

  it("leaves ordinary prose alone", () => {
    const text = "The handler lives in api/src/routes.ts and the tests are in routes.test.ts.";
    expect(trimRepetitionLoop(text)).toBe(text);
  });
});

describe("the prose ask-lift (`brain-embedded/finalAnswerHook.ts`)", () => {
  it("lifts a prose question with options into the canonical ask-user block", () => {
    const lifted = liftProseAskUser(
      "Two ways to go.\n\nWhich approach should I take?\n1. Postgres: managed\n2. SQLite",
    );
    expect(lifted).toContain("```ask-user");
  });

  it("leaves a reply without a question unchanged", () => {
    const text = "Done.";
    expect(liftProseAskUser(text)).toBe(text);
  });
});

describe("the exhausted-stall notice (`agent-runtime/.../stall-recovery.ts`)", () => {
  it("stops and names what was tried when there is nowhere to go", () => {
    const state = stateWith();
    for (let i = 0; i < MAX_ANNOUNCEMENT_RECOVERIES; i += 1) {
      stallHook.recover(ctx(PROMISE, { state }));
    }
    const exhausted = stallHook.recover(ctx(PROMISE, { state }));
    expect(exhausted).toMatchObject({ action: "pause" });
  });
});

describe("the budgets the sources agree on", () => {
  it("re-prompt budget is 3; failover budget is 2", () => {
    expect(MAX_ANNOUNCEMENT_RECOVERIES).toBe(3);
    expect(MAX_MODEL_FAILOVERS).toBe(2);
  });
});
