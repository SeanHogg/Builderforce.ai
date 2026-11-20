import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The editor, as far as the port's file calls go: `workspace.fs` writes to the real disk. */
const editor = vi.hoisted(() => ({ folders: [] as Array<{ name: string; uri: { fsPath: string } }>, remoteName: undefined as string | undefined }));
vi.mock("vscode", async () => {
  const fs = await import("node:fs/promises");
  return {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    FileSystemError: class FileSystemError extends Error {},
    env: { get remoteName() { return editor.remoteName; } },
    window: {},
    workspace: {
      get workspaceFolders() { return editor.folders; },
      fs: {
        createDirectory: vi.fn(async (uri: { fsPath: string }) => { await fs.mkdir(uri.fsPath, { recursive: true }); }),
        writeFile: vi.fn(async (uri: { fsPath: string }, bytes: Uint8Array) => { await fs.writeFile(uri.fsPath, bytes); }),
      },
    },
  };
});

import * as vscode from "vscode";
import { vscodeWorkspacePort } from "./vscodeWorkspacePort";
import { WriteRefusedError } from "./writeContainment";

describe("the editor's workspace port: writes stay inside the folder", () => {
  let root: string;
  let outside: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "bf-port-root-"));
    outside = await mkdtemp(path.join(tmpdir(), "bf-port-outside-"));
    editor.folders = [{ name: "app", uri: { fsPath: root } }];
    vi.mocked(vscode.workspace.fs.writeFile).mockClear();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("writes a normal nested path, creating its directories", async () => {
    const file = path.join(root, "web", "src", "main.tsx");
    await vscodeWorkspacePort().writeText(file, "export {};");
    expect(await readFile(file, "utf8")).toBe("export {};");
  });

  it("refuses a write through a directory link (a junction on Windows) and writes nothing", async () => {
    await symlink(outside, path.join(root, "linked"), "junction");
    const file = path.join(root, "linked", "package.json");
    await expect(vscodeWorkspacePort().writeText(file, "{}")).rejects.toBeInstanceOf(WriteRefusedError);
    await expect(vscodeWorkspacePort().writeText(file, "{}")).rejects.toMatchObject({ refusals: [{ file, reason: "symlink" }] });
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses a DANGLING link, and reports it as existing (it is an entry, never followed)", async () => {
    const gone = path.join(outside, "gone");
    await mkdir(gone);
    const link = path.join(root, "builderforce.json");
    await symlink(gone, link, "junction");
    await rm(gone, { recursive: true });
    const port = vscodeWorkspacePort();
    expect(await port.exists(link)).toBe(true);
    expect(await port.checkWrites([link])).toEqual([{ file: link, reason: "symlink" }]);
    await expect(port.writeText(link, "{}")).rejects.toBeInstanceOf(WriteRefusedError);
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses a path outside every workspace folder", async () => {
    const stray = path.join(outside, "stray.txt");
    await expect(vscodeWorkspacePort().writeText(stray, "x")).rejects.toMatchObject({ refusals: [{ file: stray, reason: "outside-folder" }] });
  });

  it("says an absent file does not exist, and a real one does", async () => {
    await writeFile(path.join(root, "real.txt"), "x");
    const port = vscodeWorkspacePort();
    expect(await port.exists(path.join(root, "real.txt"))).toBe(true);
    expect(await port.exists(path.join(root, "absent.txt"))).toBe(false);
  });

  it("passes the extension host's remote name through", () => {
    expect(vscodeWorkspacePort().remoteName()).toBeUndefined();
    editor.remoteName = "ssh-remote";
    expect(vscodeWorkspacePort().remoteName()).toBe("ssh-remote");
    editor.remoteName = undefined;
  });
});
