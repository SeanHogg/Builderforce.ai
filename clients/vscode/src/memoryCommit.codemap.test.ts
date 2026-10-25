import * as os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import { codemapFactMeta, commitRunKnowledge, commitRunKnowledgeIfAllowed, MEMORY_OFF_NOTE } from "./memoryCommit";

// PRD 35 E8: the code map is written with its file anchors (the chat id is added by the
// editor's port), a read-only run counts, and Memory off leaves one trace line.

function ran(calls: Array<[string, Record<string, unknown>]>, prompt?: string): RunKnowledgeRecorder {
  const r = new RunKnowledgeRecorder();
  if (prompt) r.setPrompt(prompt);
  for (const [name, args] of calls) r.record(name, args);
  return r;
}
const reads = (...paths: string[]): Array<[string, Record<string, unknown>]> => paths.map((p) => ["read_file", { path: p }]);

describe("codemapFactMeta", () => {
  it("anchors every listed file, never a deleted one", () => {
    const content = [
      "Code map for `web/src` (mapped 2026-10-25).",
      "Open these first instead of searching:",
      "- web/src/a.tsx (changed)",
      "- web/src/b.tsx (read 3×)",
      "- web/src/c.tsx",
      "- web/src/gone.tsx (deleted)",
      "(+2 more file(s) touched)",
    ].join("\n");
    expect(codemapFactMeta(content)).toEqual({ fileAnchors: [{ path: "web/src/a.tsx" }, { path: "web/src/b.tsx" }, { path: "web/src/c.tsx" }] });
  });
});

describe("commitRunKnowledge with a code-map port", () => {
  it("writes a READ-ONLY run's map through it, with the files it read as anchors", async () => {
    const remember = vi.fn(async () => true);
    const rememberCodemap = vi.fn(async (_key: string, _content: string, _meta: unknown) => true);
    const complete = vi.fn(async () => "[]");
    await commitRunKnowledge(
      os.tmpdir(),
      ran(reads("docs/specs/a.md", "docs/specs/b.md", "docs/specs/c.md"), "review the PRD"),
      { complete, remember, rememberCodemap },
    );
    expect(complete).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
    expect(rememberCodemap).toHaveBeenCalledTimes(1);
    const [key, , meta] = rememberCodemap.mock.calls[0]!;
    expect(key).toBe("codemap:docs/specs");
    expect(meta).toEqual({ fileAnchors: [{ path: "docs/specs/a.md" }, { path: "docs/specs/b.md" }, { path: "docs/specs/c.md" }] });
  });

  it("writes nothing for a lookup of fewer than three files", async () => {
    const rememberCodemap = vi.fn(async () => true);
    await commitRunKnowledge(os.tmpdir(), ran(reads("docs/a.md", "docs/b.md")), { complete: async () => "[]", remember: async () => true, rememberCodemap });
    expect(rememberCodemap).not.toHaveBeenCalled();
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
