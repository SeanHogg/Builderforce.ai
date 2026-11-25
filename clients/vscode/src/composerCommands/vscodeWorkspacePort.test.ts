import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The editor, as far as the port's file calls go: `workspace.fs` writes to the real disk. */
const editor = vi.hoisted(() => ({ folders: [] as Array<{ name: string; uri: { fsPath: string } }>, remoteName: undefined as string | undefined }));
vi.mock("vscode", async () => {
  const fs = await import("node:fs/promises");
  class FileSystemError extends Error {
    constructor(message: string, readonly code = "Unknown") { super(message); }
  }
  return {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    FileSystemError,
    env: { get remoteName() { return editor.remoteName; } },
    window: {},
    workspace: {
      get workspaceFolders() { return editor.folders; },
      fs: {
        createDirectory: vi.fn(async (uri: { fsPath: string }) => { await fs.mkdir(uri.fsPath, { recursive: true }); }),
        writeFile: vi.fn(async (uri: { fsPath: string }, bytes: Uint8Array) => { await fs.writeFile(uri.fsPath, bytes); }),
        // As VS Code's: `overwrite: false` refuses an existing target.
        rename: vi.fn(async (from: { fsPath: string }, to: { fsPath: string }, options: { overwrite: boolean }) => {
          if (!options.overwrite && await fs.lstat(to.fsPath).then(() => true, () => false)) throw new FileSystemError(to.fsPath, "FileExists");
          await fs.rename(from.fsPath, to.fsPath);
        }),
      },
    },
  };
});

import * as vscode from "vscode";
import { vscodeWorkspacePort } from "./vscodeWorkspacePort";
import { WriteRefusedError } from "./writeContainment";
import { TargetExistsError } from "./workspacePort";

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

  it("moves a root manifest into .builderforce/, creating it, and never over an existing file", async () => {
    const from = path.join(root, "builderforce.json");
    const to = path.join(root, ".builderforce", "builderforce.json");
    await writeFile(from, "{\"version\":1}");
    const port = vscodeWorkspacePort();
    await port.move(from, to);
    expect(await readFile(to, "utf8")).toBe("{\"version\":1}");
    expect(await port.exists(from)).toBe(false);

    await writeFile(from, "{\"other\":true}");
    await expect(port.move(from, to)).rejects.toBeInstanceOf(TargetExistsError);
    expect(await readFile(to, "utf8")).toBe("{\"version\":1}");
    expect(await readFile(from, "utf8")).toBe("{\"other\":true}");
  });

  it("refuses a move whose target leads outside the folder, and moves nothing", async () => {
    const from = path.join(root, "builderforce.json");
    await writeFile(from, "{}");
    const stray = path.join(outside, "builderforce.json");
    await expect(vscodeWorkspacePort().move(from, stray)).rejects.toMatchObject({ refusals: [{ file: stray, reason: "outside-folder" }] });
    expect(await readFile(from, "utf8")).toBe("{}");
  });

  it("stats a file, a directory (a link to one included) and nothing", async () => {
    const file = path.join(root, "page.html");
    await writeFile(file, "<p>hi</p>");
    await symlink(outside, path.join(root, "linked"), "junction");
    const port = vscodeWorkspacePort();
    expect(await port.stat(file)).toBe("file");
    expect(await port.stat(root)).toBe("directory");
    expect(await port.stat(path.join(root, "linked"))).toBe("directory");
    expect(await port.stat(path.join(root, "gone.html"))).toBeUndefined();
    expect(await port.stat(path.join(file, "below"))).toBeUndefined();
  });

  it("passes the extension host's remote name through", () => {
    expect(vscodeWorkspacePort().remoteName()).toBeUndefined();
    editor.remoteName = "ssh-remote";
    expect(vscodeWorkspacePort().remoteName()).toBe("ssh-remote");
    editor.remoteName = undefined;
  });
});
