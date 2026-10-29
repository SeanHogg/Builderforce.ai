import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveShellCwd } from "./node-path.js";

/** ONE rule for the directory a shell command starts in, for every node shell. */
describe("resolveShellCwd", () => {
  const root = mkdtempSync(join(tmpdir(), "shell-cwd-"));
  mkdirSync(join(root, "app", "src"), { recursive: true });
  mkdirSync(join(root, "..foo"));
  writeFileSync(join(root, "README.md"), "x");
  afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

  it("is the root itself when no directory is named", () => {
    for (const none of [undefined, "", "."]) expect(resolveShellCwd(root, none)).toEqual({ ok: true, dir: resolve(root) });
  });

  it("resolves a directory inside the root, nested or not", () => {
    expect(resolveShellCwd(root, "app")).toEqual({ ok: true, dir: resolve(root, "app") });
    expect(resolveShellCwd(root, "app/src")).toEqual({ ok: true, dir: resolve(root, "app", "src") });
  });

  it("allows a directory whose NAME merely starts with dots - the escape test is per path segment", () => {
    expect(resolveShellCwd(root, "..foo")).toEqual({ ok: true, dir: resolve(root, "..foo") });
  });

  it("refuses a path that leaves the root, naming why", () => {
    for (const escape of ["..", "../x", "app/../../x", resolve(root, "..")]) {
      expect(resolveShellCwd(root, escape)).toMatchObject({ ok: false, error: expect.stringContaining("outside the workspace") });
    }
  });

  it("refuses something that is not a directory - a file, or nothing at all", () => {
    expect(resolveShellCwd(root, "README.md")).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
    expect(resolveShellCwd(root, "missing")).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
  });
});
