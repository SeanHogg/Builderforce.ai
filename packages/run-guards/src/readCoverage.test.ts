import { describe, expect, it } from "vitest";
import { ReadCoverage, canonicalReadArgs, type ReadCoverageTraits } from "./readCoverage.js";

/** A minimal host vocabulary: paths are targets, `sh` is the unscoped mutation. */
const traits: ReadCoverageTraits = {
  visitTarget: (args) => (args as { path?: string }).path,
  activityTarget: (args) => (args as { path?: string }).path,
  questionSeparator: " ∋ ",
  isUnscopedMutation: (tool) => tool === "sh",
  isCodeChangeTool: (tool) => tool === "write_file",
  isLocalWorkspaceTool: (tool) => ["read_file", "write_file", "sh", "git_push"].includes(tool),
  isRepoPublishTool: (tool) => tool === "git_push",
  isRepoStateReadTool: () => false,
};

describe("ReadCoverage (host traits injected)", () => {
  it("arms the exact-repeat guard on canonical arguments", () => {
    const c = new ReadCoverage(traits);
    c.record("read_file", { path: "./a/b/", offset: 1 });
    expect(c.isRepeat("read_file", { path: "a/b" })).toBe(true);
    expect(canonicalReadArgs("read_file", { path: " ./x ", offset: 0 })).toEqual({ path: "x" });
  });

  it("counts visits and keeps the count across an unscoped mutation, excusing the next read", () => {
    const c = new ReadCoverage(traits);
    c.record("read_file", { path: "a", offset: 1 });
    c.record("read_file", { path: "a", offset: 50 });
    c.invalidate("sh", {});
    expect(c.isRepeat("read_file", { path: "a" })).toBe(false);
    const v = c.record("read_file", { path: "a", offset: 90 });
    expect(v).toMatchObject({ count: 3, mayHaveChanged: true });
    expect(c.record("read_file", { path: "a", offset: 120 })?.mayHaveChanged).toBe(false);
  });

  it("a code change forgets only its own target", () => {
    const c = new ReadCoverage(traits);
    c.record("read_file", { path: "a" });
    c.record("read_file", { path: "b" });
    c.invalidate("write_file", { path: "a" });
    expect(c.isRepeat("read_file", { path: "a" })).toBe(false);
    expect(c.isRepeat("read_file", { path: "b" })).toBe(true);
  });

  it("serves a covered window from the cached read", () => {
    const c = new ReadCoverage(traits);
    c.record("read_file", { path: "f" });
    c.cacheResult("read_file", { path: "f" }, { result: { ok: true, content: "1\n2\n3\n4", totalLines: 4 }, anchor: 0 });
    expect(c.coveredRead("read_file", { path: "f", offset: 2, limit: 2 })).toMatchObject({ start: 2, end: 3 });
    expect(c.coveredRead("read_file", { path: "g" })).toBeNull();
  });
});
