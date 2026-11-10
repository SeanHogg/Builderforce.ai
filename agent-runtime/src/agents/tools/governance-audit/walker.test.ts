import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkingTreeReader, MAX_SCAN_BYTES, walkWorkingTree } from "./walker.js";

let root: string;

async function put(rel: string, content: string | Buffer): Promise<void> {
  const full = path.join(root, ...rel.split("/"));
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "gov-walker-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("walkWorkingTree", () => {
  it("lists POSIX relative paths, keeps dot-files and policy dot-dirs, skips noise dirs", async () => {
    await put("src/a.ts", "a");
    await put(".env", "X=1");
    await put(".builderforce/policies/p.yaml", "rules: []");
    await put(".github/workflows/ci.yml", "on: push");
    await put("node_modules/x/index.js", "");
    await put(".git/HEAD", "ref");
    await put(".idea/workspace.xml", "");
    await put("dist/out.js", "");

    expect(await walkWorkingTree(root)).toEqual([
      ".builderforce/policies/p.yaml",
      ".env",
      ".github/workflows/ci.yml",
      "src/a.ts",
    ]);
  });

  it("stops at the file cap", async () => {
    await put("a.txt", "");
    await put("b.txt", "");
    await put("c.txt", "");
    expect(await walkWorkingTree(root, 2)).toHaveLength(2);
  });
});

describe("createWorkingTreeReader", () => {
  it("reads text, refuses binary and oversize files", async () => {
    await put("t.txt", "hello");
    await put("b.bin", Buffer.from([1, 0, 2]));
    await put("big.txt", "x".repeat(MAX_SCAN_BYTES + 1));
    const read = createWorkingTreeReader(root);
    expect(await read("t.txt")).toBe("hello");
    expect(await read("b.bin")).toBeNull();
    expect(await read("big.txt")).toBeNull();
    expect(await read("missing.txt")).toBeNull();
  });

  it("regression: oversize files skipped silently", async () => {
    await put("big.txt", "x".repeat(MAX_SCAN_BYTES + 1));
    await put("small.txt", "ok");
    const skipped: string[] = [];
    const read = createWorkingTreeReader(root, (rel) => skipped.push(rel));
    expect(await read("big.txt")).toBeNull();
    expect(await read("small.txt")).toBe("ok");
    expect(skipped).toEqual(["big.txt"]);
  });
});
