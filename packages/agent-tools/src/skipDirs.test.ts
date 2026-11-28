import { describe, expect, it } from "vitest";
import { isDependencyDirName, isGeneratedDirName, isInSkippedDir, isIndexedDirName, isOutputDirName, WORKSPACE_SKIP_DIRS } from "./skipDirs.js";

describe("skip-dir policy", () => {
  it("dependency/VCS names are a subset of the output dirs, and output dirs of the skip dirs", () => {
    for (const name of [".git", "node_modules", ".pnpm-store", ".venv", "venv", ".tox", "__pycache__"]) {
      expect(isDependencyDirName(name)).toBe(true);
      expect(isOutputDirName(name)).toBe(true);
    }
    for (const name of ["dist", "build", "out", ".svelte-kit", ".wrangler", ".output", ".gradle"]) {
      expect(isOutputDirName(name)).toBe(true);
      expect(isDependencyDirName(name)).toBe(false);
      expect(WORKSPACE_SKIP_DIRS.has(name)).toBe(true);
    }
  });

  it("a build-output name can be a parent folder, so it is not a dependency name", () => {
    expect(isDependencyDirName("build")).toBe(false);
    expect(isDependencyDirName("out")).toBe(false);
  });

  it("bin and obj are generated for a classifier but never skipped by a walk", () => {
    expect(isGeneratedDirName("bin")).toBe(true);
    expect(isGeneratedDirName("obj")).toBe(true);
    expect(isGeneratedDirName("vendor")).toBe(true);
    expect(isGeneratedDirName("src")).toBe(false);
    expect(WORKSPACE_SKIP_DIRS.has("bin")).toBe(false);
    expect(isIndexedDirName("bin")).toBe(true);
  });

  it("isInSkippedDir tests directories only, at any depth, with either separator", () => {
    expect(isInSkippedDir("node_modules/react/index.js")).toBe(true);
    expect(isInSkippedDir("packages/ui/dist/a.js", isOutputDirName)).toBe(true);
    expect(isInSkippedDir("a\\Build\\x.js", isOutputDirName)).toBe(true);
    expect(isInSkippedDir("src/build-utils.ts", isOutputDirName)).toBe(false);
    expect(isInSkippedDir("dist", isOutputDirName)).toBe(false);
    expect(isInSkippedDir("vendor/x.go", isOutputDirName)).toBe(false);
    expect(isInSkippedDir("vendor/x.go")).toBe(true);
  });
});
