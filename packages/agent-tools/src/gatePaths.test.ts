import { describe, expect, it } from "vitest";
import { gatePathCandidates, parsePatchHeader, patchHeaderPaths, toolCallPaths } from "./gatePaths.js";

describe("parsePatchHeader", () => {
  it("reads each header, ignoring indentation and trailing space", () => {
    expect(parsePatchHeader("*** Add File: a.ts")).toEqual({ kind: "add", path: "a.ts" });
    expect(parsePatchHeader("   *** Update File: src/b.ts  ")).toEqual({ kind: "update", path: "src/b.ts" });
    expect(parsePatchHeader("\t*** Delete File: c.ts")).toEqual({ kind: "delete", path: "c.ts" });
    expect(parsePatchHeader("  *** Move to: d.ts")).toEqual({ kind: "move", path: "d.ts" });
  });

  it("reads nothing else", () => {
    expect(parsePatchHeader("+*** Add File: a.ts")).toBeNull();
    expect(parsePatchHeader("*** Add File:a.ts")).toBeNull();
    expect(parsePatchHeader("@@ context")).toBeNull();
  });
});

describe("patchHeaderPaths / toolCallPaths", () => {
  const input = "*** Begin Patch\n*** Update File: a.ts\n  *** Move to: b.ts\n@@\n-x\n+y\n*** Add File: c.ts\n+z\n*** End Patch";

  it("lists every file a patch touches, in order, CRLF or LF", () => {
    expect(patchHeaderPaths(input)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(patchHeaderPaths(input.replace(/\n/g, "\r\n"))).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("is empty for anything that is not a patch", () => {
    expect(patchHeaderPaths("*** Update File: a.ts")).toEqual([]);
    expect(patchHeaderPaths(42)).toEqual([]);
  });

  it("toolCallPaths takes them from an apply_patch input", () => {
    expect(toolCallPaths({ input })).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});

describe("gatePathCandidates", () => {
  it("resolves a relative path to one spelling", () => {
    expect(gatePathCandidates("./src/../secrets/key.txt")).toEqual(["secrets/key.txt"]);
    expect(gatePathCandidates("a\\b\\c.ts")).toEqual(["a/b/c.ts"]);
  });

  it("adds every tail for an absolute or climbing path", () => {
    expect(gatePathCandidates("/home/dev/secrets/key.txt")).toEqual(["home/dev/secrets/key.txt", "dev/secrets/key.txt", "secrets/key.txt", "key.txt"]);
    expect(gatePathCandidates("../../secrets/key.txt")).toContain("secrets/key.txt");
    expect(gatePathCandidates("C:\\work\\secrets\\k.txt")).toContain("secrets/k.txt");
  });
});
