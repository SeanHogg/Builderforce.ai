/**
 * factIndex.store.test.ts — the fact index persisted (PRD 41 §B4) through memory's `FactStorePort` and its HOST CONTRACT:
 *   - a restored index equals the one that saved it, and its next sync extracts NOTHING that did not move;
 *   - two writers on one store: the loser of the version CAS loads, re-applies its unsaved change and saves (both land);
 *   - a corrupt store is reset and rebuilt from the files;
 *   - an early-cutoff step writes nothing (no generation spent).
 */

import { describe, expect, it } from "vitest";
import { extractFileFacts } from "@builderforce/agent-tools/node-file-facts";
import { factGraphDump, loadFactGraph, memoryFactStore, type FactStorePort } from "@seanhogg/builderforce-memory/knowledge";
import { FactGraphStore } from "./factGraphStore";
import { FactIndex } from "./factIndex";
import { nodeContentHash } from "./nodeSha256";

const enc = new TextEncoder();
const files = (): Map<string, string> => new Map([
  ["src/a.ts", "import { b } from './b';\nexport const a = () => b();\n"],
  ["src/b.ts", "export function b(): number { return 1; }\n"],
  ["src/c.ts", "export const c = 1;\n"],
]);
const listingOf = (tree: ReadonlyMap<string, string>) => [...tree].map(([path, text]) => ({ path, hash: nodeContentHash(enc.encode(text)) }));

function indexOn(port: FactStorePort, tree: ReadonlyMap<string, string>, extracted: string[] = []) {
  const logs: string[] = [];
  const index = new FactIndex({
    facts: (path) => { extracted.push(path); return extractFileFacts(path, tree.get(path) ?? ""); },
    store: new FactGraphStore(port, (what) => { logs.push(what); }),
  });
  return { index, logs, extracted };
}

describe("FactIndex persistence (FactStorePort)", () => {
  it("restores what it saved; the next sync extracts only what moved", async () => {
    const port = memoryFactStore();
    const tree = files();
    const first = indexOn(port, tree);
    await first.index.sync(listingOf(tree));
    await first.index.flush();
    expect(factGraphDump((await loadFactGraph(port)).graph)).toBe(factGraphDump(first.index.current));

    const extracted: string[] = [];
    const second = indexOn(port, tree, extracted);
    expect(await second.index.restore()).toBe(true);
    expect(factGraphDump(second.index.current)).toBe(factGraphDump(first.index.current));
    tree.set("src/c.ts", "export const c = 2;\n");
    const u = await second.index.sync(listingOf(tree));
    expect(extracted).toEqual(["src/c.ts"]);
    expect(u.changedPaths).toEqual(["src/c.ts"]);
  });

  it("two writers: a commit lands between B's read and B's write — B loads, re-applies its unsaved change, saves; both land", async () => {
    const port = memoryFactStore();
    const tree = files();
    const a = indexOn(port, tree);
    await a.index.sync(listingOf(tree));
    await a.index.flush();
    // B's first manifest write is preceded by A's commit (another window saving at the same moment): B's CAS fails.
    let raced = false;
    const racing: FactStorePort = {
      ...port,
      writeManifest: async (delta, puts, deletes) => {
        if (!raced) {
          raced = true;
          tree.set("src/b.ts", "export function b(): number { return 2; }\n");
          await a.index.update([{ path: "src/b.ts", hash: nodeContentHash(enc.encode(tree.get("src/b.ts")!)) }]);
          await a.index.flush();
        }
        return port.writeManifest(delta, puts, deletes);
      },
    };
    const b = indexOn(racing, tree);
    await b.index.restore();
    tree.set("src/c.ts", "export const c = 3;\n");
    await b.index.update([{ path: "src/c.ts", hash: nodeContentHash(enc.encode(tree.get("src/c.ts")!)) }]);
    await b.index.flush();
    expect(raced).toBe(true);
    const stored = (await loadFactGraph(port)).graph;
    const contentOf = (p: string) => stored.manifest.get(p)?.contentHash;
    expect(contentOf("src/b.ts")).toBe(nodeContentHash(enc.encode(tree.get("src/b.ts")!)));
    expect(contentOf("src/c.ts")).toBe(nodeContentHash(enc.encode(tree.get("src/c.ts")!)));
    expect(b.logs).toEqual([]);
  });

  it("a corrupt store is reset: the index starts empty and its sync rebuilds it", async () => {
    const port = memoryFactStore();
    const tree = files();
    const a = indexOn(port, tree);
    await a.index.sync(listingOf(tree));
    await a.index.flush();
    const corrupt: FactStorePort = { ...port, getObjects: async (hashes) => new Map(hashes.map((h) => [h, "{not json"] as const)) };
    const b = indexOn(corrupt, tree);
    expect(await b.index.restore()).toBe(false);
    expect(b.logs.some((l) => l.includes("corrupt"))).toBe(true);
    expect((await port.readManifest()).files.size).toBe(0);
    await b.index.sync(listingOf(tree));
    await b.index.flush();
    expect([...(await port.readManifest()).files.keys()].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("an early-cutoff step (same content again) spends no generation", async () => {
    const port = memoryFactStore();
    const tree = files();
    const a = indexOn(port, tree);
    await a.index.sync(listingOf(tree));
    await a.index.flush();
    const before = (await port.readVersion()).generation;
    await a.index.sync(listingOf(tree));
    await a.index.flush();
    expect((await port.readVersion()).generation).toBe(before);
  });
});
