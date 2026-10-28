import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureHostKnowledgeIndex, workspaceKnowledgeIndex } from "../knowledge/index/hostKnowledgeIndex";
import { preSearchBlock, withPreSearch } from "./preSearchSource";

vi.mock("../ripgrep", () => ({ findRipgrep: async () => "rg" }));
vi.mock("../workspaceSearch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workspaceSearch")>()),
  searchWorkspace: async (opts: { query: string }) => ({ ok: true, query: opts.query, matches: [{ path: "src/billing/invoice.ts", line: 4, text: "createInvoice()" }] }),
}));

const ROOT = path.resolve("/tmp/kx-pack-repo");
const fn = (name: string) => ({ name, kind: "function" as const, line: 1, exported: true });
const symbols = {
  find: async (name: string) => ({ ok: true, matches: name === "createInvoice" ? [{ path: "src/billing/invoice.ts", line: 2, kind: "function" as const, name, exported: true }] : [] }),
};

afterEach(() => configureHostKnowledgeIndex({ workspaceRoots: () => [] }));

async function seed(): Promise<void> {
  configureHostKnowledgeIndex({
    workspaceRoots: () => [ROOT],
    idle: () => undefined,
    embedder: async () => undefined,
    symbolFiles: async () => [
      { path: "src/billing/invoice.ts", symbols: [fn("createInvoice")] },
      { path: "src/billing/stripeWebhook.ts", symbols: [fn("handleStripeWebhook")] },
    ],
  });
  const index = workspaceKnowledgeIndex(ROOT);
  await index.search("warm up");
  for (let i = 0; i < 100 && (await index.size()) === 0; i++) await new Promise((r) => setTimeout(r, 5));
}

describe("the pre-search block carries the knowledge part", () => {
  it("appends the index's hits after the pre-search's, minus the files the pre-search names", async () => {
    await seed();
    const block = await preSearchBlock(ROOT, "where is billing handled? it calls createInvoice", 1_500, { symbols });
    expect(block).toContain("## Pre-search");
    expect(block).toContain("## Knowledge index");
    const knowledge = block.slice(block.indexOf("## Knowledge index"));
    expect(knowledge).toContain("src/billing/stripeWebhook.ts");
    expect(knowledge).not.toContain("`src/billing/invoice.ts`");
  });

  it("lands only in the pack's volatile block (withPreSearch), the per-turn tail", async () => {
    await seed();
    const pack = await withPreSearch(Promise.resolve(undefined), preSearchBlock(ROOT, "where is billing handled", 1_500, { symbols }));
    expect(pack?.block).toContain("## Knowledge index");
    expect(pack?.recallHint).toBe("");
    expect(pack?.servedReads).toEqual([]);
  });
});
