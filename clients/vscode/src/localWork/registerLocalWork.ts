/**
 * Registers the local work tree (`builderforce.localWork`) and its commands (G05 UI) on the
 * activation path. Every action writes the LOCAL store through `LocalWorkRepository`, so
 * create, set status, archive and open-chat all work with the platform denied; a granted sync
 * pass carries them to the platform.
 */

import * as vscode from "vscode";
import { LOCAL_TICKET_STATUSES } from "../localWorkShared";
import { surfaceError } from "../errorReporter";
import { localBrainApplication } from "../localFirstStore";
import { createLocalWorkRepository } from "../localWorkRepository";
import { openWorkspace } from "../openWorkspace";
import { boundChatOf, type LocalWorkNode } from "./localWorkModel";
import { LocalWorkTreeProvider, ticketStatusText } from "./localWorkTreeProvider";

export const LOCAL_WORK_VIEW = "builderforce.localWork";
const CREATE_TICKET = "builderforce.localWork.createTicket";
const SET_STATUS = "builderforce.localWork.setStatus";
const ARCHIVE = "builderforce.localWork.archive";
const OPEN_CHAT = "builderforce.localWork.openChat";
const REFRESH = "builderforce.localWork.refresh";

export function registerLocalWork(context: vscode.ExtensionContext): void {
  const app = localBrainApplication(context);
  const repo = createLocalWorkRepository({ store: app.store, deviceId: app.deviceId });
  const provider = new LocalWorkTreeProvider(app.store, repo, () => app.durableStore.view());

  const guarded = (operation: string, failure: string, run: (node?: LocalWorkNode) => Promise<void>) =>
    async (node?: LocalWorkNode): Promise<void> => {
      try {
        await run(node);
      } catch (error) {
        surfaceError(error, `command:${operation}`, `${failure}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

  /** The project a new ticket goes under: the node's, else a pick; the first project is made on the spot. */
  async function projectForNewTicket(node: LocalWorkNode | undefined): Promise<string | undefined> {
    if (node?.kind === "project") return node.id;
    const projects = await repo.listProjects();
    if (projects.length === 0) {
      const name = await vscode.window.showInputBox({
        title: vscode.l10n.t("Create a local project"),
        prompt: vscode.l10n.t("A ticket lives in a project. Name the first one."),
        validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t("A name is required")),
      });
      return name?.trim() ? (await repo.createProject({ name })).id : undefined;
    }
    if (projects.length === 1) return projects[0]!.id;
    const picked = await vscode.window.showQuickPick(
      projects.map((project) => ({ label: project.payload.name, id: project.id })),
      { title: vscode.l10n.t("Which project is the ticket for?") },
    );
    return picked?.id;
  }

  context.subscriptions.push(
    provider,
    vscode.window.createTreeView(LOCAL_WORK_VIEW, { treeDataProvider: provider, showCollapseAll: true }),
    vscode.commands.registerCommand(REFRESH, () => provider.refresh()),
    vscode.commands.registerCommand(CREATE_TICKET, guarded("localWork.createTicket", vscode.l10n.t("Could not create the ticket"), async (node) => {
      const projectId = await projectForNewTicket(node);
      if (!projectId) return;
      const title = await vscode.window.showInputBox({
        title: vscode.l10n.t("New local ticket"),
        prompt: vscode.l10n.t("What needs doing?"),
        validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t("A title is required")),
      });
      if (!title?.trim()) return;
      await repo.createTicket({ projectId, title });
    })),
    vscode.commands.registerCommand(SET_STATUS, guarded("localWork.setStatus", vscode.l10n.t("Could not change the status"), async (node) => {
      if (node?.kind !== "ticket") return;
      const status = await vscode.window.showQuickPick(
        LOCAL_TICKET_STATUSES.map((value) => ({
          label: ticketStatusText(value),
          value,
          description: value === node.workStatus ? vscode.l10n.t("current") : undefined,
        })),
        { title: vscode.l10n.t("Set ticket status") },
      );
      if (status) await repo.changeTicketStatus(node.id, status.value);
    })),
    vscode.commands.registerCommand(ARCHIVE, guarded("localWork.archive", vscode.l10n.t("Could not archive the ticket"), async (node) => {
      if (node?.kind === "ticket") await repo.setTicketArchived(node.id, true);
    })),
    vscode.commands.registerCommand(OPEN_CHAT, guarded("localWork.openChat", vscode.l10n.t("Could not open the chat"), async (node) => {
      if (node?.kind !== "ticket") return;
      const chat = boundChatOf(await app.durableStore.view(), node.id);
      if (!chat) {
        void vscode.window.showInformationMessage(vscode.l10n.t("This ticket is not tied to a chat on this device."));
        return;
      }
      await openWorkspace(context, { kind: "focus", chatId: chat.localChatId });
    })),
  );
}
