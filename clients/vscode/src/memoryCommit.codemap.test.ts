import * as os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import { commitRunKnowledge, commitRunKnowledgeIfAllowed, MEMORY_OFF_NOTE } from "./memoryCommit";

// PRD 35 E8: a read-only run's code map is written (its file anchors are derived by the
// facts store, one rule for every writer), and Memory off leaves one trace line.

function ran(calls: Array<[string, Record<string, unknown>]>, prompt?: string): RunKnowledgeRecorder {
  const r = new RunKnowledgeRecorder();
  if (prompt) r.setPrompt(prompt);
  for (const [name, args] of calls) r.record(name, args);
  return r;
}
const reads = (...paths: string[]): Array<[string, Record<string, unknown>]> => paths.map((p) => ["read_file", { path: p }]);

describe("commitRunKnowledge's code map", () => {
  it("writes a READ-ONLY run's map", async () => {
    const remember = vi.fn(async (_key: string, _content: string) => true);
    const complete = vi.fn(async () => "[]");
    await commitRunKnowledge(
      os.tmpdir(),
      ran(reads("docs/specs/a.md", "docs/specs/b.md", "docs/specs/c.md"), "review the PRD"),
      { complete, remember },
    );
    expect(complete).not.toHaveBeenCalled();
    expect(remember).toHaveBeenCalledTimes(1);
    expect(remember.mock.calls[0]![0]).toBe("codemap:docs/specs");
  });

  it("writes nothing for a lookup of fewer than three files", async () => {
    const remember = vi.fn(async () => true);
    await commitRunKnowledge(os.tmpdir(), ran(reads("docs/a.md", "docs/b.md")), { complete: async () => "[]", remember });
    expect(remember).not.toHaveBeenCalled();
  });
});

describe("commitRunKnowledgeIfAllowed's trace note", () => {
  const activity = ran(reads("web/src/a.tsx", "web/src/b.tsx", "web/src/c.tsx"));

  it("says once, when Memory is off, that no facts were written", async () => {
    const note = vi.fn();
    const resolveDeps = vi.fn(async () => ({ complete: async () => "[]", remember: async () => true }));
    await commitRunKnowledgeIfAllowed(os.tmpdir(), activity, { memory: false }, resolveDeps, note);
    expect(resolveDeps).not.toHaveBeenCalled();
    expect(note).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledWith(MEMORY_OFF_NOTE);
  });

  it("says nothing when Memory is on", async () => {
    const note = vi.fn();
    await commitRunKnowledgeIfAllowed(os.tmpdir(), activity, { memory: true }, async () => ({ complete: async () => "[]", remember: async () => true }), note);
    expect(note).not.toHaveBeenCalled();
  });
});
