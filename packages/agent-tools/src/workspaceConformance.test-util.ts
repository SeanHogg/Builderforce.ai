/**
 * workspaceConformance.test-util.ts - THE conformance suite for a {@link WorkspaceFs} adapter.
 *
 * Every adapter under the one shared provider (memory, node disk, the sandbox bridge, the cloud R2
 * workspace, a git remote) is driven through `createRepoCapabilities` with the SAME cases, so "the
 * same call answers the same way on every host" is a test, not a claim. The cases are the ones
 * `workspace.test.ts` and agent-runtime `cross-provider-smoke.test.ts` pin, run over any adapter.
 *
 * Where a remote adapter legitimately differs from a disk one, the difference is a named option
 * ({@link WorkspaceConformanceOptions}); the shared cases are never weakened.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepoCapabilities, type RepoCapabilityOptions, type WorkspaceFs } from "./workspace.js";

/** One adapter instance under test, plus the one thing a test needs beyond the port: a way to seed it. */
export interface ConformanceHarness {
  fs: WorkspaceFs;
  /** Put `files` (root-relative POSIX path to text) into the adapter's backing store. */
  seed(files: Record<string, string>): Promise<void>;
  cleanup?(): Promise<void>;
}

export interface WorkspaceConformanceOptions {
  /** What listing a directory that does not exist answers. Default `not_found` (`{ ok: false, code: "not_found" }`); a remote with no directory objects answers `empty`. */
  missingDirListing?: "not_found" | "empty";
  /** Whether the adapter has a searcher at all (the sandbox has none and does not advertise `repo.search`). Default true. */
  search?: boolean;
  /** Whether search matches carry a 1-based `line`. Default true; a remote code search without line numbers sets false. */
  searchLineNumbers?: boolean;
  /** Extra provider options (a `dirFilter`, ...). */
  capabilityOptions?: RepoCapabilityOptions;
}

/** Register the conformance cases for the adapter `makeFs` builds (a fresh one per case). */
export function runWorkspaceConformance(
  name: string,
  makeFs: () => Promise<ConformanceHarness>,
  opts: WorkspaceConformanceOptions = {},
): void {
  describe(`workspace conformance - ${name}`, () => {
    let harness: ConformanceHarness;

    beforeEach(async () => {
      harness = await makeFs();
    });
    afterEach(async () => {
      await harness.cleanup?.();
    });

    const caps = () => createRepoCapabilities(harness.fs, opts.capabilityOptions ?? {});

    it("agrees on a write -> list -> read -> edit -> delete lifecycle", async () => {
      const { repoRead, repoWrite } = caps();
      expect(await repoWrite.writeFile("src/a.ts", "const v = 1;\n")).toEqual({ ok: true, change: "created" });
      expect((await repoRead.listFiles()).paths).toContain("src/a.ts");
      expect(await repoRead.readFile("src/a.ts")).toEqual({ ok: true, path: "src/a.ts", content: "const v = 1;\n" });
      const edit = await repoWrite.editFile("src/a.ts", "const v = 1;", "const v = 2;");
      expect(edit).toMatchObject({ ok: true, change: "modified" });
      expect((await repoRead.readFile("src/a.ts")).content).toBe("const v = 2;\n");
      expect(await repoWrite.deleteFile("src/a.ts")).toEqual({ ok: true, deleted: true });
      expect((await repoRead.readFile("src/a.ts")).code).toBe("not_found");
    });

    it("re-writing an existing path is modified", async () => {
      const { repoRead, repoWrite } = caps();
      expect(await repoWrite.writeFile("a.txt", "one")).toEqual({ ok: true, change: "created" });
      expect(await repoWrite.writeFile("a.txt", "two")).toEqual({ ok: true, change: "modified" });
      expect((await repoRead.readFile("a.txt")).content).toBe("two");
    });

    it("reading a missing file FAILS (not empty) with code not_found", async () => {
      const r = await caps().repoRead.readFile("nope.ts");
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not found/i);
      expect(r.code).toBe("not_found");
    });

    it("editing a missing file FAILS with not_found", async () => {
      expect(await caps().repoWrite.editFile("nope.ts", "a", "b")).toMatchObject({ ok: false, code: "not_found" });
    });

    it("rejects a non-unique edit unless replaceAll, and a no-match edit", async () => {
      await harness.seed({ "d.txt": "x\nx\n" });
      const { repoRead, repoWrite } = caps();
      const nonUnique = await repoWrite.editFile("d.txt", "x", "y");
      expect(nonUnique.ok).toBe(false);
      expect(nonUnique.error).toMatch(/not unique/i);
      expect(nonUnique.code).toBe("ambiguous");
      expect((await repoRead.readFile("d.txt")).content).toBe("x\nx\n");

      const all = await repoWrite.editFile("d.txt", "x", "y", true);
      expect(all).toMatchObject({ ok: true, change: "modified", replaced: 2 });
      expect((await repoRead.readFile("d.txt")).content).toBe("y\ny\n");

      const missing = await repoWrite.editFile("d.txt", "nope", "z", false);
      expect(missing.ok).toBe(false);
      expect(missing.code).toBe("no_match");
    });

    it("deleting a missing path is a benign no-op, not an error", async () => {
      const r = await caps().repoWrite.deleteFile("ghost.ts");
      expect(r.ok).toBe(true);
      expect(r.deleted).toBe(false);
    });

    it("refuses a workspace escape on every tool with code outside_root", async () => {
      const { repoRead, repoWrite } = caps();
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

    it("filters list_files by glob", async () => {
      await harness.seed({ "src/a.ts": "x", "src/b.js": "x", "docs/c.md": "x" });
      expect((await caps().repoRead.listFiles(undefined, "src/**/*.ts")).paths).toEqual(["src/a.ts"]);
    });

    it("scopes a listing to a subdirectory", async () => {
      await harness.seed({ "src/a.ts": "x", "src/b.js": "x", "docs/c.md": "x" });
      expect((await caps().repoRead.listFiles("src")).paths).toEqual(["src/a.ts", "src/b.js"]);
    });

    it("an LF edit matches a CRLF file and keeps its line endings; a rewrite keeps them too", async () => {
      await harness.seed({ "w.txt": "a\r\nb\r\n" });
      const { repoRead, repoWrite } = caps();
      expect((await repoWrite.editFile("w.txt", "a\nb", "a\nc")).ok).toBe(true);
      expect((await repoRead.readFile("w.txt")).content).toBe("a\r\nc\r\n");
      await repoWrite.writeFile("w.txt", "x\ny\n");
      expect((await repoRead.readFile("w.txt")).content).toBe("x\r\ny\r\n");
    });

    it("lists config dot-dirs and hides other dot-dirs and dependency folders", async () => {
      await harness.seed({
        ".secret/x.txt": "x",
        ".github/workflows/ci.yml": "x",
        ".vscode/settings.json": "{}",
        "node_modules/dep/index.js": "x",
        "a.ts": "x",
      });
      const paths = (await caps().repoRead.listFiles()).paths ?? [];
      expect(paths).toContain("a.ts");
      expect(paths).toContain(".github/workflows/ci.yml");
      expect(paths).toContain(".vscode/settings.json");
      expect(paths.some((p) => p.startsWith(".secret"))).toBe(false);
      expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    });

    if (opts.missingDirListing === "empty") {
      it("listing a directory that does not exist is an empty listing (remote: no directory objects)", async () => {
        await harness.seed({ "src/a.ts": "x" });
        const r = await caps().repoRead.listFiles("nope");
        expect(r.ok).toBe(true);
        expect(r.paths ?? []).toEqual([]);
      });
    } else {
      it("listing a directory that does not exist fails with code not_found", async () => {
        await harness.seed({ "src/a.ts": "x" });
        expect(await caps().repoRead.listFiles("nope")).toMatchObject({ ok: false, code: "not_found" });
      });
    }

    if (opts.search !== false) {
      it("search returns the exact match only, scoped by path", async () => {
        await harness.seed({
          "src/exact.ts": "export const a = 1;\nconst x = computeInvoiceTotal(items);\n",
          "src/near.ts": "// invoice total helpers\nexport function invoiceTotalHelper() {}\n",
          "other/exact.ts": "const y = computeInvoiceTotal(items);\n",
        });
        const { repoRead } = caps();
        const all = await repoRead.searchCode("computeInvoiceTotal");
        expect(all.ok).toBe(true);
        expect((all.matches ?? []).map((m) => m.path)).toEqual(["other/exact.ts", "src/exact.ts"]);
        const scoped = await repoRead.searchCode("computeInvoiceTotal", "src");
        expect((scoped.matches ?? []).map((m) => m.path)).toEqual(["src/exact.ts"]);
        if (opts.searchLineNumbers !== false) expect(scoped.matches?.[0]?.line).toBe(2);
      });
    }
  });
}
