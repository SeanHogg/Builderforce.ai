import * as vscode from "vscode";
import { BfTask, deleteTask, invalidateTasks, setTaskArchived, updateTaskStatus } from "./bfApi";
import { attentionFor } from "./attention";
import { confirmDeleteInEditor } from "./confirmDeletionUi";
import { surfaceError } from "./errorReporter";
import { getSelectedProject } from "./projectState";
import { TASK_LANES } from "./taskLanes";
import { taskRowLabel } from "./taskTreeShared";

/** Any task row — open Tasks or Closed — carries its ticket as `task`. */
type TaskRow = { task?: BfTask } | undefined;

/**
 * The Work view's ticket row actions: set status (which also reopens a closed
 * ticket), archive / restore, and delete behind a modal confirmation. Each write
 * drops the task caches and repaints through `refresh` — the open Tasks list, which
 * the Closed section follows.
 */
export function registerTaskActions(context: vscode.ExtensionContext, refresh: () => void): vscode.Disposable {
  const t = vscode.l10n.t;

  const afterWrite = () => {
    invalidateTasks(getSelectedProject()?.id);
    refresh();
  };

  const setStatus = async (row: TaskRow) => {
    const task = row?.task;
    if (!task) return;
    const pick = await vscode.window.showQuickPick(
      TASK_LANES.map((l) => ({ label: t(l.label), description: l.key, key: l.key, picked: l.key === task.status })),
      { title: t("Set status for {0}", task.key ?? task.title), placeHolder: task.status },
    );
    if (!pick) return;
    try {
      await updateTaskStatus(context.secrets, task.id, pick.key);
      afterWrite();
      void vscode.window.showInformationMessage(t("BuilderForce: {0} → {1}", task.key ?? task.title, pick.label));
    } catch (e) {
      surfaceError(e, "task:update", t("BuilderForce: could not update task ({0}).", (e as Error).message));
    }
  };

  const setArchived = (archived: boolean) => async (row: TaskRow) => {
    const task = row?.task;
    if (!task) return;
    try {
      await setTaskArchived(context.secrets, task.id, archived);
      afterWrite();
      void vscode.window.showInformationMessage(
        archived ? t("BuilderForce: archived {0}", task.key ?? task.title) : t("BuilderForce: restored {0}", task.key ?? task.title),
      );
    } catch (e) {
      surfaceError(e, "task:archive", t("BuilderForce: could not update task ({0}).", (e as Error).message));
    }
  };

  const remove = async (row: TaskRow) => {
    const task = row?.task;
    if (!task) return;
    // A ticket with a live run (running, awaiting an answer) cannot be deleted under it.
    const ok = await confirmDeleteInEditor(taskRowLabel(task), attentionFor("task", task.id) != null);
    if (!ok) return;
    try {
      await deleteTask(context.secrets, task.id);
      afterWrite();
      void vscode.window.showInformationMessage(t("BuilderForce: deleted {0}", task.key ?? task.title));
    } catch (e) {
      surfaceError(e, "task:delete", t("BuilderForce: could not delete task ({0}).", (e as Error).message));
    }
  };

  return vscode.Disposable.from(
    vscode.commands.registerCommand("builderforce.setTaskStatus", setStatus),
    vscode.commands.registerCommand("builderforce.archiveTask", setArchived(true)),
    vscode.commands.registerCommand("builderforce.unarchiveTask", setArchived(false)),
    vscode.commands.registerCommand("builderforce.deleteTask", remove),
  );
}
