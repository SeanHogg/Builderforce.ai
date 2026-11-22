/**
 * The memory hook at run end: which transcript row counts as the run's answer (only the END of the transcript — never an
 * earlier run's, seeded as history), and the one failure rule `observe` records by.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryHook } from "../src/policy/memory/index.js";
import { setLearnedFactDeps } from "../src/policy/memory/learnedFacts.js";

const FACT = JSON.stringify([{ key: "canvas-drawn-by", kind: "root_cause", content: "The canvas is drawn by CanvasStage in web/src/a.tsx." }]);

/** A run's PolicyContext as far as the memory hook reads it: its state (memory slice + transcript) and its task. */
function ctx(messages: unknown[], reads = ["a.ts", "b.ts", "c.ts"]) {
  const state = {
    messages,
    memory: { memory: { read: reads, created: [], edited: [], deleted: [], searched: [] }, tools: reads.map(() => "read_file") },
  };
  return { state, task: {} } as never;
}

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string, toolCalls?: unknown[]) => ({ role: "assistant", content, ...(toolCalls ? { toolCalls } : {}) });

afterEach(() => {
  setLearnedFactDeps(null);
});

describe("memoryHook.consolidate's final answer", () => {
  function install() {
    const complete = vi.fn(async (_user: string) => FACT);
    setLearnedFactDeps({ complete, remember: async () => true });
    return complete;
  }

  it("adopts the transcript's last plain assistant row", async () => {
    const complete = install();
    await memoryHook.consolidate(ctx([user("where is it?"), assistant("", [{ id: "1", name: "read_file", arguments: "{}" }]), { role: "tool", content: "x" }, assistant("It is in a.tsx.")]));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0]).toContain("Conclusion:\nIt is in a.tsx.");
  });

  it("never reaches back to an earlier run's answer in the seeded history", async () => {
    const complete = install();
    // The run ended on a tool-calling row, after an earlier run's answer.
    await memoryHook.consolidate(ctx([user("first"), assistant("Earlier answer."), user("second"), assistant("", [{ id: "1", name: "read_file", arguments: "{}" }]), { role: "tool", content: "x" }]));
    // The run never answered its latest user row.
    await memoryHook.consolidate(ctx([user("first"), assistant("Earlier answer."), user("second")]));
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("memoryHook.observe's failure rule", () => {
  it("does not record a remember_fact whose result is a serialized { ok: false } envelope", () => {
    const c = ctx([]);
    memoryHook.observe(c, { id: "1", name: "remember_fact", args: { key: "bad", content: "A fact that was never saved." } }, JSON.stringify({ ok: false, error: "denied" }));
    memoryHook.observe(c, { id: "2", name: "remember_fact", args: { key: "good", content: "A fact that was saved." } }, { ok: true });
    const state = (c as unknown as { state: { memory: { savedFacts?: Array<{ key: string }> } } }).state;
    expect(state.memory.savedFacts?.map((f) => f.key)).toEqual(["good"]);
  });
});
