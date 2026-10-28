import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { KnowledgeIndexFiles, SymbolFile } from "@builderforce/agent-tools/knowledge-index";
import { configureHostKnowledgeIndex, getHostKnowledgeIndex, workspaceKnowledgeIndex } from "./hostKnowledgeIndex";
import { knowledgeRootId } from "../knowledgeRoots";

const ROOT = path.resolve("/tmp/kx-host-repo");
/** THE root-id rule's id of the folder (`rootIdFor` via `knowledgeRootId`) — not its name. */
const ROOT_ID = knowledgeRootId(ROOT);
const fn = (name: string) => ({ name, kind: "function" as const, line: 1, exported: true });
const FILES: SymbolFile[] = [
  { path: "src/billing/invoice.ts", symbols: [fn("createInvoice")] },
  { path: "src/net/retryPolicy.ts", symbols: [fn("retryPolicy")] },
];

function memoryFiles(): KnowledgeIndexFiles & { store: Map<string, Uint8Array>; reads: string[] } {
  const store = new Map<string, Uint8Array>();
  const reads: string[] = [];
  return {
    store, reads,
    read: async (p) => { reads.push(p); return store.get(p); },
    write: async (p, b) => { store.set(p, b.slice()); },
    rename: async (a, b) => { store.set(b, store.get(a)!); store.delete(a); },
    mkdir: async () => {},
  };
}

/** Idle work runs only when the test says so. */
function manualIdle() {
  let task: (() => Promise<void>) | undefined;
  return Object.assign((t: () => Promise<void>) => { task = t; }, { run: async () => { const t = task; task = undefined; await t?.(); } });
}

async function seededSize(): Promise<number> {
  const index = workspaceKnowledgeIndex(ROOT);
  await index.search("warm up");
  for (let i = 0; i < 100 && (await index.size()) === 0; i++) await new Promise((r) => setTimeout(r, 5));
  return index.size();
}

afterEach(() => configureHostKnowledgeIndex({ workspaceRoots: () => [] }));

describe("editor host knowledge index", () => {
  it("is lazy: nothing is read until the first call", async () => {
    const files = memoryFiles();
    configureHostKnowledgeIndex({ workspaceRoots: () => [ROOT], files, symbolFiles: async () => FILES, idle: manualIdle(), embedder: async () => undefined });
    const index = await getHostKnowledgeIndex(ROOT_ID);
    expect(files.reads).toEqual([]);
    await index.search("retryPolicy");
    expect(files.reads.some((p) => p.includes(".builderforce/knowledge/") && p.endsWith(".idx"))).toBe(true);
  });

  it("seeds the workspace root from the code pack on first use, and persists it under the workspace on idle", async () => {
    const files = memoryFiles();
    const idle = manualIdle();
    configureHostKnowledgeIndex({ workspaceRoots: () => [ROOT], files, symbolFiles: async () => FILES, idle, embedder: async () => undefined });
    expect(await seededSize()).toBeGreaterThan(0);
    const hits = await (await getHostKnowledgeIndex(ROOT_ID)).search("createInvoice");
    expect(hits[0]).toMatchObject({ id: `src:${ROOT_ID}::src/billing/invoice.ts`, tier: "exact" });
    await idle.run();
    expect([...files.store.keys()].some((p) => p.replace(/\\/g, "/").startsWith(`${ROOT.replace(/\\/g, "/")}/.builderforce/knowledge/`))).toBe(true);
  });

  it("returns the same index for the same root id", async () => {
    configureHostKnowledgeIndex({ workspaceRoots: () => [ROOT], idle: manualIdle(), symbolFiles: async () => FILES, embedder: async () => undefined });
    expect(await getHostKnowledgeIndex(ROOT_ID)).toBe(workspaceKnowledgeIndex(ROOT));
  });
});
