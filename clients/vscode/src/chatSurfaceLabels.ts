/**
 * Localized copy for the chat surface's shared chrome — the header's History lever, the
 * chat-history rows (brain-ui `ChatHistoryList` / `ChatHistoryRow`, which replaced the
 * native chat `<select>`) and the empty state's greeting and starters (brain-ui
 * `SurfaceEmptyState`). Merged into the panel's label bundle like `authLabels` and
 * `chatTicketsLabels`; its own module so the panel does not grow for it.
 *
 * The starter tiles reuse the composer's `app.suggest*` keys (one fixed list, two places
 * it shows), so only the empty state's own lines are declared here. `{title}` is filled
 * by the renderer, not by l10n.
 */

import * as vscode from "vscode";

export function chatSurfaceLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "app.historyShow": t("Chat history"),
    "app.historyHide": t("Back to the chat"),
    "app.historyLoading": t("Loading…"),
    "app.historyEmpty": t("No chats yet"),
    "app.chatActions": t("Chat actions"),
    "app.chatActionsAria": t("Actions for {title}"),
    "app.chatRunning": t("Running"),
    "app.chatAwaiting": t("Needs an answer"),
    "app.chatSummarize": t("Summarize"),
    "app.chatDelete": t("Delete"),
    "app.emptyTitle": t("What are we working on?"),
    "app.emptyHint": t("Ask about this workspace, or start from one of these."),
    "app.startersHeading": t("Start with"),
  };
}
