import * as vscode from "vscode";
import { PROJECT_TYPES, projectTypeById, type ProjectTypeEntry } from "@builderforce/ide-templates/project-types";
import { getWebBaseUrl } from "../gateway/gateway";
import { vscodeWorkspacePort } from "../composerCommands/vscodeWorkspacePort";
import { chooseFolder, type WorkspaceFolderRef } from "../composerCommands/workspacePort";
import { createProjectInteractive } from "./createProjectInteractive";
import { linkProject, readProjectLink } from "./projectLink";
import { runProjectTypeActions } from "./projectTypeActions";
import { projectTypeText } from "./projectTypeText";

function availableInEditor(type: ProjectTypeEntry): boolean {
  return !type.editorExtension || Boolean(vscode.extensions.getExtension(type.editorExtension));
}

async function pickProjectType(): Promise<ProjectTypeEntry | undefined> {
  const picked = await vscode.window.showQuickPick(
    PROJECT_TYPES.filter(availableInEditor).map((type) => ({ label: projectTypeText(type.labelKey), description: projectTypeText(type.descriptionKey), type })),
    { title: vscode.l10n.t("Choose a project type"), ignoreFocusOut: true },
  );
  return picked?.type;
}

/**
 * Re-binding a folder that already belongs to another project is destructive, so it asks
 * (modal). `proceed` is false when the link file is unreadable (reported; nothing is created)
 * or the person cancelled; `expectedProjectId` is the id they agreed to replace.
 */
async function confirmRebind(
  port: ReturnType<typeof vscodeWorkspacePort>,
  folder: WorkspaceFolderRef,
): Promise<{ proceed: boolean; expectedProjectId?: unknown }> {
  const current = await readProjectLink(port, folder);
  if (!current.ok) {
    void vscode.window.showWarningMessage(refusalText(current.reason));
    return { proceed: false };
  }
  if (!current.link) return { proceed: true };
  const replace = vscode.l10n.t("Replace");
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t("This folder is already linked to project {0} ({1}). Link it to the new project instead?", String(current.link.projectId), String(current.link.projectType ?? "?")),
    { modal: true },
    replace,
  );
  return answer === replace ? { proceed: true, expectedProjectId: current.link.projectId } : { proceed: false };
}

function refusalText(reason: "invalid-json" | "not-an-object"): string {
  return reason === "invalid-json"
    ? vscode.l10n.t("BuilderForce: .builderforce/project.json is not valid JSON, so it was left unchanged.")
    : vscode.l10n.t("BuilderForce: .builderforce/project.json is not a JSON object, so it was left unchanged.");
}

/**
 * `builderforce.newAiProject`: create a server project from a starter (modality from the
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
  const requested = projectTypeById(typeId);
  const type = requested && availableInEditor(requested) ? requested : await pickProjectType();
  if (!type) return;

  // Settle the folder and any re-bind BEFORE creating anything on the server.
  const port = vscodeWorkspacePort();
  let folder: WorkspaceFolderRef | undefined;
  let expectedProjectId: unknown;
  if (port.folders().length > 0) {
    folder = await chooseFolder(port, vscode.l10n.t("Which folder is this project for?"));
    if (!folder) return;
    const rebind = await confirmRebind(port, folder);
    if (!rebind.proceed) return;
    expectedProjectId = rebind.expectedProjectId;
  }

  const project = await createProjectInteractive(context, { modality: type.modality, title: projectTypeText(type.labelKey) });
  if (!project) return;

  if (folder) {
    try {
      const result = await linkProject(port, folder, { projectId: project.id, projectType: type.id }, expectedProjectId === undefined ? {} : { replace: { expectedProjectId } });
      if (result.status === "refused") void vscode.window.showWarningMessage(refusalText(result.reason));
      else if (result.status === "conflict") {
        void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce: .builderforce/project.json was linked to another project in the meantime, so it was left unchanged."));
      }
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not write .builderforce/project.json ({0}).", (error as Error).message));
    }
  }
  await runProjectTypeActions(type.firstRun, { projectId: project.id, webBaseUrl: getWebBaseUrl() });
}
