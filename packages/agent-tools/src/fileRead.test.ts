import { describe, expect, it } from "vitest";
import type { CapabilityProvider, RepoReadResult } from "./capabilities.js";
import { MARKDOWN_OUTLINE_MIN_CHARS, READ_FILE_MAX_PATHS, readFileTool } from "./core-tools.js";
import { markdownOutline } from "./symbol-tools.js";
import { RunKnowledgeRecorder } from "./run-knowledge.js";
import { WHOLE_READ_MAX_CHARS, WIDEN_WINDOW_MIN_LINES } from "./fileRead.js";

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
  // A code file too large to return whole (over WHOLE_READ_MAX_CHARS, 64K chars) — only
  // such a file is outlined first. Uses `function` declarations so the symbol extractor
  // returns a definition outline.
  function bigCode(): string {
    const fns = Array.from(
      { length: 700 },
      (_, i) => `export function fn${i}(): number {\n  // ${"y".repeat(90)}\n  return ${i};\n}`,
    );
    return fns.join("\n");
  }

  it("a first whole-file read of a large file returns outline + first 40 lines when the lever is on", async () => {
    const code = bigCode();
    expect(code.length).toBeGreaterThan(WHOLE_READ_MAX_CHARS);
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

describe("read_file runs a window of a file that fits in one read from its offset to the end of the file", () => {
  // ~520 lines, ~25 KB: the shape of shipGates.ts in chat #133542.
  const midFile = Array.from({ length: 520 }, (_, i) => `const line${i} = "${"z".repeat(40)}";`).join("\n");

  it("regression: chat #133542 — a first read of a 520-line file is not outlined, it returns every line", async () => {
    expect(midFile.length).toBeLessThan(WHOLE_READ_MAX_CHARS);
    const r = await readB2({ "src/mid.ts": midFile }, { path: "src/mid.ts" }, true);
    expect(r.outline).toBeUndefined();
    expect(r.truncated).toBe(false);
    expect(r.totalLines).toBe(520);
    expect(String(r.content).split("\n").length).toBe(520);
  });

  it("regression: chat #133542 — a small window of a file that fits drops its limit and runs from its offset to EOF", async () => {
    const r = await read({ "src/mid.ts": midFile }, { path: "src/mid.ts", offset: 180, limit: 180 });
    expect(r.offset).toBe(180);
    expect(r.truncated).toBe(false);
    const lines = String(r.content).split("\n");
    expect(lines.length).toBe(341);
    expect(lines[0]).toBe(midFile.split("\n")[179]);
    expect(lines[lines.length - 1]).toBe(midFile.split("\n")[519]);
    expect(String(r.note)).toMatch(/end of the file/);
    expect(String(r.note)).not.toMatch(/whole file/);
  });

  // ~506 lines, ~38 KB: the shape of docs/specs/47-prd-collection-view.md in chat #149169.
  const prdDoc = (() => {
    const out: string[] = [];
    for (let i = 1; i <= 506; i++) out.push(i % 50 === 1 ? `## Section ${i}` : `Line ${i} ${"p".repeat(66)}`);
    return out.join("\n");
  })();

  it("regression: chat #149169 — a window of a doc that fits keeps its requested offset", async () => {
    expect(prdDoc.length).toBeGreaterThan(36_000);
    expect(prdDoc.length).toBeLessThan(WHOLE_READ_MAX_CHARS);
    const r = await read({ "docs/prd.md": prdDoc }, { path: "docs/prd.md", offset: 181, limit: 180 });
    expect(r.offset).toBe(181);
    const lines = String(r.content).split("\n");
    expect(lines[0]).toBe(prdDoc.split("\n")[180]);
    expect(lines.length).toBe(506 - 180);
    expect(r.truncated).toBe(false);
  });

  it("regression: chat #149169 — a first read of a large Markdown doc with only a limit still gets its outline", async () => {
    const r = await read({ "docs/prd.md": prdDoc }, { path: "docs/prd.md", limit: 260 });
    expect(r.offset).toBe(1);
    expect(r.totalLines).toBe(506);
    expect(String(r.content).split("\n").length).toBe(506);
    expect(Array.isArray(r.outline)).toBe(true);
    expect((r.outline as unknown[]).length).toBeGreaterThan(0);
    // It returned the whole doc, so the note must not also call it "larger than one read".
    expect(String(r.note)).toMatch(/end of the file/);
    expect(String(r.note)).not.toMatch(/larger than one read/);
  });

  it("does not claim it extended a window that already reached EOF, or one past EOF", async () => {
    const tail = await read({ "docs/prd.md": prdDoc }, { path: "docs/prd.md", offset: 400, limit: 180 });
    expect(tail.offset).toBe(400);
    expect(String(tail.content).split("\n").length).toBe(107);
    expect(tail.truncated).toBe(false);
    expect(tail.note).toBeUndefined();

    const past = await read({ "docs/prd.md": prdDoc }, { path: "docs/prd.md", offset: 600, limit: 180 });
    expect(past.content).toBe("");
    expect(past.truncated).toBe(false);
    expect(past.note).toBeUndefined();
  });

  it("dropping the limit never shrinks a window below the requested limit (many short lines)", async () => {
    const shortLines = Array.from({ length: 3000 }, (_, i) => `l${i}`).join("\n");
    expect(shortLines.length).toBeLessThan(WHOLE_READ_MAX_CHARS);
    const r = await read({ "a.txt": shortLines }, { path: "a.txt", offset: 1, limit: 3000 });
    expect(r.offset).toBe(1);
    expect(String(r.content).split("\n").length).toBe(3000);
    expect(r.truncated).toBe(false);

    const mid = await read({ "a.txt": shortLines }, { path: "a.txt", offset: 500, limit: 10 });
    expect(mid.offset).toBe(500);
    expect(String(mid.content).split("\n").length).toBe(2501);
    expect(mid.truncated).toBe(false);
  });

  it("a short file's explicit window is served as asked", async () => {
    const short = Array.from({ length: WIDEN_WINDOW_MIN_LINES - 1 }, (_, i) => `l${i}`).join("\n");
    const r = await read({ "a.ts": short }, { path: "a.ts", offset: 10, limit: 5 });
    expect(r.offset).toBe(10);
    expect(String(r.content).split("\n").length).toBe(5);
  });

  it("never tells the model to read with a small limit", async () => {
    const big = Array.from({ length: 700 }, (_, i) => `export function fn${i}(): number {\n  // ${"y".repeat(90)}\n  return ${i};\n}`).join("\n");
    const r = await readB2({ "src/big.ts": big }, { path: "src/big.ts" }, true);
    expect(String(r.note)).not.toMatch(/small/);
  });
});
