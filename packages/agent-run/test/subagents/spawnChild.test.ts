import { describe, expect, it, vi } from "vitest";
import { ALL_ENTRY_POINTS } from "@builderforce/learned-routing";
import { MAX_SUBAGENT_DEPTH } from "@builderforce/agent-loop";
import { spawnChild, type ChildStartRequest, type SpawnChildRequest } from "../../src/index.js";

const REQUEST: SpawnChildRequest = {
  parentRunId: "parent-42", entryPoint: "vscode", depth: 1,
  owner: "Ada", task: "Check the implementation", role: "verify",
};

describe("shared child start", () => {
  it.each(ALL_ENTRY_POINTS)("preserves %s and the native background admission without waiting for a report", async (entryPoint) => {
    const admitted = { running: true, handle: "a42" };
    const openRun = vi.fn(async (_start: ChildStartRequest) => admitted);
    const result = await spawnChild({ ...REQUEST, entryPoint, basePrompt: "BASE", persona: { name: "Grace", brief: "PERSONA" }, workItemIds: ["T1"] }, { openRun });
    expect(result).toBe(admitted);
    expect(openRun).toHaveBeenCalledWith(expect.objectContaining({
      entryPoint, prompt: REQUEST.task, lineage: { parentRunId: "parent-42", depth: 1 }, workItemIds: ["T1"],
    }));
    const start = openRun.mock.calls[0]!;
    expect(start[0].systemPrompt).toContain("PERSONA");
    expect(start[0].systemPrompt).toContain("Ada");
    expect(start[0].systemPrompt).toContain("CHECK the change");
    expect(start[0].systemPrompt.endsWith("\n\nBASE")).toBe(true);
  });

  it.each([0, -1, 1.5, NaN, Infinity, MAX_SUBAGENT_DEPTH + 1])("rejects child depth %s before invoking the host", async (depth) => {
    const openRun = vi.fn();
    await expect(spawnChild({ ...REQUEST, depth }, { openRun })).rejects.toThrow("child depth");
    expect(openRun).not.toHaveBeenCalled();
  });

  it("allows the deepest child and returns a completed report unchanged", async () => {
    const report = { output: "Checked", steps: 3 };
    expect(await spawnChild({ ...REQUEST, depth: MAX_SUBAGENT_DEPTH }, { openRun: async () => report })).toBe(report);
  });

  it.each([{ parentRunId: " " }, { task: " " }, { owner: " " }, { entryPoint: undefined as never }])("rejects missing identity and brief before start", async (bad) => {
    const openRun = vi.fn();
    await expect(spawnChild({ ...REQUEST, ...bad }, { openRun })).rejects.toThrow("spawnChild:");
    expect(openRun).not.toHaveBeenCalled();
  });

  it("propagates the authenticated host's refusal", async () => {
    await expect(spawnChild(REQUEST, { openRun: async () => { throw new Error("not authorized"); } })).rejects.toThrow("not authorized");
  });
});
