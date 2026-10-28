import { describe, expect, it } from "vitest";
import type { HostKnowledgeIndexCore, Recall } from "@builderforce/agent-tools/knowledge-index";
import { KNOWLEDGE_PART_HITS, knowledgePart, knowledgeRecall, preSearchPaths } from "./knowledgeSource";

const ROOT = "/ws/repo";

/** An index whose recall answers `recall` after `delayMs`. */
function fakeIndex(recall: Recall, delayMs = 0): (root: string) => HostKnowledgeIndexCore {
  const index = {
    recall: (q: string) => new Promise<Recall>((r) => setTimeout(() => r({ ...recall, digest: q }), delayMs)),
  } as unknown as HostKnowledgeIndexCore;
  return () => index;
}

const RECALL: Recall = {
  tiers: ["exact", "lexical"],
  digest: "d",
  hits: [
    { id: "src:repo::src/billing/invoice.ts", score: 1, tier: "exact", path: "src/billing/invoice.ts", meta: { kind: "file", partition: "domain", text: "src/billing/invoice.ts · src/billing" } },
    { id: "src:repo::src/billing/stripe.ts", score: 0.02, tier: "lexical", path: "src/billing/stripe.ts", meta: { kind: "file" } },
    { id: "src:repo::src/net/http.ts", score: 0.01, tier: "lexical", path: "src/net/http.ts", expanded: true },
  ],
};

describe("context pack — the knowledge part", () => {
  it("renders the hits with paths, kind and partition, and the one-hop neighbours apart", async () => {
    const k = await knowledgeRecall(ROOT, "where is billing handled", 1_000, { index: fakeIndex(RECALL) });
    expect(k?.query).toBe("billing");
    const block = knowledgePart(k, new Set());
    expect(block).toContain("## Knowledge index");
    expect(block).toContain("- `src/billing/invoice.ts` (file, domain) — src/billing/invoice.ts · src/billing");
    expect(block).toContain("Related (one hop in the graph):\n- `src/net/http.ts`");
  });

  it("drops every hit whose file the pre-search already names", async () => {
    const k = await knowledgeRecall(ROOT, "billing", 1_000, { index: fakeIndex(RECALL) });
    const exclude = preSearchPaths({
      definitions: [{ identifier: "createInvoice", path: "src/billing/invoice.ts", line: 3, kind: "function", exported: true }],
      references: [{ identifier: "createInvoice", path: "src/billing/stripe.ts", line: 9, text: "createInvoice()" }],
    });
    const block = knowledgePart(k, exclude);
    expect(block).not.toContain("invoice.ts");
    expect(block).not.toContain("stripe.ts");
    expect(block).toContain("src/net/http.ts");
    expect(knowledgePart(k, new Set(RECALL.hits.map((h) => h.path!)))).toBe("");
  });

  it("respects the pack's deadline: a late index is no part, never waited on", async () => {
    const started = Date.now();
    expect(await knowledgeRecall(ROOT, "billing", 30, { index: fakeIndex(RECALL, 500) })).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("a failed or empty index is no part, and nothing is asked without a root or a request", async () => {
    const failing = () => ({ recall: () => Promise.reject(new Error("boom")) }) as unknown as HostKnowledgeIndexCore;
    expect(await knowledgeRecall(ROOT, "billing", 1_000, { index: failing })).toBeUndefined();
    expect(await knowledgeRecall(ROOT, "billing", 1_000, { index: fakeIndex({ ...RECALL, hits: [] }) })).toBeUndefined();
    expect(await knowledgeRecall("", "billing", 1_000, { index: fakeIndex(RECALL) })).toBeUndefined();
    expect(knowledgePart(undefined, new Set())).toBe("");
  });

  it("is per-turn content only: a pointer list, bounded, with no stable-prefix material", async () => {
    const many: Recall = { ...RECALL, hits: Array.from({ length: 20 }, (_, i) => ({ id: `src:repo::f${i}.ts`, score: 1 - i / 100, tier: "lexical" as const, path: `f${i}.ts` })) };
    const block = knowledgePart(await knowledgeRecall(ROOT, "billing", 1_000, { index: fakeIndex(many) }), new Set());
    expect(block.split("\n").filter((l) => l.startsWith("- ")).length).toBe(KNOWLEDGE_PART_HITS);
    expect(block).not.toMatch(/system prompt|<run-state>/i);
  });
});
