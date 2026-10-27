/**
 * The learned-facts extraction — brought from `clients/vscode/src/memoryCommit.test.ts`
 * with imports retargeted and the node-I/O cases (`readChangedExcerpt`,
 * `commitRunKnowledge`, `commitRunKnowledgeIfAllowed`) dropped: they read the workspace
 * (`node:fs` + `git`), which is the adapter's job in this Worker/browser/Node-safe
 * package. The pure extraction half is ported unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import {
  commitLearnedFacts,
  memoryCommitPrompt,
  MIN_FACT_CHARS,
  parseLearnedFacts,
} from "../src/policy/memory/learnedFacts.js";

const DECISION = "Refresh the map token from file mtime, not from names alone.";

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
