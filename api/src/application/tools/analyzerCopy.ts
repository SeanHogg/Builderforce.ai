/**
 * Analyzer RESULT copy — the strings an analyzer composes inside `analyze()`.
 *
 * ── THE HOLE THIS FILLS ─────────────────────────────────────────────────────
 * `toolMessages.ts` localizes every tool DEFINITION, and the shared
 * questionnaire/quiz scorers already emit localized results because they score a
 * LOCALIZED tool — their result text is the tool's own section names and
 * advancement actions, so translating the definition translated the result too.
 *
 * An analyzer has no such luck. It composes its findings itself, in a pure
 * function that took nothing but the pasted document, so a French visitor saw a
 * translated résumé-scorer form and English findings under it. This module is the
 * seam that closes that: `analyze()` now takes a {@link ToolCopy} PARAMETER — not
 * an import-time global and not a fetch — so the function stays pure, testable and
 * safe to run on the public, no-account endpoint.
 *
 * ── IT IS THE SAME MECHANISM, NOT A SECOND ONE ──────────────────────────────
 * The keys are flat and structural and they live in the SAME four catalogs
 * (`toolMessages.{zh,es,fr,de}.ts`) as every other tool string, under:
 *
 *   tool.<id>.result.<slug>        — one analyzer's own result copy
 *   tool.shared.analyzer.<slug>    — copy more than one analyzer emits
 *
 * English is absent from the catalogs by design, exactly as it is for the
 * definitions: the analyzer declares its own English in `AnalyzerTool.copy`, and a
 * second copy of it here would be a second thing to update. The completeness test
 * derives its key set from that declaration, so a new analyzer string ships
 * translated or the build goes red.
 *
 * ── PLACEHOLDERS, AND WHY CONCATENATION IS BANNED ───────────────────────────
 * Interpolated values go through `{name}` placeholders rather than being
 * concatenated around a translated fragment. The failure that prevents is word
 * ORDER: `"Level " + n` is untranslatable into a language that puts the number
 * first, and `n + " skills are missing"` cannot agree in gender or number with the
 * noun in French or German. A sentence must be translatable as a whole sentence,
 * so the template carries the whole sentence and the numbers slot into it.
 *
 * Plural forms are two slugs (`<slug>.one` / `<slug>.other`) chosen by
 * {@link pluralSlug} rather than a full ICU parser. That is exactly enough for the
 * five locales served: en/es/fr/de distinguish one from many, zh distinguishes
 * nothing, and no supported locale needs the few/many categories a parser would
 * buy. Adding a Slavic locale is the day this becomes ICU.
 */

/**
 * A lookup bound to ONE analyzer and ONE locale.
 *
 * Callable for the analyzer's own result copy; `option()` reaches the analyzer's
 * own select-option labels so a result that echoes a chosen option cannot drift
 * from the form above it; `locale` is exposed because number and currency
 * formatting is part of reading a result in your own language — a German reader
 * expects `150.000`, not `150,000`.
 */
export interface ToolCopy {
  (slug: string, vars?: CopyVars): string;
  /** The localized label of one of THIS analyzer's select options. */
  option(fieldId: string, value: string): string;
  /** The locale this lookup is bound to — for `toLocaleString` and friends. */
  locale: string;
}

export type CopyVars = Readonly<Record<string, string | number>>;

/** `tool.<id>.result.<slug>` — one analyzer's own result copy. */
export const analyzerResultKey = (toolId: string, slug: string): string => `tool.${toolId}.result.${slug}`;

/** `tool.shared.analyzer.<slug>` — copy more than one analyzer emits. */
export const sharedAnalyzerKey = (slug: string): string => `tool.shared.analyzer.${slug}`;

/**
 * Copy every analyzer emits, declared once.
 *
 * The bar for entry is "more than one analyzer says it". Seventeen private copies
 * of "Nothing to read yet" would be seventeen chances to translate one sentence
 * seventeen different ways, which is the failure the shared namespace prevents.
 * Anything only ONE analyzer says stays in that analyzer's own `copy` map, where
 * it is read next to the code that emits it.
 */
export const SHARED_ANALYZER_COPY: Readonly<Record<string, string>> = {
  nothingToRead: 'Nothing to read yet',
  howToUseThis: 'How to use this',
  andMore: '+{n} more',
  none: 'None',
  areaCoverage: '{matched} of {required} matched',
  // The four match verdicts. Emitted by the tailor AND the job–résumé match, and
  // used as a scoreLabel by both, so they are shared rather than duplicated.
  'verdict.strong': 'Strong fit',
  'verdict.worth_applying': 'Worth applying',
  'verdict.stretch': 'A stretch',
  'verdict.poor_fit': 'Poor fit',
};

/**
 * Substitute `{name}` placeholders. An unknown placeholder is left verbatim
 * rather than blanked: a visible `{weeks}` in a result is a bug report, while a
 * silently empty gap in a sentence reads as a product that lost the number.
 */
export function interpolate(template: string, vars?: CopyVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * The slug for a counted phrase: `<slug>.one` at exactly one, `<slug>.other`
 * otherwise. Zero takes `.other` — English says "0 edits", and so do the four
 * other locales served.
 */
export function pluralSlug(slug: string, n: number): string {
  return `${slug}.${n === 1 ? 'one' : 'other'}`;
}

/**
 * Normalize a domain enum VALUE into a key segment: `poor fit` → `poor_fit`.
 *
 * The career domain spells several of its enums as prose (`'ready now'`,
 * `'this quarter'`, `'worth applying'`) because they were written to be read.
 * They still have to be translated, and a catalog key containing a space is a key
 * nobody can grep for, so the value is slugified on the way to the lookup and the
 * domain is left alone.
 */
export function enumSlug(prefix: string, value: string): string {
  return `${prefix}.${value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}
