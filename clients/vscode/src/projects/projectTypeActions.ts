import * as vscode from "vscode";
import { projectTypePath, type ProjectTypeAction } from "@builderforce/ide-templates/project-types";
import { PICK_MODEL_COMMAND } from "../models/noLocalModelPrompt";
import { projectTypeText } from "./projectTypeText";


export interface ProjectTypeRunContext {
  projectId: number;
  /** The web app's base URL (`getWebBaseUrl()`), no trailing slash. */
  webBaseUrl: string;
}

/** The label a `choice` option shows: its `labelKey`, else the command id. */
function optionLabel(action: ProjectTypeAction): string {
  return action.kind === "command" && action.labelKey ? projectTypeText(action.labelKey) : action.kind === "command" ? action.command : action.kind;
}

/**
 * Run a project type's `firstRun` actions in order. A `choice` asks which option to run and
 * stops the sequence when the person dismisses it, as does a dismissed model pick. A step that
 * throws is reported once and ends the sequence (later steps build on earlier ones): a failed or
 * cancelled step always stops the sequence, and a failure is never silently skipped.
 */
export async function runProjectTypeActions(actions: readonly ProjectTypeAction[], context: ProjectTypeRunContext): Promise<void> {
  for (const action of actions) {
    try {
      if ((await runAction(action, context)) === "stop") return;
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not finish setting up the project ({0}).", (error as Error).message));
      return;
    }
  }
}

async function runAction(action: ProjectTypeAction, context: ProjectTypeRunContext): Promise<"stop" | undefined> {
  switch (action.kind) {
    case "command":
      await vscode.commands.executeCommand(action.command);
      return undefined;
    case "pickModel":
      // `builderforce.pickModel` resolves true only when a model was picked; a dismissed pick ends the sequence.
      return (await vscode.commands.executeCommand<boolean>(PICK_MODEL_COMMAND)) === true ? undefined : "stop";
    case "openWeb":
      await vscode.env.openExternal(vscode.Uri.parse(`${context.webBaseUrl}${projectTypePath(action.path, context.projectId)}`));
      return undefined;
    case "choice": {
      const picked = await vscode.window.showQuickPick(
        action.options.map((option) => ({ label: optionLabel(option), option })),
        { placeHolder: projectTypeText(action.placeholderKey), ignoreFocusOut: true },
      );
      if (!picked) return "stop";
      return runAction(picked.option, context);
    }
  }
}
