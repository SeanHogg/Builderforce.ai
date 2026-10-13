import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitIgnoredMatcher, gitIgnoredSubset } from "./node-git-ignore.js";
import { WorkspaceSymbolIndex } from "./node-symbols.js";

describe("node-git-ignore", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-gitignore-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    await mkdir(join(root, "docs", "private", "deck"), { recursive: true });
    await mkdir(join(root, "docs", "specs"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "*.local.md\ndocs/private/\n");
    await writeFile(join(root, "SECURITY-FINDINGS.local.md"), "# Findings\n## C1 — secret hole\n");
    await writeFile(join(root, "docs", "private", "deck", "competitors.md"), "# Competitive quadrant\n");
    await writeFile(join(root, "docs", "specs", "01-prd.md"), "# Public PRD\n");
    await writeFile(join(root, "ROADMAP.md"), "# Roadmap\n");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("matches ignored files and everything beneath an ignored directory", async () => {
    const isIgnored = await gitIgnoredMatcher(root);
    expect(isIgnored("SECURITY-FINDINGS.local.md")).toBe(true);
    expect(isIgnored("docs/private")).toBe(true);
    expect(isIgnored("docs/private/deck/competitors.md")).toBe(true);
    expect(isIgnored("docs/specs/01-prd.md")).toBe(false);
    expect(isIgnored("docs")).toBe(false);
    expect(isIgnored("ROADMAP.md")).toBe(false);
  });

  it("answers for a batch, including a file created after the last full walk", async () => {
    await writeFile(join(root, "NEW.local.md"), "# later\n");
    const hidden = await gitIgnoredSubset(root, ["NEW.local.md", "ROADMAP.md", "docs/private/deck/competitors.md"]);
    expect([...hidden].sort()).toEqual(["NEW.local.md", "docs/private/deck/competitors.md"]);
    expect((await gitIgnoredSubset(root, ["ROADMAP.md"])).size).toBe(0);
  });

  it("ignores nothing outside a git repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "bf-nogit-"));
    try {
      expect((await gitIgnoredMatcher(outside))("anything.local.md")).toBe(false);
      expect((await gitIgnoredSubset(outside, ["anything.local.md"])).size).toBe(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("keeps gitignored files out of the (committable) symbol snapshot", async () => {
    const cachePath = join(root, ".builderforce", "symbols.json");
    const index = new WorkspaceSymbolIndex(root, { cachePath });
    expect((await index.find("secret hole")).total).toBe(0);
    expect((await index.find("Competitive quadrant")).total).toBe(0);
    expect((await index.find("Public PRD")).total).toBe(1);

    // A watcher-reported edit to an ignored file stays out too.
    index.markDirty("SECURITY-FINDINGS.local.md");
    expect((await index.find("secret hole")).total).toBe(0);

    // The snapshot write is fire-and-forget: wait for it to land.
    const snapshot = await vi.waitFor(
      async () => JSON.parse(await readFile(cachePath, "utf-8")) as { files: Array<[string]> },
      { timeout: 5_000, interval: 20 },
    );
    expect(snapshot.files.map(([rel]) => rel).sort()).toEqual(["ROADMAP.md", "docs/specs/01-prd.md"]);
  });
});
