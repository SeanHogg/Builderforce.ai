import * as vscode from "vscode";

/**
 * The words for the project-type registry (`@builderforce/ide-templates/project-types`). The
 * registry holds KEYS because the package has no i18n; this is the ONE map from a key to the
 * editor's language. Each literal is a `vscode.l10n.t` call so the string is extractable and
 * lives in `l10n/bundle.l10n*.json`. A key the map does not know resolves to itself, which
 * the registry test (`newAiProject.test.ts`) fails on, so a new registry entry cannot ship
 * unworded.
 */
const TEXT: Record<string, () => string> = {
  "projectType.aiScratch.label": () => vscode.l10n.t("Start from scratch"),
  "projectType.aiScratch.description": () => vscode.l10n.t("Grow a new Evermind model that learns from your project."),
  "projectType.aiExisting.label": () => vscode.l10n.t("Improve an existing model"),
  "projectType.aiExisting.description": () => vscode.l10n.t("Pick a local or your own model, then fine-tune it in the Finetune studio."),
  "projectType.aiKnowledgePack.label": () => vscode.l10n.t("Knowledge pack"),
  "projectType.aiKnowledgePack.description": () => vscode.l10n.t("Create a knowledge pack from your code, or load one you already have."),
  "projectType.aiKnowledgePack.choice": () => vscode.l10n.t("What do you want to do with the knowledge pack?"),
  "projectType.aiKnowledgePack.create": () => vscode.l10n.t("Create a knowledge pack"),
  "projectType.aiKnowledgePack.load": () => vscode.l10n.t("Load a knowledge pack"),
};

/** The registry keys this map words. */
export const PROJECT_TYPE_TEXT_KEYS: readonly string[] = Object.keys(TEXT);

/** A registry key in the editor's language (the key itself when unknown). */
export function projectTypeText(key: string): string {
  return TEXT[key]?.() ?? key;
}
