import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { knowledgeMeasuredWith } from "@builderforce/agent-tools/knowledge";
import { knowledgeBaseline } from "./knowledgeBaseline";

const graph = (packs: string[]): KnowledgeGraph => ({
  scope: { rootId: "ws", packs, digest: "d1" }, nodes: [], edges: [], findings: [],
  stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
});

/** What a review of `packs` recorded when it ran on this editor. */
const same = (packs: string[]) => knowledgeMeasuredWith(packs);
/** The after side: this machine's local review of the root. */
const here = (packs: string[], measured = same(packs), rootId = "ws") => ({ rootId, packs, measured, local: true });

describe("knowledgeBaseline (PRD 41 §C9)", () => {
  it("is comparable when the stored review was measured by the same packs, extractor and tools, whatever the pack order", () => {
    expect(knowledgeBaseline(graph(["docs", "code"]), same(["docs", "code"]), here(["code", "docs"]))).toMatchObject({ comparable: true, reasons: [] });
  });

  it("is not comparable when a pack measured only one side (its findings must not read as resolved), and says which", () => {
    expect(knowledgeBaseline(graph(["code"]), same(["code"]), here(["code", "docs"]))).toMatchObject({ comparable: false, reasons: ["tool-missing:pack:docs"] });
    expect(knowledgeBaseline(graph(["code", "docs"]), same(["code", "docs"]), here(["code"])).comparable).toBe(false);
  });

  it("is not comparable across roots", () => {
    expect(knowledgeBaseline(graph(["code"]), same(["code"]), here(["code"], same(["code"]), "other")).reasons).toContain("scope-changed");
  });

  it("is not comparable when the platform's review came from another extractor version", () => {
    const stored = { ...same(["code"]), extractorVersion: `${same(["code"]).extractorVersion}-old` };
    expect(knowledgeBaseline(graph(["code"]), stored, here(["code"]))).toMatchObject({ comparable: false, reasons: ["extractor-version-changed"] });
  });

  it("is not comparable when the platform's review came from another analyzer version, or without an analyzer", () => {
    const { knip: _knip, ...withoutKnip } = same(["code"]).toolVersions;
    expect(knowledgeBaseline(graph(["code"]), { ...same(["code"]), toolVersions: { ...same(["code"]).toolVersions, knip: "0.0.1" } }, here(["code"])).reasons)
      .toEqual(["tool-version-changed:knip"]);
    expect(knowledgeBaseline(graph(["code"]), { ...same(["code"]), toolVersions: withoutKnip }, here(["code"])).reasons).toEqual(["tool-missing:knip"]);
  });

  it("the after side is what ITS review recorded, not this editor's versions now (a review made before an upgrade)", () => {
    const old = { ...same(["code"]), extractorVersion: "1" };
    expect(knowledgeBaseline(graph(["code"]), old, here(["code"], old))).toMatchObject({ comparable: true });
  });

  it("treats a review stored before versions were recorded as unknown — never comparable", () => {
    expect(knowledgeBaseline(graph(["code"]), undefined, here(["code"])).comparable).toBe(false);
    expect(knowledgeBaseline(graph(["docs"]), undefined, here(["docs"])).reasons).toContain("measured-unknown");
  });
});
