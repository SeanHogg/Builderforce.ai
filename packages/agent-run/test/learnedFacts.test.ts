/**
 * The run-end memory commit — brought from `clients/vscode/src/memoryCommit.test.ts` with
 * imports retargeted and nothing else changed.
 *
 * One source case is NOT carried: `readChangedExcerpt` reads the workspace with node
 * `fs` + `git`, which this Worker/browser/Node-safe package may not do; it is the
 * surface's `MemoryCommitDeps.excerpt` port here and stays with the VS Code adapter.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import { commitLearnedFacts, memoryCommitPrompt, MIN_FACT_CHARS, parseLearnedFacts } from "../src/policy/memory/learnedFacts.js";
import { commitRunKnowledge, commitRunKnowledgeIfAllowed, finishedRun } from "../src/policy/memory/runKnowledgeCommit.js";

const DECISION = "Refresh the map token from file mtime, not from names alone.";

/** A finished run's record, from the tool calls it made. */
function ran(calls: Array<[string, Record<string, unknown>]>, prompt?: string): RunKnowledgeRecorder {
  const r = new RunKnowledgeRecorder();
  if (prompt) r.setPrompt(prompt);
  for (const [name, args] of calls) r.record(name, args);
  return r;
}
const reads = (...paths: string[]): Array<[string, Record<string, unknown>]> => paths.map((p) => ["read_file", { path: p }]);

describe("parseLearnedFacts", () => {
  it("reads a fenced JSON array and prefixes a stable learned: key", () => {
    const facts = parseLearnedFacts(
      "```json\n" +
        JSON.stringify([
          { key: "Map Token", kind: "decision", content: DECISION },
          { key: "learned:map-token", kind: "convention", content: "Always fingerprint nested files by size and mtime." },
        ]) +
        "\n```",
    );
    expect(facts.map((f) => f.key)).toEqual(["learned:map-token"]);
    // The second item collapses onto the same key and is dropped.
    expect(facts).toHaveLength(1);
    expect(facts[0]?.kind).toBe("decision");
    expect(facts[0]?.content).toBe(DECISION);
  });

  it("drops short content, unknown kinds, workspace: keys, and prose with no array", () => {
    expect(parseLearnedFacts("nothing durable here")).toEqual([]);
    const facts = parseLearnedFacts(
      JSON.stringify([
        { key: "tiny", kind: "decision", content: "too short" },
        { key: "ok", kind: "guess", content: DECISION },
        { key: "workspace:scan", kind: "convention", content: DECISION },
        { key: "real-cause", kind: "root_cause", content: "The cache hashed names, so a same-size edit never missed." },
      ]),
    );
    expect(facts).toEqual([
      {
        key: "learned:real-cause",
        kind: "root_cause",
        content: "The cache hashed names, so a same-size edit never missed.",
      },
    ]);
    expect(DECISION.length).toBeGreaterThanOrEqual(MIN_FACT_CHARS);
  });
});

describe("commitLearnedFacts", () => {
  it("does not call the model when the run changed no files", async () => {
    const complete = vi.fn(async () => "[]");
    const remember = vi.fn(async () => true);
    await expect(commitLearnedFacts({ changed: [] }, { complete, remember })).resolves.toEqual([]);
    expect(complete).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it("writes each accepted fact and reports only the ones that landed", async () => {
    const remember = vi.fn(async (key: string) => key !== "learned:skipped");
    const landed = await commitLearnedFacts(
      { changed: ["src/a.ts"], prompt: "fix the cache" },
      {
        complete: async () =>
          JSON.stringify([
            { key: "kept", kind: "decision", content: DECISION },
            { key: "skipped", kind: "convention", content: "Skip sibling checkouts that are not this repository." },
          ]),
        remember,
      },
    );
    expect(remember).toHaveBeenCalledTimes(2);
    expect(landed.map((f) => f.key)).toEqual(["learned:kept"]);
  });

  it("returns nothing when the model throws, and still returns when a write throws", async () => {
    const complete = vi.fn(async () => {
      throw new Error("gateway down");
    });
    await expect(commitLearnedFacts({ changed: ["a.ts"] }, { complete, remember: async () => true })).resolves.toEqual(
      [],
    );

    const landed = await commitLearnedFacts(
      { changed: ["a.ts"] },
      {
        complete: async () => JSON.stringify([{ key: "boom", kind: "decision", content: DECISION }]),
        remember: async () => {
          throw new Error("facts down");
        },
      },
    );
    expect(landed).toEqual([]);
  });

  it("tells the model not to guess when there is no evidence", () => {
    expect(memoryCommitPrompt({ changed: ["src/a.ts"] })).toContain("return [] rather than guess");
  });
});

describe("commitRunKnowledge", () => {
  it("maps a read-only investigation without spending a completion", async () => {
    const complete = vi.fn(async () => "[]");
    const remember = vi.fn(async () => true);
    await commitRunKnowledge(
      os.tmpdir(),
      ran(reads("web/src/a.tsx", "web/src/b.tsx", "web/src/c.tsx"), "where is the canvas drawn?"),
      { complete, remember },
    );
    expect(complete).not.toHaveBeenCalled();
    expect(remember).toHaveBeenCalledTimes(1);
    expect(remember).toHaveBeenCalledWith("codemap:web/src", expect.stringContaining("- web/src/a.tsx"));
  });

  it("writes the map and still extracts learned facts for a run that changed files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-rk-"));
    await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;\n");
    const complete = vi.fn(async () => JSON.stringify([{ key: "map-token", kind: "decision", content: DECISION }]));
    const remember = vi.fn(async (_key: string, _content: string) => true);
    // builderforce-memory 2026.10.27: the 3-file code-map floor holds for a run that
    // changed files too, so the run also reads two files to be worth a map.
    await commitRunKnowledge(root, ran([["edit_file", { path: "a.ts" }], ["read_file", { path: "b.ts" }], ["read_file", { path: "c.ts" }]]), { complete, remember });
    expect(remember.mock.calls.map((c) => c[0])).toEqual(["codemap:(root)", "learned:map-token"]);
  });

  it("does not let a failed map write cost the learned facts", async () => {
    const remember = vi.fn(async (key: string) => {
      if (key.startsWith("codemap:")) throw new Error("down");
      return true;
    });
    const complete = vi.fn(async () => JSON.stringify([{ key: "k", kind: "convention", content: DECISION }]));
    await commitRunKnowledge(os.tmpdir(), ran([["edit_file", { path: "missing.ts" }]]), { complete, remember });
    expect(remember).toHaveBeenCalledWith("learned:k", DECISION);
  });
});

describe("read-only investigations", () => {
  const ANSWER = "The canvas is drawn by CanvasStage in web/src/a.tsx; b.tsx only feeds it layout.";
  const files = ["web/src/a.tsx", "web/src/b.tsx", "web/src/c.tsx"];
  const fact = JSON.stringify([{ key: "canvas-drawn-by", kind: "root_cause", content: DECISION }]);

  it("completes and writes for >=3 distinct reads plus an answer", async () => {
    const complete = vi.fn(async (_user: string) => fact);
    const remember = vi.fn(async () => true);
    const landed = await commitLearnedFacts({ changed: [], read: files, answer: ANSWER }, { complete, remember });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(landed.map((f) => f.key)).toEqual(["learned:canvas-drawn-by"]);
    const prompt = complete.mock.calls[0]![0];
    expect(prompt).toContain("Files read:");
    expect(prompt).toContain("- web/src/a.tsx");
    expect(prompt).toContain(`Conclusion:\n${ANSWER}`);
    expect(prompt).not.toContain("rather than guess");
  });

  it("does nothing under 3 distinct reads (duplicates do not count) or without an answer", async () => {
    const complete = vi.fn(async () => fact);
    const remember = vi.fn(async () => true);
    const deps = { complete, remember };
    await commitLearnedFacts({ changed: [], read: [files[0]!, files[0]!, files[1]!], answer: ANSWER }, deps);
    await commitLearnedFacts({ changed: [], read: files }, deps);
    await commitLearnedFacts({ changed: [], read: files, answer: "   " }, deps);
    expect(complete).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it("keeps the TAIL of a long conclusion, where the answer's verdict is", () => {
    const prompt = memoryCommitPrompt({ changed: [], read: files, answer: `${"intro ".repeat(1_000)}FINAL VERDICT: canvas lives in a.tsx` });
    expect(prompt).toContain("FINAL VERDICT: canvas lives in a.tsx");
    expect(prompt).not.toContain("intro ".repeat(900));
  });

  it("counts the conclusion as evidence for a changed run that has no excerpt", () => {
    const prompt = memoryCommitPrompt({ changed: ["src/a.ts"], answer: ANSWER });
    expect(prompt).toContain("Conclusion:");
    expect(prompt).not.toContain("rather than guess");
  });

  it("does not learn read-only when the run already saved its own fact (no double write)", async () => {
    const complete = vi.fn(async () => fact);
    const remember = vi.fn(async () => true);
    const deps = { complete, remember };
    await commitLearnedFacts({ changed: [], read: files, answer: ANSWER, tools: ["read_file", "builtin_remember_fact"] }, deps);
    await commitLearnedFacts({ changed: [], read: files, answer: ANSWER, tools: ["remember_fact"] }, deps);
    expect(complete).not.toHaveBeenCalled();
    // A run that changed files still extracts.
    await commitLearnedFacts({ changed: ["a.ts"], tools: ["remember_fact"], answer: ANSWER }, deps);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("learn:false (a failed or stopped run) writes the code map only", async () => {
    const complete = vi.fn(async () => fact);
    const remember = vi.fn(async (_key: string, _content: string) => true);
    const run = finishedRun(ran(reads(...files)), ANSWER);
    await commitRunKnowledge(os.tmpdir(), run, { complete, remember }, { learn: false });
    expect(complete).not.toHaveBeenCalled();
    expect(remember.mock.calls.map((c) => c[0])).toEqual(["codemap:web/src"]);
    await commitRunKnowledgeIfAllowed(os.tmpdir(), run, { memory: true, learn: false }, async () => ({ complete, remember }));
    expect(complete).not.toHaveBeenCalled();
  });

  it("bounds the conclusion", () => {
    const prompt = memoryCommitPrompt({ changed: [], read: files, answer: "x".repeat(10_000) });
    expect(prompt.length).toBeLessThan(3_500);
  });

  it("leaves the changed-files prompt unchanged in shape", () => {
    const prompt = memoryCommitPrompt({ changed: ["src/a.ts"], excerpt: "diff" });
    expect(prompt).toContain("Changed files:\n- src/a.ts");
    expect(prompt).toContain("Evidence:\ndiff");
    expect(prompt).not.toContain("Conclusion:");
  });

  it("finishedRun is a view over the recorder: carries the trimmed answer and does not mutate it", () => {
    const rec = ran(reads(...files));
    const run = finishedRun(rec, `  ${ANSWER}\n`);
    expect(run.answer).toBe(ANSWER);
    expect(run.activity.read).toEqual(files);
    expect("answer" in rec).toBe(false);
    expect("answer" in finishedRun(rec, "  ")).toBe(false);
  });

  it("commitRunKnowledge reads the answer off the finished run", async () => {
    const complete = vi.fn(async () => fact);
    const remember = vi.fn(async (_key: string, _content: string) => true);
    const run = Object.assign(ran(reads(...files)), { answer: ANSWER });
    await commitRunKnowledge(os.tmpdir(), run, { complete, remember });
    expect(remember.mock.calls.map((c) => c[0])).toEqual(["codemap:web/src", "learned:canvas-drawn-by"]);
  });
});

describe("commitRunKnowledgeIfAllowed", () => {
  const activity = ran(reads("web/src/a.tsx", "web/src/b.tsx", "web/src/c.tsx"));

  it("with the chat's Memory switch off, never even resolves the facts port", async () => {
    const resolveDeps = vi.fn(async () => ({ complete: async () => "[]", remember: async () => true }));
    await commitRunKnowledgeIfAllowed(os.tmpdir(), activity, { memory: false }, resolveDeps);
    expect(resolveDeps).not.toHaveBeenCalled();
  });

  it("with Memory on, commits through the resolved port", async () => {
    const remember = vi.fn(async (_key: string, _content: string) => true);
    await commitRunKnowledgeIfAllowed(os.tmpdir(), activity, { memory: true }, async () => ({ complete: async () => "[]", remember }));
    expect(remember).toHaveBeenCalledWith("codemap:web/src", expect.any(String));
  });

  it("swallows a port that cannot be resolved — a finished run never fails over memory", async () => {
    await expect(
      commitRunKnowledgeIfAllowed(os.tmpdir(), activity, { memory: true }, async () => {
        throw new Error("no project");
      }),
    ).resolves.toBeUndefined();
  });

  it("maps absolute paths under the workspace root as repo files", async () => {
    const root = path.join(os.tmpdir(), "bf-abs-root");
    const remember = vi.fn(async (_key: string, _content: string) => true);
    const abs = (rel: string) => path.join(root, rel);
    await commitRunKnowledge(
      root,
      ran(reads(abs("web/src/a.tsx"), abs("web/src/b.tsx"), abs("web/src/c.tsx"))),
      { complete: async () => "[]", remember },
    );
    expect(remember).toHaveBeenCalledWith("codemap:web/src", expect.stringContaining("- web/src/a.tsx"));
  });
});
