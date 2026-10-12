import { describe, expect, it } from "vitest";
import { subagentSystemPrompt } from "./subagent.js";

/**
 * A child runs BESIDE its owner on every surface: the owner is not blocked, may redirect
 * it, and reads its final message as the report — and it has no step budget.
 */

const owner = { owner: "BuilderForce" };

describe("subagentSystemPrompt", () => {
  it("tells the child it is a clone — every tool its owner holds, the slice carried out end to end", () => {
    const prompt = subagentSystemPrompt(undefined, owner);
    expect(prompt).toMatch(/every tool your owner holds/);
    expect(prompt).not.toMatch(/READ-ONLY/);
  });

  it("says the owner sees only the final report — the reason it must stand alone", () => {
    expect(subagentSystemPrompt(undefined, owner)).toMatch(/must stand alone/);
  });

  it("names the owner and says it keeps working", () => {
    const prompt = subagentSystemPrompt(undefined, owner);
    expect(prompt).toContain("spawned by BuilderForce");
    expect(prompt).not.toContain("blocked until you answer");
  });

  it("tells the child how its owner's redirection arrives", () => {
    expect(subagentSystemPrompt(undefined, owner)).toContain('"[BuilderForce]"');
  });

  it("promises no step budget it does not have", () => {
    expect(subagentSystemPrompt(undefined, owner)).not.toContain("step budget");
  });
});

describe("subagentSystemPrompt with a persona", () => {
  const persona = { name: "Ada", brief: "You are Ada, the workspace's data engineer." };

  it("names the agent the child is acting as", () => {
    expect(subagentSystemPrompt(persona, owner)).toContain("acting as Ada");
  });

  it("puts the identity FIRST, so it frames the work rather than trailing it", () => {
    const prompt = subagentSystemPrompt(persona, owner);
    expect(prompt.indexOf("acting as Ada")).toBeLessThan(prompt.indexOf("sub-agent"));
  });

  it("changes the voice, never the procedure — the sub-agent rules all survive", () => {
    const prompt = subagentSystemPrompt(persona, owner);
    expect(prompt).toMatch(/every tool your owner holds/);
    expect(prompt).toMatch(/must stand alone/);
  });
});
