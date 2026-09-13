import { mkdtemp, mkdir, readFile, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceSymbolIndex } from "./node-symbols.js";

describe("WorkspaceSymbolIndex", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-symbols-"));
    await mkdir(join(root, "api", "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "dep"), { recursive: true });
    await writeFile(join(root, "api", "src", "git.ts"), "export function buildGitCommand() {}\nexport const GIT_TOOLS = [];\n");
    await writeFile(join(root, "api", "src", "other.ts"), "function buildGitHelper() {}\n");
    await writeFile(join(root, "node_modules", "dep", "index.ts"), "export function buildGitCommand() {}\n");
    await writeFile(join(root, "ROADMAP.md"), "# Roadmap\n## Consolidated Gap Register\n");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds definitions across the tree, exact names first, skipping dependencies", async () => {
    const index = new WorkspaceSymbolIndex(root);
    const r = await index.find("buildGitCommand");
    expect(r.ok).toBe(true);
    expect(r.matches?.map((m) => `${m.path}:${m.line}`)).toEqual(["api/src/git.ts:1"]);
    const prefix = await index.find("buildgit");
    expect(prefix.matches?.map((m) => m.name)).toEqual(["buildGitCommand", "buildGitHelper"]);
    expect(prefix.indexedFiles).toBe(3);
  });

  it("scopes, filters by kind, and finds Markdown sections", async () => {
    const index = new WorkspaceSymbolIndex(root);
    expect((await index.find("GIT", { kind: "const" })).matches?.map((m) => m.name)).toEqual(["GIT_TOOLS"]);
    expect((await index.find("build", { scope: "./api/src/" })).total).toBe(2);
    expect((await index.find("build", { scope: "frontend" })).total).toBe(0);
    expect((await index.find("Gap Register")).matches?.[0]).toMatchObject({ path: "ROADMAP.md", line: 2, kind: "heading" });
  });

  it("re-parses a file marked dirty, and drops a deleted one", async () => {
    const index = new WorkspaceSymbolIndex(root, { fullRefreshMs: 60 * 60_000 });
    await index.find("x");
    const file = join(root, "api", "src", "other.ts");
    await writeFile(file, "export class FreshlyAdded {}\n");
    // Pin a new mtime so the change is visible even on a coarse-resolution filesystem.
    await utimes(file, new Date(), new Date(Date.now() + 5_000));
    index.markDirty(file);
    expect((await index.find("FreshlyAdded")).total).toBe(1);
    await rm(file);
    index.markDirty(file);
    expect((await index.find("FreshlyAdded")).total).toBe(0);
  });

  it("persists a snapshot and restores it on the next start", async () => {
    const cachePath = join(root, ".builderforce", "symbols.json");
    const first = new WorkspaceSymbolIndex(root, { cachePath });
    await first.find("buildGitCommand");
    // Allow the fire-and-forget snapshot write to land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const snapshot = JSON.parse(await readFile(cachePath, "utf-8")) as { v: number; files: unknown[] };
    expect(snapshot.v).toBe(1);
    expect(snapshot.files.length).toBe(3);
    const second = new WorkspaceSymbolIndex(root, { cachePath });
    expect((await second.find("GIT_TOOLS")).total).toBe(1);
  });

  it("reports a partial index when the file cap is reached", async () => {
    const index = new WorkspaceSymbolIndex(root, { maxFiles: 1 });
    expect((await index.find("anything")).partialIndex).toBe(true);
  });

  it("lists files under a scope with their symbols, for digests", async () => {
    const index = new WorkspaceSymbolIndex(root);
    const files = await index.filesUnder("api");
    expect(files.map((f) => f.path).sort()).toEqual(["api/src/git.ts", "api/src/other.ts"]);
  });
});
