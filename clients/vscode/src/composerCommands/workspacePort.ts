/**
 * What the composer command executors need from the editor, as a port: the workspace
 * folders, reading and writing files in them, and the person's approval. The executors
 * never touch `vscode` themselves (`vscodeWorkspacePort.ts` is the one adapter), so each
 * is unit-tested against an in-memory fake.
 */
import * as path from "node:path";
import { LAUNCH_COMMAND_ID } from "./entries";
import type { ComposerCommandText } from "./labels";
import type { ComposerReplyAction } from "./reply";
import type { WriteRefusal } from "./writeContainment";

export interface WorkspaceFolderRef {
  /** The folder's display name. */
  name: string;
  /** Its absolute path on disk. */
  path: string;
}

export interface ComposerWorkspacePort {
  folders(): readonly WorkspaceFolderRef[];
  /**
   * The remote this extension host runs in (`vscode.env.remoteName`: `ssh-remote`, `wsl`,
   * `dev-container`…), or undefined when it runs on this computer. `/launch` opens a
   * loopback server in the person's browser, so it needs a LOCAL host.
   */
  remoteName(): string | undefined;
  /** Ask which folder (several are open). Undefined when the person cancels. */
  pickFolder(placeHolder: string): Promise<WorkspaceFolderRef | undefined>;
  /** The names directly inside a directory; empty when it does not exist. */
  listDir(dir: string): Promise<string[]>;
  /** Is there an entry at this path — a symbolic link (dangling included) counts, it is never followed. */
  exists(file: string): Promise<boolean>;
  /** The file's text, or undefined when it does not exist. */
  readText(file: string): Promise<string | undefined>;
  /** The files among these that may NOT be written (`writeContainment.ts`), so a command can refuse before writing any. */
  checkWrites(files: readonly string[]): Promise<WriteRefusal[]>;
  /**
   * Write a file, creating its parent directories. A path `checkWrites` refuses is never
   * written: it rejects with a `WriteRefusedError`.
   */
  writeText(file: string, text: string): Promise<void>;
  /**
   * Move a file, creating the target's parent directories. Never replaces a file: an existing
   * `to` rejects with a {@link TargetExistsError}. A path `checkWrites` refuses (either one) is
   * never moved: it rejects with a `WriteRefusedError`.
   */
  move(from: string, to: string): Promise<void>;
  /** A MODAL warning with one approving button. True only when that button was chosen. */
  confirm(message: string, approve: string): Promise<boolean>;
}

/** `move` found its target already there (it appeared after the command checked): nothing was moved or replaced. */
export class TargetExistsError extends Error {
  constructor(readonly file: string) {
    super(`${file} already exists`);
    this.name = "TargetExistsError";
  }
}

/** The folder a command works on: the only one, or the one the person picks. */
export async function chooseFolder(port: ComposerWorkspacePort, placeHolder: string): Promise<WorkspaceFolderRef | undefined> {
  const folders = port.folders();
  if (folders.length <= 1) return folders[0];
  return port.pickFolder(placeHolder);
}

/**
 * How a reply that wrote an app ends: the `/launch` hint and action — or, in a remote
 * extension host where `/launch` cannot run, why not, and no action.
 */
export function launchFollowUp(port: ComposerWorkspacePort, text: ComposerCommandText): { line: string; actions?: ComposerReplyAction[] } {
  const remote = port.remoteName();
  return remote
    ? { line: text.launchRemote(remote) }
    : { line: text.launchHint, actions: [{ label: `/${LAUNCH_COMMAND_ID}`, command: `/${LAUNCH_COMMAND_ID}` }] };
}

/** A project-relative POSIX path (`web/package.json`) under a folder, on this platform. */
export function inFolder(folder: WorkspaceFolderRef, relative: string): string {
  return path.join(folder.path, ...relative.split("/"));
}
