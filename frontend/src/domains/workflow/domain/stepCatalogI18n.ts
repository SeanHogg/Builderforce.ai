/**
 * The step catalog's own strings, in the reader's language.
 *
 * ── WHY AN ACCESSOR AND NOT A `labelKey` ON EVERY ROW ───────────────────────
 * `stepCatalog.ts` declares 182 `ConfigField.label`s and 82 `placeholder`s, and
 * `stepIntegrations.ts` declares 94 preset descriptions and 351 operation labels.
 * Threading a key through every one of those rows would double the catalog's
 * size and give a future author two things to keep in step — which is how the
 * node-kind labels came to be half-translated in the first place.
 *
 * So the KEY IS DERIVED from the English text, in exactly one place
 * ({@link i18nSlug}). A row keeps its English string as the source of both the
 * key and the fallback, and `stepCatalogI18n.test.ts` asserts that every
 * derived key exists in ALL FIVE catalogs — so a new field without a
 * translation fails the suite instead of quietly shipping English into zh, es,
 * fr and de.
 *
 * Proper nouns are deliberately NOT routed through here: "OpenAI", "Slack" and
 * "GitHub" are the same word in every locale, and a catalog entry for each would
 * be 400 rows of busywork that can only ever drift.
 */

/**
 * The catalog key for a piece of English UI text.
 *
 * Lower-cases, drops everything that is not a letter or digit, and camel-cases
 * the remainder — `'Model (blank = default)'` → `'modelBlankDefault'`. Stable
 * under punctuation edits, which is the common case; a REWORDING changes the
 * key, and the totality test then fails, which is the correct outcome (reworded
 * copy needs re-translating).
 */
export function i18nSlug(text: string): string {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return 'untitled';
  return words
    .map((word, index) => (index === 0
      ? word.toLowerCase()
      : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('')
    .slice(0, 60);
}

/** A translator over the `workflowBuilder` namespace, accepting a derived key. */
export type WorkflowBuilderTranslator = (key: string) => string;

/**
 * Is this string one the catalog may carry at all?
 *
 * next-intl parses `<name>` as a RICH-TEXT TAG, so a message containing one is
 * invalid unless the tag is closed and a renderer is supplied. Exactly one
 * catalog string trips that — the named-capture-group regex example
 * `e.g. (?<year>\d{4})-(?<month>\d{2})` — and it is a literal pattern, not
 * copy: there is nothing in it a translator would change. So it is not routed,
 * and both the accessor and the totality test agree on that by asking here.
 */
export function isRoutedCatalogString(text: string): boolean {
  return !text.includes('<');
}

/**
 * Translate `text` under `prefix`, falling back to the English source.
 *
 * The fallback is a safety net for a missing key at RUNTIME, not a licence to
 * ship one: `next-intl` throws on a missing message under its error handler, and
 * the totality test is what actually keeps the catalogs complete.
 */
function translated(t: WorkflowBuilderTranslator, prefix: string, text: string): string {
  if (!text || !isRoutedCatalogString(text)) return text;
  try {
    const value = t(`${prefix}.${i18nSlug(text)}`);
    return value && !value.includes(`${prefix}.`) ? value : text;
  } catch {
    return text;
  }
}

/** A config field's label, in the reader's language. */
export const configFieldLabel = (t: WorkflowBuilderTranslator, label: string): string =>
  translated(t, 'field', label);

/** A config field's placeholder, in the reader's language. */
export const configFieldPlaceholder = (t: WorkflowBuilderTranslator, placeholder?: string): string | undefined =>
  placeholder ? translated(t, 'placeholder', placeholder) : undefined;

/** An integration preset's one-line description. */
export const integrationDescription = (t: WorkflowBuilderTranslator, description: string): string =>
  translated(t, 'integrationDescription', description);

/** One operation on an integration preset ("Send a message", "List issues"…). */
export const integrationOperationLabel = (t: WorkflowBuilderTranslator, label: string): string =>
  translated(t, 'operation', label);
