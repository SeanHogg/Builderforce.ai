/**
 * `/manifest init` (PRD 31 §W11): detect the app in a workspace folder with the shared
 * `app-detect` pipeline, emit its `builderforce.json` v1, SHOW it (a diff against the
 * current file, or a preview when there is none), and write it only on a modal approval.
 */
import type { DetectionNote } from "@builderforce/app-detect";
import type { ComposerCommandExecutor } from "./dispatch";
import type { ComposerCommandText } from "./labels";
import { chooseFolder, inFolder, launchFollowUp, type ComposerWorkspacePort } from "./workspacePort";
import { writeRefusedReply } from "./writeContainment";

import { MANIFEST_FILE_NAME } from "@builderforce/app-detect/manifest";
export { MANIFEST_FILE_NAME };

/** A detected manifest: its text, the ids it declares, and what detection could not express. */
export interface DetectedManifest {
  text: string;
  services: string[];
  resources: string[];
  /** Detection's warnings, then `emitManifest`'s notes — coded, worded by `text.noteLines`. */
  notes: DetectionNote[];
}

/** Detect an app from its files (project-relative POSIX path → text). Pure. */
export type DetectManifest = (files: Map<string, string>) => DetectedManifest;

/** Read a folder's files for detection (bounded; `workspaceFiles.ts`). */
export type ReadFolderFiles = (root: string) => Promise<Map<string, string>>;

/** Show the proposed manifest: a diff against `currentFile` when it exists, else a preview. */
export type ShowManifest = (proposed: string, title: string, currentFile?: string) => Promise<void>;

export interface ManifestInitDeps {
  port: ComposerWorkspacePort;
  text: ComposerCommandText;
  readFiles: ReadFolderFiles;
  detect: DetectManifest;
  show: ShowManifest;
}

export function manifestInitExecutor({ port, text, readFiles, detect, show }: ManifestInitDeps): ComposerCommandExecutor {
  return async () => {
    const folder = await chooseFolder(port, text.pickFolder);
    if (!folder) return { kind: "text", tone: "info", lines: [text.noFolderChosen] };
    const detected = detect(await readFiles(folder.path));
    const file = inFolder(folder, MANIFEST_FILE_NAME);
    // Refused before the preview and the question: a builderforce.json that is a symbolic link is never written through.
    const refused = await port.checkWrites([file]);
    if (refused.length > 0) return writeRefusedReply(text, refused);
    const current = await port.readText(file);
    let approved: boolean;
    if (current === undefined) {
      await show(detected.text, text.manifestPreviewTitle);
      approved = await port.confirm(text.manifestWriteQuestion, text.manifestWrite);
    } else {
      await show(detected.text, text.manifestDiffTitle, file);
      approved = await port.confirm(text.manifestReplaceQuestion, text.manifestReplace);
    }
    if (!approved) return { kind: "text", tone: "info", lines: [text.manifestDeclined] };
    await port.writeText(file, detected.text);
    const next = launchFollowUp(port, text);
    return {
      kind: "text",
      tone: "info",
      lines: [
        text.manifestWritten(detected.services.length, detected.resources.length),
        text.services(detected.services),
        text.resources(detected.resources),
        ...text.noteLines(detected.notes),
        next.line,
      ],
      ...(next.actions ? { actions: next.actions } : {}),
    };
  };
}
