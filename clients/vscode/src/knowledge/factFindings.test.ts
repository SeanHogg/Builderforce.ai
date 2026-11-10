/**
 * factFindings.test.ts — the knowledge view's generic and code-pack findings come FROM the root's fact index through
 * memory's `FindingsProvider` (PRD 41 §B5, M5): on the WHOLE graph memory hands it, its findings equal the built-in rules'
 * (the same rules, memory `finding()` ids); the docs pack's own findings are kept; nothing is provided before the index
 * has synced (a cold index would replace the built-ins with partial ones); an unchanged knowledge input reruns nothing.
 */

import { describe, expect, it } from "vitest";
import { CODE_FACT_RULES, CODE_FINDING_RULES } from "@builderforce/agent-tools/knowledge";
import {
  KNOWLEDGE_FINDING_RULES, computeFindings, computeFindingsWith, srcRef,
  type Finding, type FindingRule, type KEdge, type KNode, type KnowledgeGraph, type KnowledgePack, type NodeRef,
} from "@seanhogg/builderforce-memory/knowledge";
import { FactIndex } from "./factIndex";
import { FACT_RULE_FINDING_KINDS, factFindingsProvider } from "./factFindings";

const ref = (p: string) => srcRef("r", p) as NodeRef;
const node = (p: string, extra: Partial<KNode> = {}): KNode => ({ ref: ref(p), kind: "file", label: p, pack: "code", importance: 0, origin: "extracted", ...extra });
const edge = (a: string, b: string, extra: Partial<KEdge>): KEdge => ({ from: ref(a), to: ref(b), kind: "references", weight: 1, origin: "extracted", ...extra });
const docsRule: FindingRule = { id: "docs.broken", find: () => [{ id: "broken-link:x", kind: "broken-link", pack: "docs", nodes: [], severity: "warn", params: {} }] };
const packs = [{ id: "code", findings: CODE_FINDING_RULES }, { id: "docs", findings: [docsRule] }] as unknown as KnowledgePack[];

const graph: KnowledgeGraph = {
  scope: { rootId: "r", packs: ["code", "docs"], digest: "d1" },
  nodes: [node("a.ts"), node("b.ts"), node("dead.ts", { badges: { unused: "file" } })],
  edges: [edge("a.ts", "b.ts", { cycle: true }), edge("b.ts", "a.ts", { cycle: true })],
  findings: [],
  stats: { sources: 3, nodes: 3, edges: 2, stale: 0, truncated: false },
};

const synced = async (): Promise<FactIndex> => {
  const index = new FactIndex({ facts: async () => undefined });
  await index.sync([]);
  return index;
};
const ids = (fs: readonly Finding[]) => fs.map((f) => f.id).sort();

describe("factFindingsProvider", () => {
  it("owns every generic and code finding kind", () => {
    for (const r of KNOWLEDGE_FINDING_RULES) expect(FACT_RULE_FINDING_KINDS).toContain(r.id);
    for (const r of CODE_FACT_RULES) expect(FACT_RULE_FINDING_KINDS).toContain(r.id.replace(/^code\./, ""));
  });

  it("before the index has synced there is no provider (the built-in rules stand)", () => {
    expect(factFindingsProvider(undefined)).toBeUndefined();
    expect(factFindingsProvider(new FactIndex({ facts: async () => undefined }))).toBeUndefined();
  });

  it("synced: memory's findings with the provider equal the built-ins, the docs pack's kept, the index's own objects used", async () => {
    const index = await synced();
    const provider = factFindingsProvider(index)!;
    const withProvider = computeFindingsWith(graph, packs, new Map(), [], provider);
    expect(ids(withProvider)).toEqual(ids(computeFindings(graph, packs, new Map(), [])));
    expect(ids(withProvider)).toContain("broken-link:x");
    expect(withProvider.find((f) => f.kind === "cycle")).toEqual(index.findings().find((f) => f.kind === "cycle"));
  });

  it("an unchanged knowledge input reruns no knowledge rule", async () => {
    const index = await synced();
    const provider = factFindingsProvider(index)!;
    computeFindingsWith(graph, packs, new Map(), [], provider);
    const rows = index.current.derived;
    computeFindingsWith(graph, packs, new Map(), [], provider);
    expect([...index.current.derived].every(([k, row]) => rows.get(k) === row)).toBe(true);
  });
});
