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
