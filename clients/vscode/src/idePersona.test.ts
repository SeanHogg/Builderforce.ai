import { describe, it, expect } from "vitest";
import { ideSystemPromptBase, AUTONOMY_DIRECTIVE, FOLLOW_THROUGH_DIRECTIVE, DISCOVERY_DIRECTIVE, DISPATCH_STRATEGY_DIRECTIVE } from "./idePersona";

/**
 * The persona is assembled from named directives, and the failure mode is silent: a
 * directive can be written, exported, and never appended — the agent then behaves
 * exactly as it did before, with nothing in the build to say why. These pin the
 * composition rather than the prose.
 */
describe("ideSystemPromptBase composition", () => {
  it("carries the follow-through directive on BOTH surfaces", () => {
    // It applies with or without a workspace: the bare-directive half is about
    // reading the conversation, which has nothing to do with having files open.
    expect(ideSystemPromptBase(true)).toContain(FOLLOW_THROUGH_DIRECTIVE);
    expect(ideSystemPromptBase(false)).toContain(FOLLOW_THROUGH_DIRECTIVE);
  });

  it("keeps the directives it already had", () => {
    const withFolder = ideSystemPromptBase(true);
    expect(withFolder).toContain(AUTONOMY_DIRECTIVE);
    expect(withFolder).toContain(DISCOVERY_DIRECTIVE);
    expect(withFolder).toContain(DISPATCH_STRATEGY_DIRECTIVE);
    // File discovery is meaningless with no folder open, so it stays off that branch.
    expect(ideSystemPromptBase(false)).not.toContain(DISCOVERY_DIRECTIVE);
  });
});

describe("FOLLOW_THROUGH_DIRECTIVE", () => {
  it("forbids the deferred promise that made a run's work never happen", () => {
    // The observed reply: "I hit the tool-call budget before applying the edit …
    // re-run me and I'll apply it." Nothing carries over, so the edit never landed.
    expect(FOLLOW_THROUGH_DIRECTIVE).toMatch(/never promise to do it on a later run/i);
    expect(FOLLOW_THROUGH_DIRECTIVE).toMatch(/nothing carries over between runs/i);
  });

  it("resolves a bare follow-up against the previous message", () => {
    // The observed next turn: the user said "Fix" and the agent asked what to fix,
    // while the answer sat one message above it.
    expect(FOLLOW_THROUGH_DIRECTIVE).toMatch(/bare directive/i);
    expect(FOLLOW_THROUGH_DIRECTIVE).toMatch(/previous message/i);
    expect(FOLLOW_THROUGH_DIRECTIVE).toMatch(/Do not ask what to fix/i);
  });

  it("tells a step-starved run to spend what is left on the edit, not on more reading", () => {
    expect(FOLLOW_THROUGH_DIRECTIVE).toMatch(/low on steps/i);
    expect(FOLLOW_THROUGH_DIRECTIVE).toMatch(/rather than on more reading/i);
  });
});

/**
 * Stated only as "know when to hand off", this read as a general preference for handing
 * off: asked to fix a small UI defect in the workspace it already had open, the agent
 * opened a ticket, tried to dispatch a remote builder, spent the rest of the turn
 * fighting the dispatch, and changed nothing. The directive has to carry BOTH halves.
 */
describe("DISPATCH_STRATEGY_DIRECTIVE", () => {
  it("puts doing the work yourself FIRST, ahead of the hand-off", () => {
    expect(DISPATCH_STRATEGY_DIRECTIVE).toMatch(/DO THE WORK YOURSELF WHEN YOU CAN/);
    expect(DISPATCH_STRATEGY_DIRECTIVE).toMatch(/handful of tool calls/i);
    // The ordering is the point: the self-do rule must precede the hand-off recipe, or
    // a model reading top-down meets "create one task and assign it" first.
    expect(DISPATCH_STRATEGY_DIRECTIVE.indexOf("DO THE WORK YOURSELF"))
      .toBeLessThan(DISPATCH_STRATEGY_DIRECTIVE.indexOf("CREATE ONE TASK"));
  });

  it("still names the hand-off for work that genuinely exceeds the session", () => {
    expect(DISPATCH_STRATEGY_DIRECTIVE).toMatch(/tasks\.create/);
    expect(DISPATCH_STRATEGY_DIRECTIVE).toMatch(/assignedAgentRef/);
    expect(DISPATCH_STRATEGY_DIRECTIVE).toMatch(/repo-wide refactor/i);
  });

  it("says recording the change is not a substitute for making it", () => {
    expect(DISPATCH_STRATEGY_DIRECTIVE).toMatch(/recording is not a substitute for doing/i);
  });

  it("tells the agent to read a refused dispatch rather than retry it", () => {
    expect(DISPATCH_STRATEGY_DIRECTIVE).toMatch(/refusal names the reason/i);
  });
});
