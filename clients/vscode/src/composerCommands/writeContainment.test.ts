import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refusedWrites, within, writeRefusal, type ContainmentFs } from "./writeContainment";

/**
 * Directory links are made as JUNCTIONS: Windows creates those without the symlink
 * privilege, and elsewhere the type is ignored (a plain directory symlink). Node's `lstat`
 * reports a junction as a symbolic link, so both are the same case to the check.
 */
const linkDir = (target: string, link: string) => symlink(target, link, "junction");

describe("write containment (real file system)", () => {
  let root: string;
  let outside: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "bf-contain-root-"));
    outside = await mkdtemp(path.join(tmpdir(), "bf-contain-outside-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("refuses a write through a directory link that leads out of the folder", async () => {
    await linkDir(outside, path.join(root, "linked"));
    expect(await writeRefusal(path.join(root, "linked", "package.json"), root)).toBe("symlink");
    expect(await writeRefusal(path.join(root, "linked", "deep", "file.ts"), root)).toBe("symlink");
  });

  it("refuses a DANGLING link, as the target and as a directory on the way", async () => {
    const gone = path.join(outside, "gone");
    await mkdir(gone);
    await linkDir(gone, path.join(root, "dangling"));
    await rm(gone, { recursive: true });
    expect(await writeRefusal(path.join(root, "dangling"), root)).toBe("symlink");
    expect(await writeRefusal(path.join(root, "dangling", "builderforce.json"), root)).toBe("symlink");
  });

  it("allows a normal nested path, existing or still to be created", async () => {
    await mkdir(path.join(root, "web", "src"), { recursive: true });
    await writeFile(path.join(root, "web", "package.json"), "{}");
    expect(await writeRefusal(path.join(root, "web", "package.json"), root)).toBeUndefined();
    expect(await writeRefusal(path.join(root, "web", "src", "main.tsx"), root)).toBeUndefined();
    expect(await writeRefusal(path.join(root, "api", "src", "routes", "index.ts"), root)).toBeUndefined();
  });

  it("refuses a path outside the folder, or the folder itself", async () => {
    expect(await writeRefusal(path.join(root, "..", "escape.txt"), root)).toBe("outside-folder");
    expect(await writeRefusal(root, root)).toBe("outside-folder");
  });

  it("checks each file against the folder that holds it, and refuses one no folder holds", async () => {
    await linkDir(outside, path.join(root, "linked"));
    const ok = path.join(root, "ok.txt");
    const linked = path.join(root, "linked", "x.txt");
    const stray = path.join(outside, "stray.txt");
    expect(await refusedWrites([ok, linked, stray], [root])).toEqual([
      { file: linked, reason: "symlink" },
      { file: stray, reason: "outside-folder" },
    ]);
  });
});

describe("write containment (file links and real paths)", () => {
  const root = path.resolve("/work/app");
  /** A fake fs: `links` lstat as symbolic links; `real` maps a path to its real path. */
  const fakeFs = (links: string[], existing: string[], real: Record<string, string> = {}): ContainmentFs => ({
    lstat: async (file) => {
      if (links.includes(file)) return { isSymbolicLink: () => true };
      if (file === root || existing.includes(file)) return { isSymbolicLink: () => false };
      throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
    },
    realpath: async (file) => real[file] ?? file,
  });

  it("refuses a target FILE that is a symbolic link (existing or dangling — lstat sees both)", async () => {
    const target = path.join(root, "builderforce.json");
    expect(await writeRefusal(target, root, fakeFs([target], []))).toBe("symlink");
  });

  it("refuses when the parent's real path is outside the folder's real path", async () => {
    const web = path.join(root, "web");
    const fs = fakeFs([], [web], { [web]: path.resolve("/elsewhere/web") });
    expect(await writeRefusal(path.join(web, "package.json"), root, fs)).toBe("outside-folder");
  });

  it("allows a name that only starts with two dots (`..config`); a `..` segment still leaves", async () => {
    const dotted = path.join(root, "..config");
    expect(within(root, dotted)).toBe(true);
    expect(within(root, path.join(root, "..config", "x.json"))).toBe(true);
    expect(await writeRefusal(dotted, root, fakeFs([], []))).toBeUndefined();
    expect(within(root, path.join(root, ".."))).toBe(false);
    expect(within(root, path.join(root, "..", "sibling"))).toBe(false);
    expect(within(root, path.resolve("/elsewhere"))).toBe(false);
  });

  it("accepts a folder that is itself reached through a link (both real paths agree)", async () => {
    const realRoot = path.resolve("/real/app");
    const web = path.join(root, "web");
    const fs = fakeFs([], [web], { [root]: realRoot, [web]: path.join(realRoot, "web") });
    expect(await writeRefusal(path.join(web, "package.json"), root, fs)).toBeUndefined();
  });
});
