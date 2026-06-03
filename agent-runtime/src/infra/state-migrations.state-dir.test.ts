import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLegacyStateDirs, resolveNewStateDir } from "../config/paths.js";
import {
  autoMigrateLegacyStateDir,
  resetAutoMigrateLegacyStateDirForTest,
} from "./state-migrations.js";

let tempRoot: string | null = null;

async function makeTempRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "builderforce-state-dir-"));
  tempRoot = root;
  return root;
}

afterEach(async () => {
  resetAutoMigrateLegacyStateDirForTest();
  if (!tempRoot) {
    return;
  }
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("legacy state dir auto-migration", () => {
  it("follows legacy symlink when it points at another legacy dir", async () => {
    const root = await makeTempRoot();
    const legacyDirs = resolveLegacyStateDirs(() => root);
    const legacySymlink = legacyDirs[0];
    if (!legacySymlink) {
      return;
    }
    const legacyDir = path.join(root, ".builderforce-legacy-target");

    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "marker.txt"), "ok", "utf-8");

    const dirLinkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(legacyDir, legacySymlink, dirLinkType);

    const result = await autoMigrateLegacyStateDir({
      env: {} as NodeJS.ProcessEnv,
      homedir: () => root,
    });

    expect(result.migrated).toBe(true);
    expect(result.warnings).toEqual([]);

    const targetMarker = path.join(
      resolveNewStateDir(() => root),
      "marker.txt",
    );
    expect(fs.readFileSync(targetMarker, "utf-8")).toBe("ok");
    expect(fs.readFileSync(path.join(legacyDir, "marker.txt"), "utf-8")).toBe("ok");
    expect(fs.readFileSync(path.join(legacySymlink, "marker.txt"), "utf-8")).toBe("ok");
  });
});
