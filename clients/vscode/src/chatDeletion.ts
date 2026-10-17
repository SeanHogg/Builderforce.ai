import * as vscode from "vscode";
import { attentionFor } from "./attention";
import { confirmDeleteInEditor } from "./confirmDeletionUi";

/**
 * The ONE confirm before a chat is deleted — the Sessions tree's `builderforce.deleteSession`
 * and the panel's history list (`chat.confirmDelete`) both ask it. Modal, and refused while
 * the chat has any live attention (running, awaiting input, a local run): deleting it would
 * orphan that run.
 */
export function confirmChatDelete(chatId: number, title: string): Promise<boolean> {
  return confirmDeleteInEditor(title.trim() || vscode.l10n.t("New chat"), attentionFor("chat", chatId) != null);
}
