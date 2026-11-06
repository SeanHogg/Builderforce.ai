/**
 * What the pack commands share (PRD 40): the `.bfpack` file filter, an error's message, and the
 * linked client + project the platform commands (upload, remove) act on.
 */

import * as vscode from "vscode";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import { getSelectedProject, type SelectedProject } from "../../projectState";
import { linkedKnowledgeClient } from "../knowledgeService";

export const PACK_FILTER: Record<string, string[]> = { [vscode.l10n.t("Knowledge Pack")]: ["bfpack"] };

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The linked client and project, or a localized warning and undefined when the editor is not signed in with a project selected. */
export function linkedProjectClient(context: vscode.ExtensionContext): { client: KnowledgeClient; project: SelectedProject } | undefined {
  const project = getSelectedProject();
  const client = project ? linkedKnowledgeClient(context.secrets) : undefined;
  if (!project || !client) {
    void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce: sign in and select a project to use knowledge packs."));
    return undefined;
  }
  return { client, project };
}
