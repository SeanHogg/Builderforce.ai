import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { knowledgeMeasuredWith } from "@builderforce/agent-tools/knowledge";
import { knowledgeBaseline, knowledgeSideMeta } from "./knowledgeBaseline";

const graph = (packs: string[]): KnowledgeGraph => ({
  scope: { rootId: "ws", packs, digest: "d1" }, nodes: [], edges: [], findings: [],
  stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
});

/** What this editor measures with — what its own upload of the same review stored. */
const same = (packs: string[]) => knowledgeMeasuredWith(packs);

describe("knowledgeBaseline (PRD 41 §C9)", () => {
  it("is comparable when the stored review was measured by the same packs, extractor and tools, whatever the pack order", () => {
    expect(knowledgeBaseline(graph(["docs", "code"]), same(["docs", "code"]), { rootId: "ws", packs: ["code", "docs"] })).toMatchObject({ comparable: true });
  });

  it("is not comparable when a pack measured only one side (its findings must not read as resolved)", () => {
    expect(knowledgeBaseline(graph(["code"]), same(["code"]), { rootId: "ws", packs: ["code", "docs"] }).comparable).toBe(false);
    expect(knowledgeBaseline(graph(["code", "docs"]), same(["code", "docs"]), { rootId: "ws", packs: ["code"] }).comparable).toBe(false);
  });

  it("is not comparable across roots", () => {
    expect(knowledgeBaseline(graph(["code"]), same(["code"]), { rootId: "other", packs: ["code"] }).comparable).toBe(false);
  });

  it("is not comparable when the platform's review came from another extractor version", () => {
    const stored = { ...same(["code"]), extractorVersion: `${same(["code"]).extractorVersion}-old` };
    expect(knowledgeBaseline(graph(["code"]), stored, { rootId: "ws", packs: ["code"] }).comparable).toBe(false);
  });

  it("is not comparable when the platform's review came from another analyzer version, or without an analyzer", () => {
    const { knip: _knip, ...withoutKnip } = same(["code"]).toolVersions;
    expect(knowledgeBaseline(graph(["code"]), { ...same(["code"]), toolVersions: { ...same(["code"]).toolVersions, knip: "0.0.1" } }, { rootId: "ws", packs: ["code"] }).comparable).toBe(false);
    expect(knowledgeBaseline(graph(["code"]), { ...same(["code"]), toolVersions: withoutKnip }, { rootId: "ws", packs: ["code"] }).comparable).toBe(false);
  });

  it("treats a review stored before versions were recorded as unknown — never comparable", () => {
    expect(knowledgeBaseline(graph(["code"]), {}, { rootId: "ws", packs: ["code"] }).comparable).toBe(false);
    expect(knowledgeBaseline(graph(["docs"]), {}, { rootId: "ws", packs: ["docs"] }).comparable).toBe(false);
  });

  it("states packs and analyzers as tools, and the extractor and hash rule only when known", () => {
    expect(knowledgeSideMeta({ rootId: "ws", packs: ["code", "code"] })).toEqual({ scope: "ws", tools: { code: "" } });
    expect(knowledgeSideMeta({ rootId: "ws", packs: [], contentHashRule: "eol-lf@1" })).toEqual({ scope: "ws", tools: {}, contentHashRule: "eol-lf@1" });
    expect(knowledgeSideMeta({ rootId: "ws", packs: ["code"], extractorVersion: "5", toolVersions: { knip: "5.30.0" } }))
      .toEqual({ scope: "ws", tools: { code: "", knip: "5.30.0" }, extractorVersion: "5" });
  });
});
