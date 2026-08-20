import { describe, expect, it } from "vitest";
import { resolve, sep } from "node:path";
import {
  isInsideRoot,
  PathEscapesRootError,
  resolveInsideRoot,
  resolveInsideRootOrThrow,
} from "./node-path.js";

const ROOT = resolve("/tmp/bf-workspace");

describe("resolveInsideRoot", () => {
  it("resolves a plain relative path under the root", () => {
    expect(resolveInsideRoot(ROOT, "src/index.ts")).toBe(resolve(ROOT, "src/index.ts"));
  });

  it("returns the root itself for '' and '.'", () => {
    expect(resolveInsideRoot(ROOT, "")).toBe(ROOT);
    expect(resolveInsideRoot(ROOT, ".")).toBe(ROOT);
  });

  it("allows a '..' that stays inside the root", () => {
    expect(resolveInsideRoot(ROOT, "src/../README.md")).toBe(resolve(ROOT, "README.md"));
  });

  it("rejects a '..' escape", () => {
    expect(resolveInsideRoot(ROOT, "../secrets.env")).toBeNull();
    expect(resolveInsideRoot(ROOT, "src/../../secrets.env")).toBeNull();
  });

  it("rejects an absolute path outside the root", () => {
    expect(resolveInsideRoot(ROOT, resolve("/etc/passwd"))).toBeNull();
  });

  it("accepts an absolute path that is inside the root", () => {
    const inside = resolve(ROOT, "src/a.ts");
    expect(resolveInsideRoot(ROOT, inside)).toBe(inside);
  });

  it("rejects a sibling directory whose name merely shares the root's prefix", () => {
    // `/tmp/bf-workspace-evil` starts with the root string but is NOT inside it.
    expect(resolveInsideRoot(ROOT, `..${sep}bf-workspace-evil${sep}x`)).toBeNull();
  });

  it("normalises an unresolved root before comparing", () => {
    expect(resolveInsideRoot(`${ROOT}${sep}src${sep}..`, "README.md")).toBe(
      resolve(ROOT, "README.md"),
    );
  });

  it.runIf(process.platform === "win32")("rejects a path on another Windows drive", () => {
    expect(resolveInsideRoot("C:\\work\\repo", "D:\\other\\file.ts")).toBeNull();
  });

  it.runIf(process.platform === "win32")("rejects a UNC path from a drive-rooted root", () => {
    expect(resolveInsideRoot("C:\\work\\repo", "\\\\server\\share\\file.ts")).toBeNull();
  });
});

describe("isInsideRoot", () => {
  it("mirrors resolveInsideRoot as a boolean", () => {
    expect(isInsideRoot(ROOT, "src/a.ts")).toBe(true);
    expect(isInsideRoot(ROOT, "../a.ts")).toBe(false);
  });
});

describe("resolveInsideRootOrThrow", () => {
  it("returns the absolute path for a contained path", () => {
    expect(resolveInsideRootOrThrow(ROOT, "src/a.ts")).toBe(resolve(ROOT, "src/a.ts"));
  });

  it("throws PathEscapesRootError on an escape", () => {
    expect(() => resolveInsideRootOrThrow(ROOT, "../a.ts")).toThrow(PathEscapesRootError);
    expect(() => resolveInsideRootOrThrow(ROOT, "../a.ts")).toThrow(/escapes the workspace/);
  });

  it("throws a typed message when no path string was supplied", () => {
    expect(() => resolveInsideRootOrThrow(ROOT, undefined)).toThrow(/'path' string is required/);
    expect(() => resolveInsideRootOrThrow(ROOT, 42)).toThrow(/'path' string is required/);
  });
});
