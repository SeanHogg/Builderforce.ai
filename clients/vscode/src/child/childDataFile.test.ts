import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHILD_DATA_MAX_AGE_MS, MAX_CHILD_DATA_FILES, pruneChildDataFiles, writeChildDataFile } from "./childDataFile";
import { ensureIgnoredCacheDir } from "../ignoredCacheDir";

const roots: string[] = [];
const tempRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "child-data-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("a sub-agent's data file", () => {
  it("is written under the git-ignored workspace cache and named by chat and handle", async () => {
    const root = tempRoot();
    const rel = await writeChildDataFile(root, 7, "a1", "# data");
    expect(rel).toBe(".builderforce/cache/subagents/chat7-a1.md");
    expect(fs.readFileSync(path.join(root, rel), "utf8")).toBe("# data");
    expect(fs.readFileSync(path.join(root, ".builderforce", "cache", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("prunes files past the age limit and the oldest beyond the count, never the one just written", async () => {
    const root = tempRoot();
    const dir = await ensureIgnoredCacheDir(root, "subagents");
    const now = Date.now();
    const stale = path.join(dir, "chat1-old.md");
    fs.writeFileSync(stale, "x");
    fs.utimesSync(stale, new Date(now - CHILD_DATA_MAX_AGE_MS - 60_000), new Date(now - CHILD_DATA_MAX_AGE_MS - 60_000));
    for (let i = 0; i < MAX_CHILD_DATA_FILES + 3; i += 1) {
      const file = path.join(dir, `chat2-a${i}.md`);
      fs.writeFileSync(file, "x");
      const at = new Date(now - (i + 1) * 1_000);
      fs.utimesSync(file, at, at);
    }
    await writeChildDataFile(root, 9, "a1", "new", now);
    const left = fs.readdirSync(dir).filter((n) => n.endsWith(".md"));
    expect(left).toHaveLength(MAX_CHILD_DATA_FILES);
    expect(left).toContain("chat9-a1.md");
    expect(left).not.toContain("chat1-old.md");
    expect(left).toContain("chat2-a0.md");
    expect(await pruneChildDataFiles(dir, now, "chat9-a1.md")).toEqual([]);
  });

  it("leaves an existing ignore file alone", async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, ".builderforce", "cache"), { recursive: true });
    fs.writeFileSync(path.join(root, ".builderforce", "cache", ".gitignore"), "custom\n");
    await ensureIgnoredCacheDir(root, "subagents");
    expect(fs.readFileSync(path.join(root, ".builderforce", "cache", ".gitignore"), "utf8")).toBe("custom\n");
  });
});
