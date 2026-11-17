/**
 * A3's `finish` through the kernel (VS Code chat #146477): verified → idle → finish → the
 * next turn advertises NO tools, sends no tool choice, keeps the run's role, is never judged
 * as a stall, and its answer — empty or narrative — finishes the run with no further step.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { NO_PROGRESS_TURNS } from "@builderforce/run-guards";
import { runAgent, type ModelCompletion, type ModelRequest, type PlatformTools, type RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

const call = (name: string, args: Record<string, unknown>, id: string): ModelCompletion => ({ content: "", toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

async function runToFinish(final: ModelCompletion) {
  const script: ModelCompletion[] = [
    call("edit_file", { path: "src/a.ts", old_string: "x", new_string: "y" }, "e1"),
    call("run_tests", {}, "t1"),
    // Two idle stretches: the first verified trip only asks (a steer), the second finishes.
    ...Array.from({ length: 2 * NO_PROGRESS_TURNS }, (_, i) => call("git_status", {}, `g${i}`)),
    final,
    // Only ever the run-end synthesis a silent run gets (`synthesizeFinal`, no tools) — never a loop step.
    { content: "Changed src/a.ts; tests pass." },
  ];
  const requests: ModelRequest[] = [];
  let n = 0;
  const platform: PlatformTools = {
    closed: true,
    verbatimText: true,
    schemas: () => schemas(["edit_file", "run_tests", "git_status"]),
    selection: { query: "", limit: 50, required: new Set<string>() },
    execute: async () => ({ data: { ok: true } }),
  };
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push(request);
        const answer = script[n++];
        if (!answer) throw new Error("script exhausted — the run took a step after its final turn");
        return answer;
      },
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: () => undefined },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    platform,
  };
  const outcome = await runAgent({ task: TEST_TASK, policy: { ...TEST_POLICY, levers: ["a3_progress_detector"] }, ports });
  return { outcome, requests, finalAt: script.length - 2 };
}

describe("regression: chat #146477 — the final turn through the kernel", () => {
  for (const [name, final] of [["narrative", { content: "Changed src/a.ts; tests pass." }], ["empty", { content: "" }]] as const) {
    it(`regression: a ${name} final turn with no tools finishes the run, with no further step`, async () => {
      const { outcome, requests, finalAt } = await runToFinish(final);
      const last = requests[finalAt]!;
      expect(last.tools ?? []).toEqual([]);
      expect(last.toolChoice).toBeUndefined();
      expect(last.role).not.toBe("chat");
      expect(requests[finalAt - 1]!.tools?.length ?? 0).toBeGreaterThan(0);
      // Nothing after it offers a tool: a narrative answer ends the loop outright; an empty one gets only the run-end synthesis.
      expect(requests.length).toBe(name === "narrative" ? finalAt + 1 : finalAt + 2);
      expect(requests.slice(finalAt).every((r) => (r.tools ?? []).length === 0)).toBe(true);
      expect(outcome.state.guards.finishDue).toBeUndefined();
      expect(JSON.stringify(outcome)).not.toMatch(/Paused for a human/);
    });
  }
});
