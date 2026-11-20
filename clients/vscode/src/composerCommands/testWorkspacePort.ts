/**
 * Test support: an in-memory {@link ComposerWorkspacePort} the executor tests share.
 * Files are keyed by absolute path (`path.join`), so paths read the same as the real port's.
 */
import * as path from "node:path";
import type { ComposerWorkspacePort, WorkspaceFolderRef } from "./workspacePort";

export interface FakeWorkspacePort extends ComposerWorkspacePort {
  files: Map<string, string>;
  /** Every `confirm` asked: its message and button. */
  asked: Array<{ message: string; approve: string }>;
  /** The answer the next `confirm`s give. */
  approve: boolean;
  /** The folder `pickFolder` returns (several folders open). */
  picked?: WorkspaceFolderRef;
}

export function fakeWorkspacePort(folders: WorkspaceFolderRef[], files: Record<string, string> = {}): FakeWorkspacePort {
  const port: FakeWorkspacePort = {
    files: new Map(Object.entries(files)),
    asked: [],
    approve: true,
    folders: () => folders,
    pickFolder: async () => port.picked,
    listDir: async (dir) => {
      const names = new Set<string>();
      const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
      for (const file of port.files.keys()) if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split(path.sep)[0]!);
      return [...names];
    },
    exists: async (file) => port.files.has(file),
    readText: async (file) => port.files.get(file),
    writeText: async (file, text) => { port.files.set(file, text); },
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
