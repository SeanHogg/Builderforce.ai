import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import {
  commitLearnedFacts,
  commitRunKnowledge,
  commitRunKnowledgeIfAllowed,
  memoryCommitPrompt,
  MIN_FACT_CHARS,
  parseLearnedFacts,
  readChangedExcerpt,
} from "./memoryCommit";

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

describe("readChangedExcerpt", () => {
  it("returns the head of a changed file and skips a path that escapes the root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-mem-"));
    await fs.writeFile(path.join(root, "a.ts"), "export const token = 1;\n", "utf8");
    const excerpt = await readChangedExcerpt(root, ["a.ts", "../outside.ts", "missing.ts"]);
    expect(excerpt).toContain("## a.ts");
    expect(excerpt).toContain("export const token = 1;");
    expect(excerpt).not.toContain("outside.ts");
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
    await commitRunKnowledge(root, ran([["edit_file", { path: "a.ts" }]]), { complete, remember });
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
