/**
 * PRD 41 §11 ("background indexing slows typing"): one per-file slice of the background indexer runs on the extension
 * host's thread — the real edited-file path (`markFilesEdited`: hash, mark stale, re-extract) — so the event-loop delay it
 * causes is what a person typing would feel. Measured with `monitorEventLoopDelay` around a real slice on a large file.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { markFilesEdited, reviewPacks, runKnowledgeReview } from "@builderforce/agent-tools/knowledge";
import { localSnapshotStore, type DirectorySource } from "@seanhogg/builderforce-memory/knowledge";
import { InMemoryIngestManifest } from "@seanhogg/builderforce-memory/ingest";

/**
 * The event-loop delay a single slice on a large file may cause, p99. A keystroke waits at most this long for the host.
 * (Measured ≈14 ms for this ~10k-line file on a developer machine; the bound leaves room for a slow CI runner.)
 */
const P99_BOUND_MS = 100;
const ROOT = "/w";

/** A large, realistic TypeScript file: many exported functions with imports, calls and branches. */
function bigSource(functions: number, salt: string): string {
  const lines = ["import { readFile } from 'node:fs/promises';", "import type { Thing } from './thing';", ""];
  for (let i = 0; i < functions; i++) {
    lines.push(
      `export async function step${i}${salt}(input: Thing, n: number): Promise<number> {`,
      `  if (n > ${i}) return n - ${i};`,
      `  const text = await readFile(input.path + '${i}', 'utf8');`,
      `  for (const line of text.split('\\n')) { if (line.includes('${i}')) n += line.length; }`,
      `  return step${(i + 1) % functions}${salt}(input, n + 1);`,
      "}",
      "",
    );
  }
  return lines.join("\n");
}

describe("a background slice on the host thread (PRD 41 §11)", () => {
  it("keeps the host's event-loop delay p99 bounded while it re-extracts a large file", async () => {
    const disk: Record<string, string> = { "src/big.ts": bigSource(1_500, "a") };
    const source: DirectorySource = {
      rootId: "r", title: "w",
      async *list() { for (const [path, text] of Object.entries(disk)) yield { path, hash: `h:${text.length}`, size: text.length }; },
      async read(path) { return { id: path, tenantId: "r", title: path, content: { kind: "text", text: disk[path] ?? "", mediaType: "text/typescript" } }; },
    };
    let snapshot: string | undefined;
    const store = localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } });
    const manifest = new InMemoryIngestManifest();
    await runKnowledgeReview({ source, store, manifest }, { judgeFiles: 0 });

    disk["src/big.ts"] = bigSource(1_500, "b"); // a save that changes every symbol
    const edit = {
      rootId: "r", rootPath: ROOT, store, manifest, packs: reviewPacks({}),
      fs: { readFile: async (abs: string) => new TextEncoder().encode(disk[abs.slice(ROOT.length + 1)] ?? "") },
    };

    const delay = monitorEventLoopDelay({ resolution: 5 });
    delay.enable();
    const results = await markFilesEdited(edit, ["src/big.ts"]);
    // Let the histogram take its sample after the slice's last synchronous stretch.
    await new Promise((resolve) => setTimeout(resolve, 20));
    delay.disable();

    expect(results).toEqual([{ path: "src/big.ts", reviewed: true, staled: true }]);
    const p99Ms = delay.percentile(99) / 1e6;
    expect(p99Ms).toBeLessThan(P99_BOUND_MS);
  });
});
