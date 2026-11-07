/**
 * The copy of CONTENT TRANSLATION (PRD 42 · Part E) — the same strings on the web app,
 * Rovr and the VS Code webview. Hosts read them through `translationLabelsFrom` with
 * their catalog's lookup; `{language}` is the component's own token and stays literal.
 */
import { stringsFrom, type LabelLookup } from '../labelCatalog';

export interface TranslationLabels {
  /** "Translated from Spanish" — `{language}` is the detected language's display name. */
  translatedFrom: string;
  showOriginal: string;
  showTranslation: string;
  translating: string;
  /** Muted hint when nothing on this device (and no cloud) can translate. */
  needsTranslator: string;
  /** The hint's action, which opens the model picker's Download. */
  getTranslator: string;
}

export const DEFAULT_TRANSLATION_LABELS: TranslationLabels = {
  translatedFrom: 'Translated from {language}',
  showOriginal: 'Show original',
  showTranslation: 'Show translation',
  translating: 'Translating…',
  needsTranslator: "Translation needs this browser's built-in translator",
  getTranslator: 'Download',
};

export const TRANSLATION_LABEL_FIELDS = Object.keys(DEFAULT_TRANSLATION_LABELS) as ReadonlyArray<keyof TranslationLabels>;

/** Every field read at `translation.<field>` in the host's catalog, English where it has none. */
export function translationLabelsFrom(lookup: LabelLookup): TranslationLabels {
  return stringsFrom(DEFAULT_TRANSLATION_LABELS, lookup, 'translation.');
}
