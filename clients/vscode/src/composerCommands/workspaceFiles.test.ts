import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Directories (by absolute path) whose listing fails, as an unreadable one would (EACCES / EPERM). */
const unreadable = vi.hoisted(() => new Set<string>());
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: (async (dir: string, options: unknown) => {
      if (unreadable.has(path.resolve(dir))) throw Object.assign(new Error(`EACCES: permission denied, scandir '${dir}'`), { code: "EACCES" });
      return actual.readdir(dir, options as { withFileTypes: true });
    }) as typeof actual.readdir,
  };
});

import { readWorkspaceFiles } from "./workspaceFiles";

describe("reading a workspace folder for detection", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "bf-files-"));
    await mkdir(path.join(root, "web"), { recursive: true });
    await mkdir(path.join(root, "secret"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}");
    await writeFile(path.join(root, "web", "package.json"), "{\"name\":\"web\"}");
    await writeFile(path.join(root, "secret", "a.txt"), "hidden");
  });
  afterEach(async () => {
    unreadable.clear();
    await rm(root, { recursive: true, force: true });
  });

  it("reports an unreadable subdirectory and goes on with the rest", async () => {
    unreadable.add(path.join(root, "secret"));
    const report = vi.fn();
    const files = await readWorkspaceFiles(root, report);
    expect([...files.keys()].sort()).toEqual(["package.json", "web/package.json"]);
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: "EACCES" }), "secret");
  });

  it("reads everything, reporting nothing, when every directory is readable", async () => {
    const report = vi.fn();
    expect([...(await readWorkspaceFiles(root, report)).keys()].sort()).toEqual(["package.json", "secret/a.txt", "web/package.json"]);
    expect(report).not.toHaveBeenCalled();
  });

  it("reads .builderforce/builderforce.json first, and nothing else of .builderforce/", async () => {
    await mkdir(path.join(root, ".builderforce", "logs"), { recursive: true });
    await writeFile(path.join(root, ".builderforce", "builderforce.json"), "{\"version\":1}");
    await writeFile(path.join(root, ".builderforce", "hooks.json"), "{}");
    await writeFile(path.join(root, ".builderforce", "logs", "run.log"), "log");
    const report = vi.fn();
    const files = await readWorkspaceFiles(root, report, { maxFiles: 1, maxFileBytes: 1024, maxTotalBytes: 4096 });
    expect([...files.keys()]).toEqual([".builderforce/builderforce.json"]);
    expect(report).not.toHaveBeenCalled();
    const all = await readWorkspaceFiles(root, report);
    expect([...all.keys()].filter((key) => key.startsWith(".builderforce/"))).toEqual([".builderforce/builderforce.json"]);
  });

  it("rejects when the folder itself cannot be read", async () => {
    unreadable.add(path.resolve(root));
    await expect(readWorkspaceFiles(root, vi.fn())).rejects.toMatchObject({ code: "EACCES" });
  });
});
