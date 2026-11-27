import * as vscode from "vscode";
import { PROJECT_TYPES, projectTypeById, type ProjectTypeEntry } from "@builderforce/ide-templates/project-types";
import { getWebBaseUrl } from "../gateway/gateway";
import { vscodeWorkspacePort } from "../composerCommands/vscodeWorkspacePort";
import { chooseFolder, type WorkspaceFolderRef } from "../composerCommands/workspacePort";
import { createProjectInteractive } from "./createProjectInteractive";
import { linkProject, readProjectLink } from "./projectLink";
import { runProjectTypeActions } from "./projectTypeActions";
import { projectTypeText } from "./projectTypeText";

/** Pick a type from the registry; undefined when dismissed. */
async function pickProjectType(): Promise<ProjectTypeEntry | undefined> {
  const picked = await vscode.window.showQuickPick(
    PROJECT_TYPES.map((type) => ({ label: projectTypeText(type.labelKey), description: projectTypeText(type.descriptionKey), type })),
    { title: vscode.l10n.t("New AI project"), placeHolder: vscode.l10n.t("What kind of AI project?"), ignoreFocusOut: true },
  );
  return picked?.type;
}

/**
 * Re-binding a folder that already belongs to another project is destructive, so it asks
 * (modal). True when there is nothing to replace or the person agreed.
 */
async function confirmRebind(port: ReturnType<typeof vscodeWorkspacePort>, folder: WorkspaceFolderRef): Promise<boolean> {
  const current = await readProjectLink(port, folder);
  if (!current.ok || !current.link) return true; // an unreadable file is reported when linking, never overwritten
  const replace = vscode.l10n.t("Replace");
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t("This folder is already linked to project {0} ({1}). Link it to the new project instead?", current.link.projectId, current.link.projectType),
    { modal: true },
    replace,
  );
  return answer === replace;
}

function refusalText(reason: "invalid-json" | "not-an-object"): string {
  return reason === "invalid-json"
    ? vscode.l10n.t("BuilderForce: .builderforce/project.json is not valid JSON, so it was left unchanged.")
    : vscode.l10n.t("BuilderForce: .builderforce/project.json is not a JSON object, so it was left unchanged.");
}

/**
 * `builderforce.newAiProject`: create a server project of an AI type (modality from the
 * registry), link it to the open folder (`.builderforce/project.json`), then run the type's
 * first-run actions. `typeId` (the walkthrough passes it) skips the type pick; an unknown
 * string falls back to the picker.
 */
export async function newAiProject(
  context: vscode.ExtensionContext,
  ensureSignedIn: () => Promise<boolean>,
  typeId?: string,
): Promise<void> {
  if (!(await ensureSignedIn())) return;
  const type = typeof typeId === "string" ? projectTypeById(typeId) ?? (await pickProjectType()) : await pickProjectType();
  if (!type) return;

  // Settle the folder and any re-bind BEFORE creating anything on the server.
  const port = vscodeWorkspacePort();
  let folder: WorkspaceFolderRef | undefined;
  if (port.folders().length > 0) {
    folder = await chooseFolder(port, vscode.l10n.t("Which folder is this project for?"));
    if (!folder || !(await confirmRebind(port, folder))) return;
  }

  const project = await createProjectInteractive(context, { modality: type.modality, title: projectTypeText(type.labelKey) });
  if (!project) return;

  if (folder) {
    try {
      const result = await linkProject(port, folder, { projectId: project.id, projectType: type.id }, { replace: true });
      if (result.status === "refused") void vscode.window.showWarningMessage(refusalText(result.reason));
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not write .builderforce/project.json ({0}).", (error as Error).message));
    }
  }
  await runProjectTypeActions(type.firstRun, { projectId: project.id, webBaseUrl: getWebBaseUrl() });
}
