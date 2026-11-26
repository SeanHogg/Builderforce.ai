import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPathInside,
  PathEscapesRootError,
  resolveInsideRoot,
  resolveInsideRootReal,
  resolveInsideRootRealOrThrow,
} from "./node-path.js";

const dirs: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("isPathInside / lexical containment", () => {
  it("accepts a name that merely starts with two dots (`..foo`) and the root itself", () => {
    const root = resolve("/tmp/bf-root");
    expect(resolveInsideRoot(root, "..foo")).toBe(resolve(root, "..foo"));
    expect(resolveInsideRoot(root, "..foo/bar")).toBe(resolve(root, "..foo", "bar"));
    expect(isPathInside(root, resolve(root, "..foo"))).toBe(true);
    expect(isPathInside(root, root)).toBe(true);
  });

  it("rejects `../x` and a sibling that shares the root's prefix", () => {
    const root = resolve("/tmp/bf-root");
    expect(resolveInsideRoot(root, "../x")).toBeNull();
    expect(isPathInside(root, resolve("/tmp/bf-root-sibling/x"))).toBe(false);
    expect(isPathInside(root, resolve(root, "..", "x"))).toBe(false);
  });
});

describe("resolveInsideRootReal", () => {
  it("accepts `..foo` and rejects `../x`", async () => {
    const root = await tmp("bf-real-root-");
    await writeFile(join(root, "..foo"), "x");
    expect(await resolveInsideRootReal(root, "..foo")).toBe(join(resolve(root), "..foo"));
    expect(await resolveInsideRootReal(root, "../x")).toBeNull();
  });

  it("accepts a file that does not exist yet (new file, new subdirectory) and refuses it under mustExist", async () => {
    const root = await tmp("bf-real-root-");
    expect(await resolveInsideRootReal(root, "new.ts")).toBe(join(resolve(root), "new.ts"));
    expect(await resolveInsideRootReal(root, "a/b/c/new.ts")).toBe(join(resolve(root), "a", "b", "c", "new.ts"));
    expect(await resolveInsideRootReal(root, "new.ts", { mustExist: true })).toBeNull();
  });

  it("refuses the root itself only when asked to", async () => {
    const root = await tmp("bf-real-root-");
    expect(await resolveInsideRootReal(root, ".")).toBe(resolve(root));
    expect(await resolveInsideRootReal(root, ".", { allowRoot: false })).toBeNull();
  });

  it("refuses a link inside the root that points outside it (file and directory), and a new file beneath such a directory link", async () => {
    const root = await tmp("bf-real-root-");
    const outside = await tmp("bf-real-outside-");
    await writeFile(join(outside, "secret.txt"), "s");
    try {
      // A junction on Windows (no privilege needed); a plain dir symlink elsewhere.
      await symlink(outside, join(root, "linkdir"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      // Reported, not silently passed: the link could not be created on this host.
      console.warn(`symlink case skipped: cannot create a link here (${(error as Error).message})`);
      return;
    }
    expect(await resolveInsideRootReal(root, "linkdir/secret.txt")).toBeNull();
    expect(await resolveInsideRootReal(root, "linkdir")).toBeNull();
    expect(await resolveInsideRootReal(root, "linkdir/not-yet.txt")).toBeNull();
    await expect(resolveInsideRootRealOrThrow(root, "linkdir/secret.txt")).rejects.toBeInstanceOf(PathEscapesRootError);
    // The lexical check alone cannot see it — that is the gap this closes.
    expect(resolveInsideRoot(root, "linkdir/secret.txt")).not.toBeNull();
  });

  it("accepts a link that stays inside the root", async () => {
    const root = await tmp("bf-real-root-");
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "f.txt"), "x");
    try {
      await symlink(join(root, "real"), join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      console.warn(`symlink case skipped: cannot create a link here (${(error as Error).message})`);
      return;
    }
    expect(await resolveInsideRootReal(root, "alias/f.txt")).toBe(join(resolve(root), "alias", "f.txt"));
  });

  it("refuses a dangling link (its destination is unknown) rather than treating it as a new file", async () => {
    const root = await tmp("bf-real-root-");
    const outside = await tmp("bf-real-outside-");
    try {
      await symlink(join(outside, "missing.txt"), join(root, "dangling.txt"), "file");
    } catch (error) {
      console.warn(`symlink case skipped: cannot create a file link here (${(error as Error).message})`);
      return;
    }
    expect(await resolveInsideRootReal(root, "dangling.txt")).toBeNull();
  });

  it("a root that does not exist has nothing to link out of: the lexical answer stands", async () => {
    const root = join(tmpdir(), "bf-no-such-root-xyz");
    expect(await resolveInsideRootReal(root, "a.ts")).toBe(join(resolve(root), "a.ts"));
    expect(await resolveInsideRootReal(root, "../a.ts")).toBeNull();
  });

  it("OrThrow demands a string path", async () => {
    await expect(resolveInsideRootRealOrThrow("/tmp/x", 5)).rejects.toThrow(/'path' string is required/);
  });
});
