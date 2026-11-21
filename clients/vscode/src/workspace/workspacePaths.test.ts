import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureWorkspaceDirs, workspacePaths } from "./workspacePaths";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workspacePaths", () => {
  it("uses the default folders and rejects a parent override", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-ws-"));
    roots.push(root);
    const paths = workspacePaths(root, { logs: "../x", methodology: "notes" });
    expect(paths.logs).toBe(path.join(root, ".builderforce", "logs"));
    expect(paths.diagnostics).toBe(path.join(root, ".builderforce", "diagnostics"));
    expect(paths.methodology).toBe(path.resolve(root, "notes"));
    expect(paths.issues).toEqual([{ code: "path-parent", key: "logs", value: "../x" }]);
  });

  it("ensureWorkspaceDirs writes the gitignore and does not list methodology", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-ws-"));
    roots.push(root);
    const paths = workspacePaths(root);
    ensureWorkspaceDirs(paths);
    const ignore = fs.readFileSync(path.join(paths.root, ".gitignore"), "utf8");
    expect(ignore).toContain("logs/");
    expect(ignore).toContain("diagnostics/");
    expect(ignore).toContain("cache/");
    expect(ignore).not.toContain("methodology");
    expect(fs.existsSync(paths.methodology)).toBe(true);
  });
});
