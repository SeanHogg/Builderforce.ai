import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { knowledgeRootId, legacyRootIdOf, rootById } from "./knowledgeRoots";

let dir = "";
let outside = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kg-roots-"));
  outside = await mkdtemp(join(tmpdir(), "kg-roots-out-"));
  await mkdir(join(dir, "pkg", "inner"), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const folders = () => [{ path: dir }];

describe("rootById", () => {
  it("resolves the folder itself and a folder inside it, in the new id form and the legacy one", () => {
    const base = knowledgeRootId(dir);
    const legacy = legacyRootIdOf({ folderPath: dir.replace(/\\/g, "/"), rel: "" });
    expect(rootById(base, folders())?.rel).toBe("");
    expect(rootById(`${base}:pkg/inner`, folders())?.rel).toBe("pkg/inner");
    expect(rootById(legacy, folders())?.rel).toBe("");
    expect(rootById(`${legacy}/pkg/inner`, folders())?.rel).toBe("pkg/inner");
  });

  it("refuses a root id whose relative part leaves the workspace folder, in both forms", () => {
    const base = knowledgeRootId(dir);
    const legacy = legacyRootIdOf({ folderPath: dir.replace(/\\/g, "/"), rel: "" });
    const rels = ["../../x", "..\\x", "pkg/../..", "folder/../..", "C:/x", "C:\\x", "/etc", "\\\\server\\share", "pkg/..", "a\0b"];
    for (const rel of rels) {
      expect(rootById(`${base}:${rel}`, folders()), `new form: ${JSON.stringify(rel)}`).toBeUndefined();
      expect(rootById(`${legacy}/${rel}`, folders()), `legacy form: ${JSON.stringify(rel)}`).toBeUndefined();
    }
  });

  it("refuses a folder reached through a link that points outside the workspace folder", async () => {
    const linked = await symlink(outside, join(dir, "escape"), "junction").then(() => true, () => false);
    if (!linked) return; // links cannot be made here; the textual cases above still hold
    expect(rootById(`${knowledgeRootId(dir)}:escape`, folders())).toBeUndefined();
    expect(rootById(`${legacyRootIdOf({ folderPath: dir.replace(/\\/g, "/"), rel: "" })}/escape`, folders())).toBeUndefined();
  });

  it("still names a folder that does not exist yet", () => {
    expect(rootById(`${knowledgeRootId(dir)}:not/yet`, folders())?.rel).toBe("not/yet");
  });
});
