/**
 * Localized copy for the Visualization panel's view switch — Knowledge, Canvas, Changes —
 * merged into the panel's label bundle like every other host string (`workspaceInit.ts`).
 * The Knowledge view's own copy is the web's `knowledgeGraph.*` catalog, read in the
 * webview through the ONE labels adapter (`frontend/src/lib/knowledge/labels.ts`).
 */

import * as vscode from "vscode";

export function knowledgeViewLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "viz.views": t("Visualization views"),
    "viz.button.knowledge": t("Knowledge"),
    "viz.button.canvas": t("Canvas"),
    "viz.button.changes": t("Changes"),
    "viz.showKnowledge": t("Show what this workspace knows: its knowledge graph"),
    "viz.showCanvas": t("Back to the Creation Canvas"),
    "viz.showChanges": t("Show the code changes this run made"),
  };
}
