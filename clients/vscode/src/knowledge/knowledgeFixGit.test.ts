/** The fix flow's git and file operations against a REAL temporary repository: literal pathspecs, snapshot and undo, and links. */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertInsideRoot, isSafeRelative } from "./knowledgeFixPaths";
import { ExportRemovalRefusal } from "@builderforce/agent-tools/node-symbols";
import { srcRef, type Finding } from "@seanhogg/builderforce-memory/knowledge";
import { applyCodemod, nodeFixPorts } from "./knowledgeFixes";
import { snapshotFix, undoSnapshot } from "./knowledgeFixUndo";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

function hasGit(): boolean {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}
const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });

const dirs: string[] = [];
async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kg-git-"));
  dirs.push(root);
  git(root, "init", "-q");
  for (const [p, body] of Object.entries(files)) {
    await mkdir(join(root, p, ".."), { recursive: true });
    await writeFile(join(root, p), body);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}
const read = (root: string, p: string): Promise<string> => readFile(join(root, p), "utf8");
const exists = (root: string, p: string): Promise<boolean> => stat(join(root, p)).then(() => true, () => false);
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe.skipIf(!hasGit())("literal pathspecs", () => {
  it("restores a bracketed route folder as that folder, not as a glob over its siblings", async () => {
    const root = await repo({ "app/[id]/page.tsx": "one", "app/i/page.tsx": "sibling", "app/d/page.tsx": "other" });
    for (const p of ["app/[id]/page.tsx", "app/i/page.tsx", "app/d/page.tsx"]) await writeFile(join(root, p), "EDITED");
    await nodeFixPorts(root).restore(["app/[id]/page.tsx"]);
    expect(await read(root, "app/[id]/page.tsx")).toBe("one");
    expect(await read(root, "app/i/page.tsx")).toBe("EDITED"); // the glob would have matched this one
    expect(await read(root, "app/d/page.tsx")).toBe("EDITED");
  });

  it.skipIf(process.platform === "win32")("treats * and ? in a name as characters", async () => {
    const root = await repo({ "star*.ts": "a", "starX.ts": "b", "q?.ts": "c", "qa.ts": "d" });
    for (const p of ["star*.ts", "starX.ts", "q?.ts", "qa.ts"]) await writeFile(join(root, p), "EDITED");
    await nodeFixPorts(root).restore(["star*.ts", "q?.ts"]);
    expect(await read(root, "star*.ts")).toBe("a");
    expect(await read(root, "q?.ts")).toBe("c");
    expect(await read(root, "starX.ts")).toBe("EDITED");
    expect(await read(root, "qa.ts")).toBe("EDITED");
  });
});

describe.skipIf(!hasGit())("snapshot and undo", () => {
  it("reverts what the fix wrote: tracked files from HEAD, a staged-added file unstaged and deleted", async () => {
    const root = await repo({ "a.ts": "original", "b.ts": "keep" });
    const ports = nodeFixPorts(root);
    await writeFile(join(root, "a.ts"), "fixed");
    await writeFile(join(root, "new.ts"), "created");
    git(root, "add", "new.ts"); // staged as added
    const snapshot = (await snapshotFix(ports, ["a.ts", "new.ts"]))!;
    expect(snapshot.headSha).toMatch(/^[0-9a-f]{40}$/);

    await undoSnapshot(ports, snapshot);
    expect(await read(root, "a.ts")).toBe("original");
    expect(await exists(root, "new.ts")).toBe(false);
    expect(git(root, "ls-files")).not.toContain("new.ts");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("restores a file the fix deleted", async () => {
    const root = await repo({ "gone.ts": "was here" });
    const ports = nodeFixPorts(root);
    await rm(join(root, "gone.ts"));
    const snapshot = (await snapshotFix(ports, ["gone.ts"]))!;
    await undoSnapshot(ports, snapshot);
    expect(await read(root, "gone.ts")).toBe("was here");
  });

  it("refuses when a file changed after the fix, naming it, and touches nothing", async () => {
    const root = await repo({ "a.ts": "original", "b.ts": "original" });
    const ports = nodeFixPorts(root);
    await writeFile(join(root, "a.ts"), "fixed");
    await writeFile(join(root, "b.ts"), "fixed");
    const snapshot = (await snapshotFix(ports, ["a.ts", "b.ts"]))!;
    await writeFile(join(root, "b.ts"), "the person kept typing");
    await expect(undoSnapshot(ports, snapshot)).rejects.toThrow(/changed since the fix.*b\.ts/);
    expect(await read(root, "a.ts")).toBe("fixed");
    expect(await read(root, "b.ts")).toBe("the person kept typing");
  });

  it("refuses when HEAD moved", async () => {
    const root = await repo({ "a.ts": "original" });
    const ports = nodeFixPorts(root);
    await writeFile(join(root, "a.ts"), "fixed");
    const snapshot = (await snapshotFix(ports, ["a.ts"]))!;
    git(root, "commit", "-q", "-am", "the person committed it");
    await expect(undoSnapshot(ports, snapshot)).rejects.toThrow(/branch moved/);
    expect(await read(root, "a.ts")).toBe("fixed");
  });

  it("says there is nothing to undo, never succeeds silently", async () => {
    const root = await repo({ "a.ts": "x" });
    const ports = nodeFixPorts(root);
    await expect(undoSnapshot(ports, { headSha: git(root, "rev-parse", "HEAD").trim(), blobs: {} })).rejects.toThrow(/Nothing to undo/);
    // A file the fix created and that is gone again: no path left to revert.
    const head = git(root, "rev-parse", "HEAD").trim();
    await expect(undoSnapshot(ports, { headSha: head, blobs: { "never-there.ts": "missing" } })).rejects.toThrow(/Nothing to undo/);
  });
});

describe("path safety", () => {
  it("accepts root-relative names and refuses every way out", () => {
    for (const ok of ["a.ts", "src/a.ts", "app/[id]/page.tsx", "dir\\file.ts"]) expect(isSafeRelative(ok)).toBe(true);
    for (const bad of ["", "/etc/x", "\\x", "\\\\server\\share\\x", "C:\\x", "C:/x", "src\\..\\..\\x", "a/../../b", "..\\x", "a\0b"]) expect(isSafeRelative(bad)).toBe(false);
  });

  it("refuses a path whose parent is a link out of the root (a junction on Windows), and the file when it is a link itself", async () => {
    const outside = await mkdtemp(join(tmpdir(), "kg-outside-"));
    const root = await mkdtemp(join(tmpdir(), "kg-root-"));
    dirs.push(outside, root);
    await writeFile(join(outside, "secret.ts"), "s");
    try {
      await symlink(outside, join(root, "link"), "junction");
      await symlink(join(outside, "secret.ts"), join(root, "file-link.ts"), "file");
    } catch {
      return; // this platform cannot create links without privileges
    }
    await expect(assertInsideRoot(root, "link/secret.ts")).rejects.toThrow(/through a link/);
    await expect(assertInsideRoot(root, "file-link.ts")).rejects.toThrow(/is a link/);
    await mkdir(join(root, "real"));
    await expect(assertInsideRoot(root, "real/new.ts")).resolves.toBeUndefined();
    await expect(assertInsideRoot(root, "missing-dir/new.ts")).resolves.toBeUndefined();
    await expect(assertInsideRoot(root, "..\\escape.ts")).rejects.toThrow(/outside the folder/);
  });
});

describe.skipIf(!hasGit())("the fix branch", () => {
  it("switch -c carries the fix, undo reverts it and returns to the original branch, leaving the fix branch", async () => {
    const root = await repo({ "a.ts": "original" });
    const ports = nodeFixPorts(root);
    const origin = (await ports.currentBranch())!;
    expect(origin).toBeTruthy();
    expect(await ports.createBranch("fix/unused-file-test")).toEqual({ ok: true });
    expect(await ports.currentBranch()).toBe("fix/unused-file-test");
    await writeFile(join(root, "a.ts"), "fixed");
    const snapshot = (await snapshotFix(ports, ["a.ts"], origin))!;
    await undoSnapshot(ports, snapshot);
    expect(await read(root, "a.ts")).toBe("original");
    expect(await ports.currentBranch()).toBe(origin);
    expect(git(root, "branch", "--list", "fix/unused-file-test")).toContain("fix/unused-file-test"); // not deleted
  });

  it("reports why a branch could not be made instead of swallowing it", async () => {
    const root = await repo({ "a.ts": "x" });
    const ports = nodeFixPorts(root);
    expect(await ports.createBranch("fix/dup")).toEqual({ ok: true });
    await ports.switchTo((await repoDefault(root))!);
    const again = await ports.createBranch("fix/dup");
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.reason).toMatch(/already exists|exists/i);
  });
});

describe.skipIf(!hasGit())("the unused-export fix through the real ports", () => {
  const exportFinding = (name: string): Finding => ({ id: `f-${name}`, kind: "unused-export", pack: "code", nodes: [srcRef("r", "src/a.ts")], severity: "info", params: { count: 1, files: 1, name } });
  const editorPorts = { dirtyBuffers: () => [], watchSaves: () => ({ stop: () => [] }) };

  it("regression: with two unused exports in one file, fixing one leaves the other exported", async () => {
    const root = await repo({ "src/a.ts": "export const one = 1;\n\nexport function two() {\n  return 2;\n}\n" });
    const out = await applyCodemod({ ...nodeFixPorts(root), ...editorPorts }, "r", exportFinding("one"));
    expect(out.changed).toEqual(["src/a.ts"]);
    expect(await read(root, "src/a.ts")).toBe("export function two() {\n  return 2;\n}\n");
  });

  it("refuses a name the file does not export, and leaves the file as it was", async () => {
    const body = "export const one = 1;\n";
    const root = await repo({ "src/a.ts": body });
    await expect(nodeFixPorts(root).removeExport("src/a.ts", "missing")).rejects.toBeInstanceOf(ExportRemovalRefusal);
    expect(await read(root, "src/a.ts")).toBe(body);
  });
});

async function repoDefault(root: string): Promise<string | undefined> {
  return git(root, "branch", "--format=%(refname:short)").split(/\r?\n/).find((b) => b && !b.startsWith("fix/"));
}
