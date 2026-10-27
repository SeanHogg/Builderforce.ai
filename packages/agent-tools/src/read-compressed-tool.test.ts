import { describe, expect, it } from "vitest";
import type { CapabilityProvider, CompressResult, RepoSemanticCapability } from "./capabilities.js";
import { compressProse, proseKindOf } from "./proseCompress.js";
import { readCompressedTool } from "./read-compressed-tool.js";
import { buildCoreToolRegistry } from "./core-tools.js";
import { semanticCapabilitiesOf } from "./semantic-tools.js";

const halve = async (text: string): Promise<CompressResult> => ({ ok: true, text: text.slice(0, Math.floor(text.length / 2)), originalTokens: 100, keptTokens: 50 });
const PROSE = "The billing service retries a failed charge three times before it parks the invoice. ".repeat(60);

function caps(files: Record<string, string>, semantic?: Partial<RepoSemanticCapability>): CapabilityProvider {
  return {
    capabilities: new Set(["repo.read", "repo.compress"]),
    repoRead: {
      listFiles: async () => ({ ok: true, paths: Object.keys(files) }),
      readFile: async (p) => (files[p] !== undefined ? { ok: true, path: p, content: files[p] } : { ok: false, path: p, error: "file not found" }),
      searchCode: async () => ({ ok: true, matches: [] }),
    },
    ...(semantic ? { semantic: { search: async () => ({ ok: true, results: [] }), repoMap: async () => ({ ok: true, map: "" }), ...semantic } } : {}),
  };
}

describe("proseKindOf / compressProse", () => {
  it("classifies prose by extension and everything else as code", () => {
    expect(proseKindOf("docs/design/billing.md")).toBe("markdown");
    expect(proseKindOf("notes.TXT")).toBe("text");
    expect(proseKindOf("logs/run.log")).toBe("log");
    expect(proseKindOf("api/src/billing.ts")).toBe("code");
    expect(proseKindOf("Makefile")).toBe("code");
  });

  it("never compresses code, and needs a compressor for anything", async () => {
    let called = 0;
    const counting = async (t: string) => { called++; return halve(t); };
    expect((await compressProse(PROSE, "code", { compress: counting })).compressed).toBe(false);
    expect((await compressProse(PROSE, "markdown")).compressed).toBe(false);
    expect(called).toBe(0);
    const r = await compressProse(PROSE, "markdown", { compress: counting });
    expect(r.compressed).toBe(true);
    expect(r.text.length).toBeLessThan(PROSE.length);
  });
});

describe("read_compressed", () => {
  it("is gated on repo.compress, which a backing grants only with a compressor", () => {
    const registry = buildCoreToolRegistry();
    const names = (c: string[]) => registry.toolsForCapabilities(new Set(c) as never).map((t) => t.name);
    expect(names(["repo.read", "repo.semantic"])).not.toContain("read_compressed");
    expect(names(["repo.read", "repo.compress"])).toContain("read_compressed");
    const base = { search: async () => ({ ok: true }), repoMap: async () => ({ ok: true }) };
    expect(semanticCapabilitiesOf(undefined)).toEqual([]);
    expect(semanticCapabilitiesOf(base)).toEqual(["repo.semantic"]);
    expect(semanticCapabilitiesOf({ ...base, compress: halve })).toEqual(["repo.semantic", "repo.compress"]);
  });

  it("reads a long prose file compressed", async () => {
    const r = await readCompressedTool.execute({ path: "docs/billing.md" }, { caps: caps({ "docs/billing.md": PROSE }, { compress: halve }) });
    expect(r.data).toMatchObject({ ok: true, path: "docs/billing.md", compressed: true, originalTokens: 100, keptTokens: 50 });
    expect(String(r.data.content).length).toBeLessThan(PROSE.length);
  });

  it("refuses code files — an edit needs the exact bytes", async () => {
    const r = await readCompressedTool.execute({ path: "api/src/billing.ts" }, { caps: caps({ "api/src/billing.ts": PROSE }, { compress: halve }) });
    expect(r.data.ok).toBe(false);
    expect(String(r.data.error)).toContain("read_file");
  });

  it("is an error, not a silent original, when the compressor is gone", async () => {
    const r = await readCompressedTool.execute({ path: "docs/billing.md" }, { caps: caps({ "docs/billing.md": PROSE }) });
    expect(r.data.ok).toBe(false);
  });

  it("returns a short document as-is and says so", async () => {
    const r = await readCompressedTool.execute({ path: "README.md" }, { caps: caps({ "README.md": "# Hi\nShort." }, { compress: halve }) });
    expect(r.data).toMatchObject({ ok: true, compressed: false, content: "# Hi\nShort." });
  });
});
