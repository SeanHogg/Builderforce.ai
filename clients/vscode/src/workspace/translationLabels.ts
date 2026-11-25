/**
 * THE editor's copy for content translation (PRD 42 · Part E) — the shared
 * `<TranslatableText>`'s strings, posted to the webview in the label bundle under
 * `translation.<field>` (the keys brain-ui's `translationLabelsFrom` reads). Typed as
 * brain-ui's `TranslationLabels`, so a field the component gains is a compile error here
 * rather than a silently English line. Type-only import: the extension host never bundles
 * brain-ui's React.
 */
import * as vscode from "vscode";
import type { TranslationLabels } from "@seanhogg/builderforce-brain-ui";

function translationCopy(): TranslationLabels {
  const t = vscode.l10n.t;
  return {
    // `{0}` is handed back as the component's own `{language}` token.
    translatedFrom: t("Translated from {0}", "{language}"),
    showOriginal: t("Show original"),
    showTranslation: t("Show translation"),
    translating: t("Translating…"),
    needsTranslator: t("Translation needs this browser's built-in translator"),
    getTranslator: t("Download"),
  };
}

export function translationLabels(): Record<string, string> {
  const copy = translationCopy();
  return Object.fromEntries(Object.entries(copy).map(([field, value]) => [`translation.${field}`, value]));
}
