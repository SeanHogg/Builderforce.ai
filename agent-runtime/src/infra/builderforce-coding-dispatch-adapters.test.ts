import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { makeCodingFs } from "./builderforce-coding-dispatch-adapters.js";
import { diffWorkspace } from "./builderforce-coding-dispatch.js";

describe("makeCodingFs snapshot", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("regression: dot-dirs and vendor survive a dispatch diff with no deletions", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "coding-fs-"));
    const files = [
      { path: ".vscode/settings.json", content: "{}" },
      { path: ".husky/pre-commit", content: "npm test" },
      { path: "vendor/x.js", content: "x" },
      { path: "src/a.ts", content: "a" },
    ];
    const codingFs = makeCodingFs();
    await codingFs.materialize(dir, files);
    await fs.mkdir(path.join(dir, "node_modules", "dep"), { recursive: true });
    await fs.writeFile(path.join(dir, "node_modules", "dep", "i.js"), "dep", "utf8");

    const after = await codingFs.snapshot(dir);
    expect(after.map((f) => f.path).sort()).toEqual([".husky/pre-commit", ".vscode/settings.json", "src/a.ts", "vendor/x.js"]);
    const before = new Map(files.map((f) => [f.path, f.content]));
    expect(diffWorkspace(before, after, false)).toEqual({ writes: [], deletes: [] });
  });

  it("regression: output-dir and oversize files present before and after produce no delete; a really removed file does", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "coding-fs-"));
    const big = "x".repeat(600 * 1024);
    const files = [
      { path: "dist/index.html", content: "<html/>" },
      { path: "data.json", content: big },
      { path: "src/gone.ts", content: "g" },
      { path: "src/a.ts", content: "a" },
    ];
    const codingFs = makeCodingFs();
    await codingFs.materialize(dir, files);
    await fs.rm(path.join(dir, "src", "gone.ts"));

    const after = await codingFs.snapshot(dir);
    expect(after.map((f) => f.path)).toEqual(["src/a.ts"]);
    const before = new Map(files.map((f) => [f.path, f.content]));
    const gone = await codingFs.missing(dir, [...before.keys()].filter((p) => !after.some((f) => f.path === p)));
    expect([...gone]).toEqual(["src/gone.ts"]);
    expect(diffWorkspace(before, after, false, gone)).toEqual({ writes: [], deletes: ["src/gone.ts"] });
  });
});
