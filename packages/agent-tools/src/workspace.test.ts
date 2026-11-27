import { describe, expect, it } from "vitest";
import { createRepoCapabilities } from "./workspace.js";
import { memoryWorkspaceFs } from "./memoryWorkspaceFs.js";

/** Cases ported from agent-runtime `cross-provider-smoke.test.ts` and `node-capability-provider.test.ts`, run over the shared provider. */
function fresh(files: Record<string, string> = {}, onWrite?: (p: string) => void) {
  const fs = memoryWorkspaceFs(files);
  return { fs, ...createRepoCapabilities(fs, onWrite ? { onWrite } : {}) };
}

describe("createRepoCapabilities - write / read / list / edit / delete", () => {
  it("writes a new file (created) then overwrites it (modified)", async () => {
    const { repoWrite, fs } = fresh();
    expect(await repoWrite.writeFile("src/feature.ts", "export const a = 1;\n")).toEqual({ ok: true, change: "created" });
    expect(fs.files.get("src/feature.ts")).toBe("export const a = 1;\n");
    expect(await repoWrite.writeFile("src/feature.ts", "export const a = 2;\n")).toEqual({ ok: true, change: "modified" });
  });

  it("reads a file and lists the tree (ignoring node_modules/.git)", async () => {
    const { repoRead, repoWrite } = fresh({ "ignored.txt": "x" });
    await repoWrite.writeFile("a.ts", "alpha");
    await repoWrite.writeFile("sub/b.ts", "beta");
    await repoWrite.writeFile("node_modules/dep/index.js", "skip");
    await repoWrite.writeFile(".git/config", "skip");

    expect(await repoRead.readFile("sub/b.ts")).toEqual({ ok: true, path: "sub/b.ts", content: "beta" });
    const list = await repoRead.listFiles();
    expect(list.ok).toBe(true);
    expect(list.paths).toContain("a.ts");
    expect(list.paths).toContain("sub/b.ts");
    expect(list.paths).toContain("ignored.txt");
    expect(list.paths?.some((p) => p.includes("node_modules") || p.includes(".git/"))).toBe(false);
  });

  it("agrees on a write -> list -> read -> edit -> delete lifecycle", async () => {
    const { repoRead, repoWrite } = fresh();
    expect((await repoWrite.writeFile("src/a.ts", "const v = 1;\n")).ok).toBe(true);
    expect((await repoRead.listFiles()).paths).toContain("src/a.ts");
    expect((await repoRead.readFile("src/a.ts")).content).toBe("const v = 1;\n");
    const edit = await repoWrite.editFile("src/a.ts", "const v = 1;", "const v = 2;");
    expect(edit.ok).toBe(true);
    expect((await repoRead.readFile("src/a.ts")).content).toBe("const v = 2;\n");
    expect(await repoWrite.deleteFile("src/a.ts")).toEqual({ ok: true, deleted: true });
  });

  it("re-writing an existing path succeeds", async () => {
    const { repoWrite } = fresh();
    await repoWrite.writeFile("a.txt", "one");
    expect((await repoWrite.writeFile("a.txt", "two")).ok).toBe(true);
  });

  it("reading a missing file FAILS (not empty) with code not_found", async () => {
    const { repoRead } = fresh();
    const r = await repoRead.readFile("nope.ts");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
    expect(r.code).toBe("not_found");
  });

  it("reading a directory fails with the use-list_files text and code is_directory", async () => {
    const { repoRead } = fresh({ "src/a.ts": "x" });
    const r = await repoRead.readFile("src");
    expect(r).toMatchObject({ ok: false, code: "is_directory" });
    expect(r.error).toContain("path is a directory, not a file");
    expect(r.error).toContain("list_files");
  });

  it("marks an oversized read truncated instead of failing", async () => {
    const fs = memoryWorkspaceFs({ "big.txt": "abcdefghij" });
    const { repoRead } = createRepoCapabilities(fs, { maxReadBytes: 4 });
    expect(await repoRead.readFile("big.txt")).toEqual({ ok: true, path: "big.txt", content: "abcd", truncated: true });
  });

  it("editing a missing file FAILS with not_found", async () => {
    const { repoWrite } = fresh();
    const r = await repoWrite.editFile("nope.ts", "a", "b");
    expect(r).toMatchObject({ ok: false, code: "not_found" });
  });

  it("edits with an exact unique match; rejects a non-unique edit unless replaceAll", async () => {
    const { repoWrite, fs } = fresh({ "f.ts": "const x = 1;\nconst y = 1;\n" });
    const nonUnique = await repoWrite.editFile("f.ts", "= 1;", "= 9;", false);
    expect(nonUnique.ok).toBe(false);
    expect(nonUnique.error).toMatch(/not unique/);
    expect(nonUnique.code).toBe("ambiguous");

    const all = await repoWrite.editFile("f.ts", "= 1;", "= 9;", true);
    expect(all).toMatchObject({ ok: true, change: "modified", replaced: 2 });
    expect(fs.files.get("f.ts")).toBe("const x = 9;\nconst y = 9;\n");

    const missing = await repoWrite.editFile("f.ts", "nope", "x", false);
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/not found/);
    expect(missing.code).toBe("no_match");
  });

  it("an LF edit matches a CRLF file and keeps its line endings; a rewrite keeps them too", async () => {
    const { repoWrite, fs } = fresh({ "w.txt": "a\r\nb\r\n" });
    expect((await repoWrite.editFile("w.txt", "a\nb", "a\nc")).ok).toBe(true);
    expect(fs.files.get("w.txt")).toBe("a\r\nc\r\n");
    await repoWrite.writeFile("w.txt", "x\ny\n");
    expect(fs.files.get("w.txt")).toBe("x\r\ny\r\n");
  });

  it("deleting a missing path is a benign no-op, not an error", async () => {
    const { repoWrite } = fresh();
    const r = await repoWrite.deleteFile("ghost.ts");
    expect(r.ok).toBe(true);
    expect(r.deleted).toBe(false);
  });

  it("refuses a workspace escape on every tool with code outside_root", async () => {
    const { repoRead, repoWrite } = fresh();
    const results = [
      await repoWrite.writeFile("../escape.ts", "nope"),
      await repoWrite.editFile("../escape.txt", "a", "b"),
      await repoWrite.deleteFile("../escape.txt"),
      await repoRead.readFile("../../etc/passwd"),
      await repoRead.readFile("/etc/passwd"),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/outside the workspace/);
      expect(r.code).toBe("outside_root");
    }
  });

  it("calls onWrite for a landed write, edit and delete only", async () => {
    const seen: string[] = [];
    const { repoWrite } = fresh({}, (p) => seen.push(p));
    await repoWrite.writeFile("a.txt", "x");
    await repoWrite.editFile("a.txt", "x", "y");
    await repoWrite.deleteFile("a.txt");
    await repoWrite.deleteFile("a.txt");
    await repoWrite.editFile("a.txt", "x", "y");
    expect(seen).toEqual(["a.txt", "a.txt", "a.txt"]);
  });
});

describe("createRepoCapabilities - listFiles", () => {
  const TREE = { "src/a.ts": "x", "src/b.js": "x", "docs/c.md": "x", "README.md": "x" };

  it("agrees on glob filtering in list_files", async () => {
    const { repoRead } = fresh(TREE);
    expect((await repoRead.listFiles(undefined, "src/**/*.ts")).paths).toEqual(["src/a.ts"]);
  });

  it("scopes to a subdirectory", async () => {
    const { repoRead } = fresh(TREE);
    expect((await repoRead.listFiles("src")).paths).toEqual(["src/a.ts", "src/b.js"]);
  });

  it("hides dot-dirs except the config ones", async () => {
    const { repoRead } = fresh({ ".secret/x.txt": "x", ".github/workflows/ci.yml": "x", ".vscode/settings.json": "x", "a.ts": "x" });
    const paths = (await repoRead.listFiles()).paths ?? [];
    expect(paths).toContain(".github/workflows/ci.yml");
    expect(paths).toContain(".vscode/settings.json");
    expect(paths.some((p) => p.startsWith(".secret"))).toBe(false);
  });

  it("collapses a big unscoped listing to a directory summary, but a glob returns every match", async () => {
    const files: Record<string, string> = { "ROADMAP.md": "x" };
    for (let i = 0; i < 450; i++) files[`pkg/mod${i % 3}/f${i}.ts`] = "x";
    const { repoRead } = fresh(files);
    const summary = await repoRead.listFiles();
    expect(summary.truncated).toBe(true);
    expect(summary.paths).toContain("ROADMAP.md");
    expect(summary.paths).toContain("pkg/mod0/");
    expect(summary.paths?.length).toBeLessThan(20);
    const globbed = await repoRead.listFiles(undefined, "*.ts");
    expect(globbed.paths).toHaveLength(450);
    const everything = await repoRead.listFiles(undefined, undefined, { unbounded: true });
    expect(everything.paths).toHaveLength(451);
  });

  it("fails with a code for a directory that does not exist", async () => {
    const { repoRead } = fresh(TREE);
    expect(await repoRead.listFiles("nope")).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("createRepoCapabilities - searchCode", () => {
  const FILES = {
    "src/exact.ts": "export const a = 1;\nconst x = computeInvoiceTotal(items);\n",
    "src/near.ts": "// invoice total helpers\nexport function invoiceTotalHelper() {}\n",
    "other/exact.ts": "const y = computeInvoiceTotal(items);\n",
  };

  it("regression: returns the exact match only (not keyword-ranked hits) and applies path scope before searching", async () => {
    const { repoRead } = fresh(FILES);
    const all = await repoRead.searchCode("computeInvoiceTotal");
    expect(all.ok).toBe(true);
    expect((all.matches ?? []).map((m) => m.path)).toEqual(["other/exact.ts", "src/exact.ts"]);

    const scoped = await repoRead.searchCode("computeInvoiceTotal", "src");
    expect((scoped.matches ?? []).map((m) => m.path)).toEqual(["src/exact.ts"]);
    expect(scoped.matches?.[0]?.line).toBe(2);

    const none = await repoRead.searchCode("computeInvoiceTotal", "src/near.ts");
    expect(none.total).toBe(0);
  });

  it("prefers the host's native searcher when it has one", async () => {
    const fs = { ...memoryWorkspaceFs(FILES), search: async () => [{ path: "z.ts", text: "frag" }, { path: "a.ts", line: 3, text: "hit" }] };
    const { repoRead } = createRepoCapabilities(fs);
    const r = await repoRead.searchCode("anything");
    expect(r.matches?.map((m) => m.path)).toEqual(["a.ts", "z.ts"]);
    expect(r.total).toBe(2);
  });

  it("refuses a scope outside the workspace", async () => {
    const { repoRead } = fresh(FILES);
    expect(await repoRead.searchCode("x", "../..")).toMatchObject({ ok: false, code: "outside_root" });
  });
});
