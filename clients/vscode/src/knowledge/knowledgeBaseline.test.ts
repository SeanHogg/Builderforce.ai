import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { knowledgeBaseline, knowledgeSideMeta } from "./knowledgeBaseline";

const graph = (packs: string[]): KnowledgeGraph => ({
  scope: { rootId: "ws", packs, digest: "d1" }, nodes: [], edges: [], findings: [],
  stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
});

describe("knowledgeBaseline (PRD 41 §C9)", () => {
  it("is comparable when the stored review was measured by the same packs, whatever their order", () => {
    expect(knowledgeBaseline(graph(["docs", "code"]), { rootId: "ws", packs: ["code", "docs"] })).toMatchObject({ comparable: true });
  });

  it("is not comparable when a pack measured only one side (its findings must not read as resolved)", () => {
    expect(knowledgeBaseline(graph(["code"]), { rootId: "ws", packs: ["code", "docs"] }).comparable).toBe(false);
    expect(knowledgeBaseline(graph(["code", "docs"]), { rootId: "ws", packs: ["code"] }).comparable).toBe(false);
  });

  it("is not comparable across roots", () => {
    expect(knowledgeBaseline(graph(["code"]), { rootId: "other", packs: ["code"] }).comparable).toBe(false);
  });

  it("states packs as tools and the hash rule only when known", () => {
    expect(knowledgeSideMeta({ rootId: "ws", packs: ["code", "code"] })).toEqual({ scope: "ws", tools: { code: "" } });
    expect(knowledgeSideMeta({ rootId: "ws", packs: [], contentHashRule: "eol-lf@1" })).toEqual({ scope: "ws", tools: {}, contentHashRule: "eol-lf@1" });
  });
});
