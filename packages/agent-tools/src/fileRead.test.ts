import { describe, expect, it } from "vitest";
import type { CapabilityProvider, RepoReadResult } from "./capabilities.js";
import { MARKDOWN_OUTLINE_MIN_CHARS, READ_FILE_MAX_PATHS, readFileTool } from "./core-tools.js";
import { markdownOutline } from "./symbol-tools.js";
import { RunKnowledgeRecorder } from "./run-knowledge.js";

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
  };
}

const read = async (files: Record<string, string>, args: Record<string, unknown>) =>
  (await readFileTool.execute(args, { caps: provider(files) })).data as Record<string, unknown>;

/** Same as {@link read}, but with the host's B2 lever answer on the tool context. */
const readB2 = async (files: Record<string, string>, args: Record<string, unknown>, outlineFirstReads?: boolean) =>
  (await readFileTool.execute(args, { caps: provider(files), outlineFirstReads })).data as Record<string, unknown>;

/** A long PRD: three headed sections, each well past the read cap together. */
function longDoc(): string {
  const body = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} ${"x".repeat(80)}`).join("\n");
  return ["# PRD 35", "", body(100), "## 2. Why", "", body(100), "### 2.1 Part two", "", body(100)].join("\n");
}

describe("read_file paths[]", () => {
  it("returns one entry per path, each exactly the single-path result", async () => {
    const files = { "a.ts": "one\ntwo", "b.ts": "three" };
    const multi = await read(files, { paths: ["a.ts", "b.ts"] });
    expect(multi.ok).toBe(true);
    expect(multi.files).toEqual([await read(files, { path: "a.ts" }), await read(files, { path: "b.ts" })]);
  });

  it("applies offset/limit to each file, and keeps a missing file as its own failed entry", async () => {
    const files = { "a.ts": "1\n2\n3\n4", "b.ts": "5\n6\n7" };
    const multi = await read(files, { paths: ["a.ts", "gone.ts", "b.ts"], offset: 2, limit: 1 });
    const [a, gone, b] = multi.files as Array<Record<string, unknown>>;
    expect(a).toMatchObject({ ok: true, path: "a.ts", content: "2", offset: 2, truncated: true });
    expect(gone).toMatchObject({ ok: false });
    expect(b).toMatchObject({ ok: true, path: "b.ts", content: "6", offset: 2 });
  });

  it(`refuses more than ${READ_FILE_MAX_PATHS} paths, and a call with neither path nor paths`, async () => {
    const paths = Array.from({ length: READ_FILE_MAX_PATHS + 1 }, (_, i) => `f${i}.ts`);
    expect((await read({}, { paths })).ok).toBe(false);
    expect((await read({}, { paths: [] })).ok).toBe(false);
    expect((await read({}, {})).ok).toBe(false);
  });

  it("is recorded in the run's memory as a read of every file it names", () => {
    const log = new RunKnowledgeRecorder();
    log.record("read_file", { paths: ["a.ts", "b.ts"] });
    expect(log.activity.read).toEqual(expect.arrayContaining(["a.ts", "b.ts"]));
  });

  it("prefers path when both are given", async () => {
    const r = await read({ "a.ts": "x", "b.ts": "y" }, { path: "a.ts", paths: ["b.ts"] });
    expect(r.content).toBe("x");
    expect(r.files).toBeUndefined();
  });
});

describe("read_file on a large Markdown document", () => {
  it("returns the heading outline and a pointer to page by heading line", async () => {
    const doc = longDoc();
    expect(doc.length).toBeGreaterThan(MARKDOWN_OUTLINE_MIN_CHARS);
    const r = await read({ "docs/prd.md": doc }, { path: "docs/prd.md" });
    const outline = r.outline as Array<{ heading: string; line: number }>;
    expect(outline.map((h) => h.heading)).toEqual(["# PRD 35", "## 2. Why", "### 2.1 Part two"]);
    expect(outline[1]!.line).toBe(doc.split("\n").indexOf("## 2. Why") + 1);
    expect(String(r.note)).toMatch(/page by heading line with offset/);
    // The content is still the ordinary line window.
    expect(String(r.content).split("\n")[0]).toBe("# PRD 35");
    expect(outline).toEqual(markdownOutline("docs/prd.md", doc));
  });

  it("adds no outline to a small document, a paged read, or a non-Markdown file", async () => {
    const doc = longDoc();
    expect((await read({ "a.md": "# Small\n\ntext" }, { path: "a.md" })).outline).toBeUndefined();
    expect((await read({ "a.md": doc }, { path: "a.md", offset: 120 })).outline).toBeUndefined();
    expect((await read({ "a.ts": doc }, { path: "a.ts" })).outline).toBeUndefined();
  });

  it("outlines .mdx too, and inside a paths[] read", async () => {
    const r = await read({ "a.mdx": longDoc(), "b.ts": "x" }, { paths: ["a.mdx", "b.ts"] });
    const [mdx, ts] = r.files as Array<Record<string, unknown>>;
    expect(Array.isArray(mdx!.outline)).toBe(true);
    expect(ts!.outline).toBeUndefined();
  });
});

// B2 (PRD 45 §4.7): a first whole-file read of a large file answers with the definition
// outline + the first 40 lines when the host's `outlineFirstReads` lever answer is on
// (the VSIX `builderforce.agent.outlineFirstReads` setting, default true). Off/absent =
// the read behaves exactly as before. The lever rides on `ToolContext.outlineFirstReads`.
describe("read_file B2 outline-first reads", () => {
  // A code file over the 16K-char threshold, with enough lines to also clear the 300-line
  // clause — so BOTH thresholds are exercised. Uses `function` declarations so the symbol
  // extractor returns a definition outline.
  function bigCode(): string {
    const fns = Array.from(
      { length: 400 },
      (_, i) => `export function fn${i}(): number {\n  // ${"y".repeat(90)}\n  return ${i};\n}`,
    );
    return fns.join("\n");
  }

  it("a first whole-file read of a large file returns outline + first 40 lines when the lever is on", async () => {
    const code = bigCode();
    expect(code.length).toBeGreaterThan(16000);
    const r = await readB2({ "src/big.ts": code }, { path: "src/big.ts" }, true);
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.outline)).toBe(true);
    // The outline lists definitions with line numbers, one formatted line per symbol
    // (the same `L<line> <kind> <name>` shape `find_symbol` returns).
    expect(String((r.outline as string[])[0])).toMatch(/L\d+ function fn\d+/);
    // Only the 40-line prefix is returned, marked truncated, with a pointer to page.
    expect(String(r.content).split("\n").length).toBeLessThanOrEqual(40);
    expect(r.truncated).toBe(true);
    expect(String(r.note)).toMatch(/offset/);
  });

  it("a paged read or the lever off/absent behaves exactly as before (no B2 outline)", async () => {
    const code = bigCode();
    // Lever on but an explicit window: the read wants that window, not an outline.
    const paged = await readB2({ "src/big.ts": code }, { path: "src/big.ts", offset: 200, limit: 10 }, true);
    expect(paged.outline).toBeUndefined();
    expect(paged.offset).toBe(200);
    // Lever off: first whole-file read returns the ordinary line window.
    const off = await readB2({ "src/big.ts": code }, { path: "src/big.ts" }, false);
    expect(off.outline).toBeUndefined();
    // Lever absent (the host never set it): unchanged behavior.
    const absent = await read({ "src/big.ts": code }, { path: "src/big.ts" });
    expect(absent.outline).toBeUndefined();
  });

  it("applies inside a paths[] read, per file", async () => {
    const code = bigCode();
    const r = await readB2(
      { "src/big.ts": code, "src/small.ts": "export const x = 1;" },
      { paths: ["src/big.ts", "src/small.ts"] },
      true,
    );
    const [big, small] = r.files as Array<Record<string, unknown>>;
    expect(Array.isArray(big!.outline)).toBe(true);
    expect(small!.outline).toBeUndefined();
    expect(small!.content).toBe("export const x = 1;");
  });
});
