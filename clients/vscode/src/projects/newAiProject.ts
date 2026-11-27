import * as vscode from "vscode";
import { PROJECT_TYPES, projectTypeById, type ProjectTypeEntry } from "@builderforce/ide-templates/project-types";
import * as bfApi from "../bfApi";
import { getWebBaseUrl } from "../gateway/gateway";
import { vscodeWorkspacePort } from "../composerCommands/vscodeWorkspacePort";
import { chooseFolder } from "../composerCommands/workspacePort";
import { invalidateProjectNames } from "../project/projectNames";
import { setSelectedProject } from "../project/projectState";
import { writeProjectManifest } from "./projectManifest";
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

/** Record the project in the open folder's manifest, merged into any existing one. */
async function recordInWorkspace(projectId: number, projectType: string): Promise<void> {
  const port = vscodeWorkspacePort();
  const folder = await chooseFolder(port, vscode.l10n.t("Which folder is this project for?"));
  if (!folder) return;
  try {
    const result = await writeProjectManifest(port, folder, { projectId, projectType });
    if (!result.ok) {
      void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce: the existing builderforce.json is not a JSON object, so it was left unchanged."));
    }
  } catch (error) {
    void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not write builderforce.json ({0}).", (error as Error).message));
  }
}

/**
 * `builderforce.newAiProject`: create a server project of an AI type (modality from the
 * registry), record it in the open folder's manifest, then run the type's first-run actions.
 * `typeId` (the walkthrough passes it) skips the type pick.
 */
export async function newAiProject(
  context: vscode.ExtensionContext,
  ensureSignedIn: () => Promise<boolean>,
  typeId?: string,
): Promise<void> {
  if (!(await ensureSignedIn())) return;
  const type = typeId ? projectTypeById(typeId) : await pickProjectType();
  if (!type) return;
  const name = await vscode.window.showInputBox({
    title: projectTypeText(type.labelKey),
    prompt: vscode.l10n.t("Name your project"),
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t("A project name is required")),
  });
  if (!name?.trim()) return;
  let project: bfApi.BfProject;
  try {
    project = await bfApi.createProject(context.secrets, name.trim(), type.modality);
  } catch (error) {
    const message = (error as Error).message;
    void vscode.window.showErrorMessage(
      /HTTP 402/.test(message)
        ? vscode.l10n.t("BuilderForce: your plan's project limit is reached. Upgrade your workspace to add more.")
        : vscode.l10n.t("BuilderForce: could not create project ({0}).", message),
    );
    return;
  }
  invalidateProjectNames();
  setSelectedProject({ id: project.id, name: project.name });
  bfApi.invalidateTasks(project.id);
  void vscode.commands.executeCommand("builderforce.refreshProjects");
  if ((vscode.workspace.workspaceFolders ?? []).length > 0) await recordInWorkspace(project.id, type.id);
  void vscode.window.showInformationMessage(vscode.l10n.t("BuilderForce: created project “{0}”.", project.name));
  await runProjectTypeActions(type.firstRun, { projectId: project.id, webBaseUrl: getWebBaseUrl() });
}
