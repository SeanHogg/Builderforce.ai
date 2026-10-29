import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { InMemoryIngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { localSnapshotStore, type DirectorySource, type JudgementPort } from "@seanhogg/builderforce-memory/knowledge";
import { buildStoredGraph, reviewPacks, runKnowledgeReview } from "@builderforce/agent-tools/knowledge";
import { defineRegistry, runGate, type PrefetchPort } from "@builderforce/prefetch";
import { OPEN_IN_GRAPH_LABEL_KEY, OPEN_KNOWLEDGE_GRAPH_COMMAND } from "@builderforce/agent-tools/prefetch";
import { configureHostKnowledgeIndex, getHostKnowledgeIndex, workspaceKnowledgeIndex } from "../knowledge/index/hostKnowledgeIndex";
import { KNOWLEDGE_ASK_ROWS, knowledgeAskExecutors } from "./knowledgeAskRow";
import { knowledgeRootId } from "../knowledge/knowledgeRoots";
import { VSCODE_PREFETCH_REGISTRY } from "./executors";

const ROOT = path.resolve("/tmp/kx-ask-repo");
const fn = (name: string) => ({ name, kind: "function" as const, line: 1, exported: true });

async function seeded(): Promise<void> {
  configureHostKnowledgeIndex({
    workspaceRoots: () => [ROOT],
    idle: () => undefined,
    embedder: async () => undefined,
    symbolFiles: async () => [
      { path: "src/billing/invoice.ts", symbols: [fn("createInvoice")] },
      { path: "src/billing/stripeWebhook.ts", symbols: [fn("handleStripeWebhook")] },
      { path: "src/net/retryPolicy.ts", symbols: [fn("retryPolicy")] },
    ],
  });
  const index = workspaceKnowledgeIndex(ROOT);
  await index.search("warm up");
  for (let i = 0; i < 100 && (await index.size()) === 0; i++) await new Promise((r) => setTimeout(r, 5));
}

const port = (): PrefetchPort => ({
  registry: defineRegistry([...KNOWLEDGE_ASK_ROWS]),
  executors: knowledgeAskExecutors(() => ROOT),
  ports: { surface: "vscode" },
});

afterEach(() => configureHostKnowledgeIndex({ workspaceRoots: () => [] }));

describe("knowledge.ask in the editor's gate", () => {
  it("is in the editor's registry", () => {
    expect(VSCODE_PREFETCH_REGISTRY.some((a) => a.id === "knowledge.ask")).toBe(true);
  });

  it("an exact hit settles the turn with no model, with the Open-in-graph chip", async () => {
    await seeded();
    const adopt = vi.fn(async () => true);
    const pass = await runGate("which file owns retryPolicy?", port(), { adopt });
    expect(pass?.settled).toBe("answer");
    expect(pass?.answer?.result.text).toContain("`src/net/retryPolicy.ts`");
    expect(pass?.answer?.result.chips?.[0]).toMatchObject({ labelKey: OPEN_IN_GRAPH_LABEL_KEY, command: OPEN_KNOWLEDGE_GRAPH_COMMAND });
    expect((pass?.answer?.result.chips?.[0]?.args as { focus: string[] }).focus).toContain(`src:${knowledgeRootId(ROOT)}::src/net/retryPolicy.ts`);
  });

  it("an ambiguous question falls back to PREFETCH: the hits ride into the turn, nothing is adopted", async () => {
    await seeded();
    const adopt = vi.fn(async () => true);
    const pass = await runGate("where is billing handled", port(), { adopt });
    expect(adopt).not.toHaveBeenCalled();
    expect(pass?.settled).toBe("prefetch");
    expect(pass?.tail[0]).toContain("## Knowledge index");
    expect(pass?.tail[0]).toContain("src/billing/");
  });
});

describe("knowledge.ask over a REVIEWED root (the index filled by its review, not only symbol files)", () => {
  const DOCS: Record<string, string> = {
    "lease.md": ["# Lease", "", "## Termination", "", "Either party may terminate the lease with 30 days notice.", ""].join("\n"),
    "policy.md": ["# Policy", "", "Rent is paid monthly.", ""].join("\n"),
  };
  const source = (): DirectorySource => ({
    rootId: knowledgeRootId(ROOT),
    title: "docs",
    async *list() {
      for (const [p, text] of Object.entries(DOCS)) yield { path: p, hash: `h:${p}:${text.length}`, size: text.length };
    },
    async read(p) {
      return { id: p, tenantId: "docs", title: p, content: { kind: "text", text: DOCS[p] ?? "", mediaType: "text/markdown" } };
    },
  });
  const judgement: JudgementPort = {
    async judge(req) {
      return {
        extract: req.items.map((i) => ({ ref: i.ref, claims: [{ subject: "lease", predicate: "requires", object: "30 days notice to terminate", quote: i.text.slice(0, 20) }], entities: [] })),
        invalid: 0,
      };
    },
  };

  it("answers a question about a document from the index its review filled", async () => {
    // No code at all: the only thing the index can know is what the review's graph gave it.
    configureHostKnowledgeIndex({ workspaceRoots: () => [ROOT], idle: () => undefined, embedder: async () => undefined, symbolFiles: async () => [] });
    const rootId = knowledgeRootId(ROOT);
    let snapshot: string | undefined;
    const ports = {
      source: source(),
      store: localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } }),
      manifest: new InMemoryIngestManifest(),
      judgement,
    };
    await runKnowledgeReview(ports);
    const graph = await buildStoredGraph({ rootId, store: ports.store, manifest: ports.manifest, packs: reviewPacks({}) });
    expect(graph?.nodes.some((n) => n.kind === "claim")).toBe(true);

    const before = await knowledgeAskExecutors(() => ROOT)["knowledge.ask"]!.run("what does the lease say about termination", new AbortController().signal);
    expect(before).toBeUndefined();

    await (await getHostKnowledgeIndex(rootId)).upsertFromGraph(graph!);
    const out = await knowledgeAskExecutors(() => ROOT)["knowledge.ask"]!.run("what does the lease say about termination", new AbortController().signal);
    expect(out?.text).toContain("lease.md");
    expect((out?.data as { hits: number }).hits).toBeGreaterThan(0);
    expect(out?.chips?.[0]).toMatchObject({ labelKey: OPEN_IN_GRAPH_LABEL_KEY, command: OPEN_KNOWLEDGE_GRAPH_COMMAND });
    expect((out?.chips?.[0]?.args as { focus: string[] }).focus.some((f) => f.includes("lease.md"))).toBe(true);
  });
});
