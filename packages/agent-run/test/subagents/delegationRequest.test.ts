import { describe, expect, it } from "vitest";
import {
  asksForSubagents,
  attemptedDelegation,
  leftDelegationUndone,
  undelegatedRequestNudge,
} from "../../src/policy/subagents/index.js";

/**
 * Ported from `brain-embedded/src/delegationRequest.test.ts`, retargeting the trace
 * event to the policy's own minimal shape (a label + a category).
 */

const tool = (label: string) => ({ category: "tool", label });
const EDITOR = ["read_file", "spawn_agent", "spawn_agents"];

describe("asksForSubagents", () => {
  it("recognises an explicit request for sub-agents", () => {
    expect(asksForSubagents("complete the remaining tickets using subagents")).toBe(true);
    expect(asksForSubagents("use sub-agents for S2–S8")).toBe(true);
    expect(asksForSubagents("spawn agents for each slice")).toBe(true);
    expect(asksForSubagents("run parallel agents on these")).toBe(true);
    expect(asksForSubagents("fan out the PRD workstreams")).toBe(true);
  });

  it("ignores a plain mention of an agent, and an explicit refusal", () => {
    expect(asksForSubagents("complete the remaining tickets")).toBe(false);
    expect(asksForSubagents("assign it to the developer agent")).toBe(false);
    expect(asksForSubagents("do it yourself, don't use subagents")).toBe(false);
    expect(asksForSubagents("without sub-agents please")).toBe(false);
    expect(asksForSubagents(null)).toBe(false);
  });
});

describe("leftDelegationUndone", () => {
  const request = "complete the remaining tickets using subagents";

  it("fires when the user asked, the host can spawn, and nothing was spawned", () => {
    expect(leftDelegationUndone({ toolNames: EDITOR, requestText: request, events: [tool("builtin_tasks_get")] })).toBe(true);
  });

  it("is quiet once a spawn was attempted — a refused child is a result to report", () => {
    expect(attemptedDelegation([tool("spawn_agent")])).toBe(true);
    expect(leftDelegationUndone({ toolNames: EDITOR, requestText: request, events: [tool("spawn_agents")] })).toBe(false);
  });

  it("is quiet on a host that cannot spawn (the web Brain)", () => {
    expect(leftDelegationUndone({ toolNames: ["builtin_tasks_get"], requestText: request, events: [] })).toBe(false);
  });

  it("is quiet when the user did not ask for sub-agents", () => {
    expect(leftDelegationUndone({ toolNames: EDITOR, requestText: "finish the tickets", events: [] })).toBe(false);
  });
});

describe("undelegatedRequestNudge", () => {
  it("names the false blockers and the call that clears them", () => {
    const nudge = undelegatedRequestNudge(EDITOR);
    expect(nudge).toContain("CLOUD runs only");
    expect(nudge).toContain("as_agent is optional");
    expect(nudge).toContain("staff the role on this project");
    expect(nudge).toContain("spawn_agents");
    expect(nudge).not.toContain("read_only");
  });

  it("falls back to spawn_agent where the host cannot fan out", () => {
    const nudge = undelegatedRequestNudge(["spawn_agent"]);
    expect(nudge).toContain("Call spawn_agent NOW");
    expect(nudge).not.toContain("spawn_agents");
  });
});
