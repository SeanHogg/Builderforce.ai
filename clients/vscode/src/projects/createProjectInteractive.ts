import * as vscode from "vscode";
import * as bfApi from "../bfApi";
import { invalidateProjectNames } from "../project/projectNames";
import { setSelectedProject } from "../project/projectState";
import { handlePlanLimit } from "./planLimit";

export interface CreateProjectOptions {
  /** The IDE project type the API creates the project with (`CreateProjectBody.modality`). */
  modality?: string;
  /** Title of the name prompt. */
  title?: string;
}

/**
 * The ONE interactive "create a project" flow, shared by `builderforce.createProject` and
 * `builderforce.newAiProject`: prompt for a name, create it in the signed-in workspace, make it
 * the selected project and say so. A plan limit (402) offers the upgrade; any other failure is
 * shown. Resolves the created project, or undefined when cancelled or failed. The caller has
 * already checked sign-in.
 */
export async function createProjectInteractive(
  context: vscode.ExtensionContext,
  options: CreateProjectOptions = {},
): Promise<bfApi.BfProject | undefined> {
  const name = await vscode.window.showInputBox({
    title: options.title ?? vscode.l10n.t("Create BuilderForce project"),
    prompt: vscode.l10n.t("Name your project"),
    placeHolder: vscode.l10n.t("e.g. Mobile App, Website Redesign"),
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t("A project name is required")),
  });
  if (!name?.trim()) return undefined;
  try {
    const project = await bfApi.createProject(context.secrets, name.trim(), options.modality);
    invalidateProjectNames(); // a new project must appear in the Sessions/Inbox labels
    setSelectedProject({ id: project.id, name: project.name });
    bfApi.invalidateTasks(project.id);
    void vscode.commands.executeCommand("builderforce.refreshProjects");
    void vscode.window.showInformationMessage(vscode.l10n.t("BuilderForce: created project “{0}”.", project.name));
    return project;
  } catch (error) {
    const message = (error as Error).message;
    // 402 = plan project limit reached → upgrading is a web-app action.
    if (/HTTP 402/.test(message)) {
      await handlePlanLimit(vscode.l10n.t("BuilderForce: your plan's project limit is reached. Upgrade your workspace to add more."));
    } else {
      void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not create project ({0}).", message));
    }
    return undefined;
  }
}
