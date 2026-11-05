import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countCommitsPerPath, gitHistoryPort } from "./node-git-history.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("countCommitsPerPath", () => {
  it("counts commits per wanted path, once per commit", () => {
    const log = [SHA_A, "src/a.ts", "src/b.ts", "src/a.ts", "", SHA_B, "src/a.ts", "other.ts", ""].join("\n");
    expect([...countCommitsPerPath(log, new Set(["src/a.ts", "src/b.ts"]))].sort()).toEqual([["src/a.ts", 2], ["src/b.ts", 1]]);
  });
});

describe("gitHistoryPort", () => {
  it("is undefined outside a git work tree (never throws)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-nogit-"));
    try {
      expect(await gitHistoryPort(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is undefined for a folder that does not exist", async () => {
    expect(await gitHistoryPort(join(tmpdir(), "bf-missing-folder-xyz"))).toBeUndefined();
  });
});
