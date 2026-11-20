/**
 * What the composer command executors need from the editor, as a port: the workspace
 * folders, reading and writing files in them, and the person's approval. The executors
 * never touch `vscode` themselves (`vscodeWorkspacePort.ts` is the one adapter), so each
 * is unit-tested against an in-memory fake.
 */
import * as path from "node:path";

export interface WorkspaceFolderRef {
  /** The folder's display name. */
  name: string;
  /** Its absolute path on disk. */
  path: string;
}

export interface ComposerWorkspacePort {
  folders(): readonly WorkspaceFolderRef[];
  /** Ask which folder (several are open). Undefined when the person cancels. */
  pickFolder(placeHolder: string): Promise<WorkspaceFolderRef | undefined>;
  /** The names directly inside a directory; empty when it does not exist. */
  listDir(dir: string): Promise<string[]>;
  exists(file: string): Promise<boolean>;
  /** The file's text, or undefined when it does not exist. */
  readText(file: string): Promise<string | undefined>;
  /** Write a file, creating its parent directories. */
  writeText(file: string, text: string): Promise<void>;
  /** A MODAL warning with one approving button. True only when that button was chosen. */
  confirm(message: string, approve: string): Promise<boolean>;
}

/** The folder a command works on: the only one, or the one the person picks. */
export async function chooseFolder(port: ComposerWorkspacePort, placeHolder: string): Promise<WorkspaceFolderRef | undefined> {
  const folders = port.folders();
  if (folders.length <= 1) return folders[0];
  return port.pickFolder(placeHolder);
}

/** A project-relative POSIX path (`web/package.json`) under a folder, on this platform. */
export function inFolder(folder: WorkspaceFolderRef, relative: string): string {
  return path.join(folder.path, ...relative.split("/"));
}
