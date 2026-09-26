import { describe, expect, it } from "vitest";
import { inScope, normalizeScopePath, overlappingScopes } from "./workstreamScope";

/** Concurrent children share one checkout; these scopes are what keep two of them out of one file. */
describe("workstreamScope", () => {
  it("normalizes separators, a leading ./ and a trailing slash", () => {
    expect(normalizeScopePath(".\\api\\src\\")).toBe("api/src");
  });

  it("owns a directory's descendants but not a sibling that shares its prefix", () => {
    expect(inScope("src/auth/login.ts", ["src/auth"])).toBe(true);
    expect(inScope("src/auth", ["src/auth/"])).toBe(true);
    expect(inScope("src/authz.ts", ["src/auth"])).toBe(false);
  });

  it("finds two workstreams that claim the same subtree", () => {
    const clash = overlappingScopes([
      { label: "W1", paths: ["api/src/runtime"] },
      { label: "W8", paths: ["api/src/runtime/preview.ts"] },
    ]);
    expect(clash).toEqual({ a: "W1", b: "W8", path: "api/src/runtime" });
  });

  it("passes disjoint scopes", () => {
    expect(overlappingScopes([
      { label: "W2", paths: ["api/src/blueprint"] },
      { label: "W8", paths: ["api/src/domain/project/Project.ts"] },
    ])).toBeNull();
  });
});
