/**
 * extractJobHandler.facts.test.ts — the `factsOnly` job (PRD 41 §B3): the background indexer's FileFacts ride THE
 * extraction pool's handler (the code a worker runs, and the in-thread fallback). The worker reads the file itself,
 * verifies the planned hash, resolves imports against the root's disk, and answers `fileFacts` with no `Extracted`.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isCappedFacts } from "@builderforce/agent-tools/knowledge";
import { nodeContentHash } from "../nodeSha256";
import { handleExtractJob, type HostExtractJob } from "./extractJobHandler";

const root = mkdtempSync(path.join(tmpdir(), "bf-facts-"));
mkdirSync(path.join(root, "src"));
const A = "import { b } from './b';\r\nexport function a(x: number): number { return b(x); }\r\n";
writeFileSync(path.join(root, "src", "a.ts"), A);
writeFileSync(path.join(root, "src", "b.ts"), "export const b = (x: number) => x;\n");
writeFileSync(path.join(root, "README.md"), "# hi\n");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const job = (file: string, hash: string): HostExtractJob => ({
  rootId: "r", path: file, hash, knownKeys: [], readByPool: { path: file, hash }, readFrom: { rootPath: root, path: file, hash }, factsOnly: true,
});
const hashOf = (text: string) => nodeContentHash(new TextEncoder().encode(text));

describe("handleExtractJob — factsOnly", () => {
  it("answers the file's RAW FileFacts (CRLF on disk; imports as specifiers — the host resolves them) and no Extracted", async () => {
    const result = await handleExtractJob(job("src/a.ts", hashOf(A)));
    expect(result.extracted).toEqual([]);
    expect(result.fileFacts?.contentHash).toBe(hashOf(A));
    expect(result.fileFacts?.imports).toEqual([{ specifier: "./b", names: ["b"] }]);
    expect(result.fileFacts?.exports.map((e) => e.name)).toEqual(["a"]);
  });

  it("a file without a fact grammar is never read (it answers no facts); a stale hash is 'changed since plan'", async () => {
    expect(await handleExtractJob(job("missing/never-read.md", "h"))).toEqual({ extracted: [] });
    await expect(handleExtractJob(job("src/a.ts", "0".repeat(64)))).rejects.toThrow("changed since plan");
  });

  it("a run side's TEXT (not on disk) is extracted as is, under the job's hash", async () => {
    const text = "export function onlyInText(): void {}\n";
    const { readFrom: _disk, ...base } = job("src/gone.ts", "side-hash");
    const result = await handleExtractJob({ ...base, factsText: text });
    expect(result.fileFacts?.contentHash).toBe("side-hash");
    expect(result.fileFacts?.exports.map((e) => e.name)).toEqual(["onlyInText"]);
  });

  it("a file past the read cap answers CAPPED facts (present, empty), never a failure retried forever", async () => {
    const big = "export const a = 1;\n".repeat(120_000);
    writeFileSync(path.join(root, "src", "big.ts"), big);
    const result = await handleExtractJob(job("src/big.ts", hashOf(big)));
    expect(isCappedFacts(result.fileFacts!)).toBe(true);
    expect(result.fileFacts?.contentHash).toBe(hashOf(big));
  });
});
