import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CodeSymbol } from "@builderforce/agent-tools";
import { CODE_BADGES, indexedSymbolLookup, indexedSymbolSource, reviewPacks } from "@builderforce/agent-tools/knowledge";
import { DEFAULT_MAX_FILE_BYTES, extractJob, sha256Hex, type ExtractJob } from "@seanhogg/builderforce-memory/knowledge";
import { handleExtractJob, type HostExtractJob } from "./extractJobHandler";
import { withIndexSymbols } from "./extractPoolHost";

const jobFor = (path: string, text: string, extra: Partial<Omit<ExtractJob, "doc" | "readByPool">> = {}): ExtractJob => ({
  rootId: "ws", path, hash: `h-${path}`, knownKeys: [],
  doc: { id: path, tenantId: "t", content: { kind: "text", text } },
  ...extra,
});

const indexed: Array<{ path: string; symbols: readonly CodeSymbol[] }> = [
  { path: "pkg/src/a.ts", symbols: [{ name: "fromIndex", kind: "function", line: 1, exported: true }, { name: "alsoIndexed", kind: "function", line: 2, exported: true }] },
];
const lookup = indexedSymbolLookup(indexed, "pkg");

const FILES: Array<[string, string]> = [
  ["src/a.ts", "export function inRegexToo() {}\nexport const other = 1;\n"], // index HIT: the index's symbols win over the regex's
  [".hidden/b.ts", "export function inDotDir() {}\nfunction local() {}\n"], // index MISS (dot-dir the index skips): regex
  ["README.md", "# Title\n\nSome words about it.\n\n## Part\n\nMore.\n"], // docs pack
  ["src/big.ts", `${"export function filler() {}\n".repeat(60_000)}`], // large file
];

describe("one symbol rule for the pooled and the in-thread extraction", () => {
  it.each(FILES)("%s extracts the same through the worker's handler as in-thread", async (path, text) => {
    const base = jobFor(path, text, { needSections: true });
    const viaPool = await handleExtractJob(await withHit(base));
    const inThread = extractJob(base, reviewPacks({ symbolsOf: indexedSymbolSource(indexed, "pkg") }));
    expect(viaPool).toEqual(inThread);
  });

  it("a hit uses the index's definitions and a miss the regex extractor", async () => {
    const hit = await handleExtractJob(await withHit(jobFor("src/a.ts", "export function inRegexToo() {}\n")));
    expect(hit.extracted[0]!.nodes[0]!.badges?.[CODE_BADGES.symbols]).toBe(2);
    const miss = await handleExtractJob(await withHit(jobFor(".hidden/b.ts", "export function inDotDir() {}\n")));
    expect(miss.extracted[0]!.nodes[0]!.badges?.[CODE_BADGES.symbols]).toBe(1);
  });

  it("a sectionsOnly job reads no symbols and extracts nothing", async () => {
    let looked = 0;
    const counting = (p: string) => { looked += 1; return lookup(p); };
    const seen: HostExtractJob[] = [];
    const wrapped = withIndexSymbols(async (job) => { seen.push(job as HostExtractJob); return handleExtractJob(job as HostExtractJob); }, counting);
    const result = await wrapped(jobFor("src/a.ts", "export function x() {}\n", { sectionsOnly: true }));
    expect(looked).toBe(0);
    expect(seen[0]!.symbols).toBeUndefined();
    expect(result.extracted).toEqual([]);
    expect(result.sections?.length).toBeGreaterThan(0);
  });

  it("returns the file's sections when the job asks for them", async () => {
    const result = await handleExtractJob({ ...jobFor("notes.md", "# Title\n\nSome words.\n"), needSections: true });
    expect(result.extracted).toHaveLength(1);
    expect(result.sections?.length).toBeGreaterThan(0);
  });
});

describe("a worker that reads its own file (PRD 41 A10)", () => {
  const dir = mkdtempSync(join(tmpdir(), "bf-readfrom-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const stub = (path: string): ExtractJob => ({ rootId: "ws", path, hash: `h-${path}`, knownKeys: [], readByPool: { path, hash: `h-${path}` } });

  it("extracts the same as a job carrying the document, with the planned hash", async () => {
    const text = "# Title\n\nSome words about it.\n";
    writeFileSync(join(dir, "n.md"), text);
    const planned = await sha256Hex(Buffer.from(text));
    const viaRead = await handleExtractJob({ ...stub("n.md"), hash: "ignored", readFrom: { rootPath: dir, path: "n.md", hash: planned }, needSections: true });
    const inline = await handleExtractJob({ ...jobFor("n.md", text, { hash: planned }), needSections: true });
    expect(viaRead).toEqual(inline);
  });

  it("throws \"changed since plan\" when the file was edited after planning, for a normal and a sectionsOnly job", async () => {
    const planned = await sha256Hex(Buffer.from("# Old\n"));
    writeFileSync(join(dir, "edited.md"), "# New, edited after the plan\n");
    const readFrom = { rootPath: dir, path: "edited.md", hash: planned };
    await expect(handleExtractJob({ ...stub("edited.md"), readFrom })).rejects.toThrow("changed since plan");
    await expect(handleExtractJob({ ...stub("edited.md"), readFrom, sectionsOnly: true })).rejects.toThrow("changed since plan");
  });

  it("returns {binary: true} for a binary file and extracts nothing", async () => {
    const binary = Buffer.from([1, 0, 2, 0, 0, 255, 0, 3]);
    writeFileSync(join(dir, "b.dat"), binary);
    const out = await handleExtractJob({ ...stub("b.dat"), readFrom: { rootPath: dir, path: "b.dat", hash: await sha256Hex(binary) } });
    expect(out).toEqual({ extracted: [], binary: true });
  });

  it("fails a file over the size cap and a path outside the root", async () => {
    writeFileSync(join(dir, "huge.txt"), Buffer.alloc(DEFAULT_MAX_FILE_BYTES + 1, 97));
    await expect(handleExtractJob({ ...stub("huge.txt"), readFrom: { rootPath: dir, path: "huge.txt", hash: "h" } })).rejects.toThrow("too large");
    await expect(handleExtractJob({ ...stub("../x"), readFrom: { rootPath: dir, path: "../x", hash: "h" } })).rejects.toThrow(/outside/);
  });
});

/** The job as the pool receives it: with the index's definitions attached when the file is a hit. */
async function withHit(job: ExtractJob): Promise<HostExtractJob> {
  let seen: HostExtractJob = job;
  await withIndexSymbols(async (j) => { seen = j as HostExtractJob; return { extracted: [] }; }, lookup)(job);
  return seen;
}
