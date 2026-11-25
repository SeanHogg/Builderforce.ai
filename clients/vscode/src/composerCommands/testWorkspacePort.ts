/**
 * Test support: an in-memory {@link ComposerWorkspacePort} the executor tests share.
 * Files are keyed by absolute path (`path.join`), so paths read the same as the real port's.
 */
import * as path from "node:path";
import { WriteRefusedError, type WriteRefusal } from "./writeContainment";
import { TargetExistsError, type ComposerWorkspacePort, type WorkspaceFolderRef } from "./workspacePort";

export interface FakeWorkspacePort extends ComposerWorkspacePort {
  files: Map<string, string>;
  /** Paths the write check refuses (as a symbolic link would be). */
  refused: Set<string>;
  /** `remoteName()`'s answer. */
  remote?: string;
  /** Every `confirm` asked: its message and button. */
  asked: Array<{ message: string; approve: string }>;
  /** The answer the next `confirm`s give. */
  approve: boolean;
  /** The folder `pickFolder` returns (several folders open). */
  picked?: WorkspaceFolderRef;
}

export function fakeWorkspacePort(folders: WorkspaceFolderRef[], files: Record<string, string> = {}): FakeWorkspacePort {
  const checkWrites = async (paths: readonly string[]): Promise<WriteRefusal[]> =>
    paths.filter((file) => port.refused.has(file)).map((file) => ({ file, reason: "symlink" as const }));
  const port: FakeWorkspacePort = {
    files: new Map(Object.entries(files)),
    refused: new Set(),
    asked: [],
    approve: true,
    folders: () => folders,
    remoteName: () => port.remote,
    checkWrites,
    pickFolder: async () => port.picked,
    listDir: async (dir) => {
      const names = new Set<string>();
      const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
      for (const file of port.files.keys()) if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split(path.sep)[0]!);
      return [...names];
    },
    exists: async (file) => port.files.has(file),
    stat: async (file) => {
      if (port.files.has(file)) return "file";
      const prefix = file.endsWith(path.sep) ? file : file + path.sep;
      return folders.some((folder) => folder.path === file) || [...port.files.keys()].some((key) => key.startsWith(prefix)) ? "directory" : undefined;
    },
    readText: async (file) => port.files.get(file),
    writeText: async (file, text) => {
      const refused = await checkWrites([file]);
      if (refused.length > 0) throw new WriteRefusedError(refused);
      port.files.set(file, text);
    },
    move: async (from, to) => {
      const refused = await checkWrites([from, to]);
      if (refused.length > 0) throw new WriteRefusedError(refused);
      if (port.files.has(to)) throw new TargetExistsError(to);
      const text = port.files.get(from);
      if (text === undefined) throw new Error(`${from} does not exist`);
      port.files.delete(from);
      port.files.set(to, text);
    },
    confirm: async (message, approve) => {
      port.asked.push({ message, approve });
      return port.approve;
    },
  };
  return port;
}

/** A workspace folder at a platform path. */
export function folderRef(name: string): WorkspaceFolderRef {
  return { name, path: path.join(path.sep, "work", name) };
}
