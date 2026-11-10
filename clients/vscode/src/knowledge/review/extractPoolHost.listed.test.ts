import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CodeSymbol } from "@builderforce/agent-tools";
import { contentHash, type ExtractJob } from "@seanhogg/builderforce-memory/knowledge";
import { handleExtractJob, type HostExtractJob } from "./extractJobHandler";
import { withIndexSymbols } from "./extractPoolHost";

// One file, two spellings: the identity is NFC (`café.md`, é = U+00E9), the source listed it NFD (e + U+0301).
const NFC = "café.md";
const NFD = "café.md";

describe("the pool reads the listed spelling (PRD 41 §B2, memory readByPool.path)", () => {
  const dir = mkdtempSync(join(tmpdir(), "bf-listed-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const pooledJob = (hash: string): ExtractJob => ({ rootId: "ws", path: NFC, hash, knownKeys: [], readByPool: { path: NFD, hash } });

  it("hands the worker readByPool.path, never the NFC identity, and looks the index up by it", async () => {
    const seen: HostExtractJob[] = [];
    const looked: string[] = [];
    const symbols: CodeSymbol[] = [{ name: "x", kind: "function", line: 1, exported: true }];
    const lookup = (p: string) => { looked.push(p); return p === NFD ? symbols : undefined; };
    await withIndexSymbols(async (job) => { seen.push(job as HostExtractJob); return { extracted: [] }; }, lookup, dir)(pooledJob("h"));
    expect(seen[0]!.readFrom).toEqual({ rootPath: dir, path: NFD, hash: "h" });
    expect(seen[0]!.path).toBe(NFC);
    expect(looked).toEqual([NFD]);
    expect(seen[0]!.symbols).toEqual(symbols);
  });

  it("falls back to the identity for the index when the listed spelling misses", async () => {
    const looked: string[] = [];
    await withIndexSymbols(async () => ({ extracted: [] }), (p) => { looked.push(p); return undefined; }, dir)(pooledJob("h"));
    expect(looked).toEqual([NFD, NFC]);
  });

  it("opens the listed file and checks it against the planned contentHash (a CRLF file is not 'changed since plan')", async () => {
    const text = "# Café\r\n\r\nWords.\r\n";
    writeFileSync(join(dir, "crlf.md"), text);
    const hash = contentHash(new TextEncoder().encode(text));
    const job: HostExtractJob = { rootId: "ws", path: "crlf.md", hash, knownKeys: [], readByPool: { path: "crlf.md", hash }, readFrom: { rootPath: dir, path: "crlf.md", hash }, needSections: true };
    const out = await handleExtractJob(job);
    expect(out.extracted).toHaveLength(1);
    expect(out.extracted[0]!.sourceHash).toBe(hash);
  });
});
