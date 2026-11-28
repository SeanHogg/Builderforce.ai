import { describe, expect, it } from "vitest";
import { SEARCH_MAX_MATCHES } from "@builderforce/tool-output-policy";
import { compileSearchPattern, findLiteralMatches, isValidRegex, MATCH_TEXT_MAX, scanFiles, smartCaseSensitive } from "./text-scan.js";
import { memoryWorkspaceFs } from "./memoryWorkspaceFs.js";

describe("pattern helpers", () => {
  it("smart case: an upper-case letter is case-sensitive, a regex escape is not a letter", () => {
    expect(smartCaseSensitive("BfBrainChat")).toBe(true);
    expect(smartCaseSensitive("brain chat")).toBe(false);
    expect(smartCaseSensitive("\\Sfoo\\W")).toBe(false);
  });

  it("an invalid regex is searched literally instead of refused", () => {
    expect(isValidRegex("foo(bar")).toBe(false);
    expect(compileSearchPattern("foo(bar").test("call foo(bar) now")).toBe(true);
    expect(compileSearchPattern("a[0").test("x a[0 y")).toBe(true);
    expect(compileSearchPattern("?task=").test("/x?task=1")).toBe(true);
  });

  it("uses regex syntax when the query is a valid pattern", () => {
    expect(compileSearchPattern("a[0]").test("a0")).toBe(true);
    expect(compileSearchPattern("a[0]").test("a[0]")).toBe(false);
  });
});

describe("scanFiles", () => {
  const FILES = {
    "src/exact.ts": "export const a = 1;\nconst x = computeInvoiceTotal(items);\n",
    "src/near.ts": "// invoice total helpers\nexport function invoiceTotalHelper() {}\n",
    "other/exact.ts": "const y = computeInvoiceTotal(items);\n",
  };

  it("finds the exact match only, sorted by path then line, and applies scope before searching", async () => {
    const fs = memoryWorkspaceFs(FILES);
    const all = await scanFiles(fs, "computeInvoiceTotal", "");
    expect(all.ok).toBe(true);
    expect((all.matches ?? []).map((m) => m.path)).toEqual(["other/exact.ts", "src/exact.ts"]);
    const scoped = await scanFiles(fs, "computeInvoiceTotal", "src");
    expect((scoped.matches ?? []).map((m) => [m.path, m.line])).toEqual([["src/exact.ts", 2]]);
  });

  it("a file scope searches that file; a file without the term is total 0, not absent", async () => {
    const fs = memoryWorkspaceFs(FILES);
    expect((await scanFiles(fs, "computeInvoiceTotal", "src/exact.ts")).total).toBe(1);
    const none = await scanFiles(fs, "computeInvoiceTotal", "src/near.ts");
    expect(none).toMatchObject({ ok: true, total: 0, truncated: false });
  });

  it("a scope that does not exist fails with not_found", async () => {
    expect(await scanFiles(memoryWorkspaceFs(FILES), "x", "nope")).toMatchObject({ ok: false, code: "not_found" });
  });

  it("smart case: lower-case matches both spellings, mixed case only its own", async () => {
    const fs = memoryWorkspaceFs({ "a.txt": "BfBrainChat\nbfbrainchat\n" });
    expect((await scanFiles(fs, "bfbrainchat", "")).total).toBe(2);
    expect((await scanFiles(fs, "BfBrainChat", "")).total).toBe(1);
  });

  it("skips binary files, oversized files and skipped directories", async () => {
    const fs = memoryWorkspaceFs({
      "bin.dat": "needle\0needle",
      "big.txt": `needle ${"x".repeat(100)}`,
      "node_modules/dep/index.js": "needle",
      ".hidden/a.txt": "needle",
      "ok.txt": "needle",
    });
    const r = await scanFiles(fs, "needle", "", { maxFileBytes: 50 });
    expect((r.matches ?? []).map((m) => m.path)).toEqual(["ok.txt"]);
  });

  it("truncates the match text to the shared width and trims it", async () => {
    const fs = memoryWorkspaceFs({ "a.txt": `   needle ${"y".repeat(500)}` });
    const m = (await scanFiles(fs, "needle", "")).matches?.[0];
    expect(String(m?.text)).toHaveLength(MATCH_TEXT_MAX);
    expect(String(m?.text).startsWith("needle")).toBe(true);
  });

  it("caps matches at SEARCH_MAX_MATCHES and reports truncated", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < SEARCH_MAX_MATCHES + 20; i++) files[`f${String(i).padStart(3, "0")}.txt`] = "needle";
    const r = await scanFiles(memoryWorkspaceFs(files), "needle", "");
    expect(r.total).toBe(SEARCH_MAX_MATCHES);
    expect(r.truncated).toBe(true);
  });

  it("a capped scan with no matches is truncated, never absent", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`f${i}.txt`] = "nothing";
    const r = await scanFiles(memoryWorkspaceFs(files), "needle", "", { maxFiles: 5 });
    expect(r).toMatchObject({ ok: true, total: 0, truncated: true });
  });

  it("concurrency reads files in parallel, keeps the same results and the same file budget", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`f${String(i).padStart(2, "0")}.txt`] = i % 2 === 0 ? "needle" : "nothing";
    const inner = memoryWorkspaceFs(files);
    let inFlight = 0;
    let peak = 0;
    const fs = {
      ...inner,
      async read(path: string, o: { maxBytes: number }) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        try { return await inner.read(path, o); } finally { inFlight--; }
      },
    };
    const sequential = await scanFiles(inner, "needle", "");
    const parallel = await scanFiles(fs, "needle", "", { concurrency: 8 });
    expect(parallel.matches).toEqual(sequential.matches);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    // The file budget is exact: 6 files read, however wide the batch.
    const capped = await scanFiles(inner, "needle", "", { concurrency: 8, maxFiles: 6 });
    expect(capped).toMatchObject({ ok: true, total: 3, truncated: true });
  });

  it("stops when the signal is already aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(await scanFiles(memoryWorkspaceFs(FILES), "x", "", { signal: ctl.signal })).toMatchObject({ ok: false, error: "search stopped" });
  });
});

describe("findLiteralMatches", () => {
  const TEXT = "Foo bar foo\r\nnothing\nxfOOx";

  it("is case-insensitive and reports 1-based line and column of every occurrence", () => {
    expect(findLiteralMatches(TEXT, "FOO")).toEqual([
      { line: 1, column: 1, lineText: "Foo bar foo" },
      { line: 1, column: 9, lineText: "Foo bar foo" },
      { line: 3, column: 2, lineText: "xfOOx" },
    ]);
  });

  it("reports only the first occurrence per line on request", () => {
    expect(findLiteralMatches(TEXT, "foo", { everyOccurrence: false }).map((m) => [m.line, m.column])).toEqual([[1, 1], [3, 2]]);
  });

  it("stops at the limit, mid-line included", () => {
    expect(findLiteralMatches(TEXT, "foo", { limit: 2 }).map((m) => [m.line, m.column])).toEqual([[1, 1], [1, 9]]);
    expect(findLiteralMatches(TEXT, "foo", { limit: 0 })).toEqual([]);
  });

  it("treats the query as text, not a regex, and an empty query matches nothing", () => {
    expect(findLiteralMatches("a.c abc a(b", "a.c")).toHaveLength(1);
    expect(findLiteralMatches("call a(b)", "a(b")).toHaveLength(1);
    expect(findLiteralMatches(TEXT, "")).toEqual([]);
  });
});
