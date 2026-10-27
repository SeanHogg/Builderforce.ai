import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureGitIgnored, fileResearchStore, researchCacheStore } from "./node-research.js";

// The research cache quotes workspace code and lives in `.builderforce/`, a folder teams
// commit — so the cache file must be git-ignored before it is ever written.

describe("research cache stays out of git", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-node-research-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes .builderforce/.gitignore listing research-cache.json on the first answer", async () => {
    const store = researchCacheStore(root);
    await store.set("k", "quoted code");
    const ignore = await readFile(join(root, ".builderforce", ".gitignore"), "utf-8");
    expect(ignore.split("\n")).toContain("research-cache.json");
    const persisted = JSON.parse(await readFile(join(root, ".builderforce", "research-cache.json"), "utf-8")) as {
      entries: Array<[string, string]>;
    };
    expect(persisted.entries).toEqual([["k", "quoted code"]]);
  });

  it("appends to a team's existing .gitignore without touching its entries, once", async () => {
    const dir = join(root, ".builderforce");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".gitignore"), "scan.json", "utf-8");
    const store = fileResearchStore(join(dir, "research-cache.json"));
    await store.set("a", "1");
    await store.set("b", "2");
    await ensureGitIgnored(dir, "research-cache.json");
    expect(await readFile(join(dir, ".gitignore"), "utf-8")).toBe("scan.json\nresearch-cache.json\n");
  });

  it("treats a rooted entry as already listed", async () => {
    await writeFile(join(root, ".gitignore"), "/research-cache.json\n", "utf-8");
    await ensureGitIgnored(root, "research-cache.json");
    expect(await readFile(join(root, ".gitignore"), "utf-8")).toBe("/research-cache.json\n");
  });
});
