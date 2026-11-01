/**
 * The volatile tail a request carries last is charged in the hand-off's budget, measured by the kernel as it builds the request (so
 * deleting that measurement fails here): the same transcript is handed over whole without a tail and is cut with one.
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type PlatformTools, type RunEvent, type RunMessage, type RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK, schemas } from "../support/policyContext.js";

async function failOver(turnSections: (() => string[]) | undefined) {
  const narrates: ModelCompletion = { content: "Let me search for that now.", model: "p/m" };
  const answers: ModelCompletion[] = [narrates, narrates, narrates, narrates, { content: "The handler is in agent-loop.ts.", model: "p/m2" }];
  const rows: RunMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "TASK", task: true }];
  // about 9K tokens of history: it fits a 16K window less its 4K reserve on its own, and not beside a 3K tail
  for (let i = 0; i < 9; i += 1) rows.push({ role: i % 2 === 0 ? "assistant" : "user", content: `row ${i} ${"x".repeat(4_000)}` });
  const events: RunEvent[] = [];
  let n = 0;
  const platform: PlatformTools = {
    closed: true,
    verbatimText: true,
    schemas: () => schemas(["read"]),
    selection: { query: "", limit: 50, required: new Set<string>() },
    execute: async () => ({ data: "ok" }),
  };
  const ports: RunPorts = {
    model: {
      complete: async () => answers[n++]!,
      pickFallback: (tried) => (tried.includes("p/m2") ? undefined : "p/m2"),
      window: (model) => (model === "p/m2" ? 16_384 : 1_000_000),
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (e) => void events.push(e) },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }), ...(turnSections ? { turnSections } : {}) },
    platform,
  };
  await runAgent({ task: { ...TEST_TASK, transcript: rows }, policy: { ...TEST_POLICY, pinnedModel: "p/m", modelHandoff: true }, ports });
  return events.filter((e): e is Extract<RunEvent, { kind: "context.compacted" }> => e.kind === "context.compacted");
}

describe("a hand-off charges the tail the last request carried", () => {
  it("without a tail the transcript is handed over whole", async () => {
    const folds = await failOver(undefined);
    expect(folds.at(-1)).toMatchObject({ dropped: 0 });
  });

  it("with a 3K-token tail the same transcript is cut", async () => {
    const folds = await failOver(() => [`## run record\n${"r".repeat(12_000)}`]);
    expect(folds.at(-1)!.dropped).toBeGreaterThan(0);
  });
});
