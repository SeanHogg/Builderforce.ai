import { describe, expect, it } from "vitest";
import { readFileTool, type CapabilityProvider, type RepoReadResult } from "@builderforce/agent-tools";
import { shapeToolResult } from "@builderforce/tool-output-policy";
import { ReadCoverage } from "@builderforce/run-guards";
import { AGENT_READ_TRAITS } from "../../src/policy/tools/readCoverage.js";

/** An in-memory repo with exactly the files given. */
function provider(files: Record<string, string>): CapabilityProvider {
  return {
    capabilities: new Set(["repo.read"]),
    repoRead: {
      async listFiles(): Promise<never> {
        throw new Error("not used");
      },
      async readFile(path: string): Promise<RepoReadResult> {
        return path in files ? { ok: true, path, content: files[path] } : { ok: false, error: `${path}: not found` };
      },
      async searchCode(): Promise<never> {
        throw new Error("not used");
      },
    },
  } as CapabilityProvider;
}

/** ~506 lines, ~38 KB: the shape of docs/specs/47-prd-collection-view.md in chat #149169. */
function prdDoc(): string {
  const out: string[] = [];
  for (let i = 1; i <= 506; i++) out.push(i % 50 === 1 ? `## Section ${i}` : `Line ${i} ${"p".repeat(66)}`);
  return out.join("\n");
}

describe("read_file paged through the transcript budget", () => {
  it("regression: chat #149169 — paging a 38K doc on a 16K budget terminates", async () => {
    const doc = prdDoc();
    const docLines = doc.split("\n");
    expect(doc.length).toBeGreaterThan(36_000);
    const caps = provider({ "docs/prd.md": doc });

    const seen = new Set<number>();
    let requested: number | undefined;
    let reads = 0;
    for (;;) {
      reads++;
      expect(reads).toBeLessThanOrEqual(4);
      // The model's shape of call from the chat: a windowed read with a limit.
      const args: Record<string, unknown> = { path: "docs/prd.md", limit: 180, ...(requested !== undefined ? { offset: requested } : {}) };
      const data = (await readFileTool.execute(args, { caps })).data;
      const shaped = shapeToolResult("read_file", data, { maxChars: 16_000 });
      expect(shaped.content.length).toBeLessThanOrEqual(16_000);
      const served = JSON.parse(shaped.content) as { offset: number; content: string; truncated: boolean; totalLines: number };

      expect(served.offset).toBe(requested ?? 1);
      const lines = served.content.split("\n");
      lines.forEach((line, i) => {
        expect(line).toBe(docLines[served.offset - 1 + i]);
        seen.add(served.offset + i);
      });
      if (!served.truncated) break;
      requested = served.offset + lines.length;
    }

    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: docLines.length }, (_, i) => i + 1));
  });
});
