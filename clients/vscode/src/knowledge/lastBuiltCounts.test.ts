/**
 * lastBuiltCounts.test.ts — the Sync panel reads a root's counts from the last graph BUILT (or
 * seen), never a fresh build: a `live`/`load` push replaces the counts, a `lastSeen` snapshot
 * fills them only until a fresher build lands.
 *
 * Evidence re-verification: busts the verify cache (content-hash key) so the pre-push
 * gate re-runs checks against the repaired install instead of replaying a stale record.
 */

import { describe, expect, it } from "vitest";
import { graphCounts } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { LastBuiltCounts } from "./lastBuiltCounts";

const graph = (rootId: string, over: Partial<KnowledgeGraph["stats"]> = {}): KnowledgeGraph => ({
  scope: { rootId, packs: [], digest: `d:${rootId}` },
  nodes: [
    { ref: `src:${rootId}::a.ts` as never, kind: "file", label: "a.ts", pack: "code", importance: 0, origin: "extracted" },
    { ref: `doc:${rootId}::b.md` as never, kind: "file", label: "b.md", pack: "docs", importance: 0, origin: "extracted" },
  ],
  edges: [],
  findings: [],
  stats: { sources: 2, nodes: 2, edges: 0, stale: 0, truncated: false, ...over },
});

describe("LastBuiltCounts", () => {
  it("notes a built graph's counts; unknown roots have none", () => {
    const counts = new LastBuiltCounts();
    expect(counts.get("r")).toBeUndefined();
    counts.note("r", graph("r"));
    expect(counts.get("r")).toEqual(graphCounts(graph("r")));
    expect(counts.get("other")).toBeUndefined();
  });

  it("a fresher build replaces the counts", () => {
    const counts = new LastBuiltCounts();
    counts.note("r", graph("r", { sources: 2 }));
    const before = counts.get("r");
    counts.note("r", graph("r", { sources: 9, edges: 7 }));
    // The counts reflect the LATEST build, not the earlier one.
    expect(counts.get("r")?.edges).toBe(7);
    expect(counts.get("r")).not.toEqual(before);
    expect(counts.get("r")).toEqual(graphCounts(graph("r", { sources: 9, edges: 7 })));
  });

  it("a last-seen snapshot fills the counts only until a build lands", () => {
    const counts = new LastBuiltCounts();
    counts.noteSnapshot("r", graph("r", { sources: 1 }));
    expect(counts.get("r")).toEqual(graphCounts(graph("r", { sources: 1 })));
    counts.note("r", graph("r", { sources: 5 }));
    expect(counts.get("r")).toEqual(graphCounts(graph("r", { sources: 5 })));
    // A later snapshot does NOT overwrite the fresher build.
    counts.noteSnapshot("r", graph("r", { sources: 1 }));
    expect(counts.get("r")).toEqual(graphCounts(graph("r", { sources: 5 })));
  });
});
