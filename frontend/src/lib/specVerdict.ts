/**
 * Verdicts — a spec field's computed judgement, as a message key rather than as prose.
 *
 * Its own module rather than a section of `specObjects.ts` for one reason: it is one
 * concern with its own reader set. The spec primitive declares kinds and their fields;
 * this formats what a `verdict` derivation SAYS. The vocabularies that write verdicts
 * (founder, career, legal, operations, sell-motion, academic), the node body that
 * draws them and the model-facing snapshot all import it, and none of them needs the
 * other half of the primitive to do so. Keeping both halves in one file had pushed it
 * past the 800-line architecture limit.
 *
 * ── WHY A DERIVATION DOES NOT RETURN A SENTENCE ─────────────────────────────────
 * A `verdict` derivation used to build its English sentence in code — "No `account`
 * matches …", "Spend to date is 25% of …", "At risk — 2 overdue." — and the node body
 * drew that string to every locale. The field LABEL beside it was translated; the
 * judgement under it, which is the half a reader acts on, was not. Moving the sentence
 * into the catalog is the only fix that survives the next vocabulary: a derivation now
 * says WHICH judgement and WITH WHAT values, and the reader's locale supplies the words.
 *
 * ── ONE FORMATTER, TWO READERS ──────────────────────────────────────────────────
 * The card formats a descriptor in the viewer's language; the AI snapshot formats the
 * SAME descriptor in English (`specValueInEnglish`), so the model keeps reading the
 * sentences it always has. Both go through `formatSpecVerdict` — a second formatter
 * for the prompt would be how the card and the model come to disagree about what a
 * verdict says.
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────────
 * • A key resolves under `<namespace>.verdict.<key>`, where the namespace is the HOST
 *   kind's vocabulary — unless the descriptor names its own. That override exists for
 *   exactly one shape: a resolver one vocabulary owns and others reuse (`boardRefField`,
 *   carried by founder, legal and hiring kinds alike) keeps its sentences in the
 *   catalog ONCE, under the vocabulary that wrote it. Nested descriptors inherit the
 *   namespace their parent resolved in.
 * • Counts are ICU plurals in the catalog, never `n === 1 ? '' : 's'` in code.
 * • A VALUE may itself be a descriptor, or a list of strings/descriptors. A list value is
 *   formatted with the locale's own list formatter (`Intl.ListFormat`, type `unit`) —
 *   "A, B, C" in English — because the separator is locale data, not punctuation.
 * • A derivation may return a LIST of descriptors: that is several SENTENCES, joined
 *   with a space (with nothing in Chinese and Japanese, whose sentence punctuation
 *   carries its own spacing).
 * • Backticked identifiers (`reference`, `account`) are part of the model's vocabulary
 *   and stay verbatim in every language.
 */

import { createTranslator } from 'next-intl';
import { defaultMessages } from '@/i18n/catalog';

/** One value interpolated into a verdict: a literal, a nested verdict, or a list of either. */
export type SpecVerdictValue = string | number | SpecVerdict | readonly (string | SpecVerdict)[];

/** A computed judgement, as a catalog key and its values. See the module note above. */
export interface SpecVerdict {
  /** Key suffix under `<namespace>.verdict`. May be dotted (`obligation.mismatch`). */
  readonly key: string;
  readonly values?: Readonly<Record<string, SpecVerdictValue>>;
  /** Resolve under THIS vocabulary rather than the host kind's. See the rules above. */
  readonly namespace?: string;
}

/** What a worded derivation returns: one sentence, or several. */
export type SpecVerdictResult = SpecVerdict | readonly SpecVerdict[];

/** Build a verdict descriptor. The one constructor, so a derivation reads as a sentence. */
export function specVerdict(key: string, values?: SpecVerdict['values'], namespace?: string): SpecVerdict {
  return { key, ...(values ? { values } : {}), ...(namespace ? { namespace } : {}) };
}

const VERDICT_PROPERTIES: ReadonlySet<string> = new Set(['key', 'values', 'namespace']);

/** True for a single verdict descriptor. Strict about its shape, so a `bars` entry or a
 *  `{title, detail}` list row is never mistaken for one. */
export function isSpecVerdict(value: unknown): value is SpecVerdict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.key === 'string' && Object.keys(record).every((name) => VERDICT_PROPERTIES.has(name));
}

/** True for anything a worded derivation may return — one descriptor or a non-empty list. */
export function isSpecVerdictResult(value: unknown): value is SpecVerdictResult {
  return isSpecVerdict(value) || (Array.isArray(value) && value.length > 0 && value.every(isSpecVerdict));
}

/** A translator over FULL catalog paths — next-intl's root `t`, on either side. */
export type SpecVerdictTranslate = (key: string, values: Record<string, string | number>) => string;

const listFormats = new Map<string, Intl.ListFormat>();
function listFormatFor(locale: string): Intl.ListFormat {
  const cached = listFormats.get(locale);
  if (cached) return cached;
  const built = new Intl.ListFormat(locale, { type: 'unit', style: 'long' });
  listFormats.set(locale, built);
  return built;
}

/** What separates two verdict sentences in `locale`. */
function sentenceJoiner(locale: string): string {
  return /^(zh|ja)\b/i.test(locale) ? '' : ' ';
}

/**
 * THE verdict formatter — the card and the AI snapshot both format through this.
 *
 * `namespace` is the host kind's vocabulary; `translate` takes a full catalog path.
 */
export function formatSpecVerdict(
  value: SpecVerdictResult,
  namespace: string,
  translate: SpecVerdictTranslate,
  locale: string,
): string {
  const sentence = (verdict: SpecVerdict, inherited: string): string => {
    const resolvedNamespace = verdict.namespace ?? inherited;
    const values = Object.fromEntries(Object.entries(verdict.values ?? {})
      .map(([name, raw]) => [name, valueText(raw, resolvedNamespace)]));
    return translate(`${resolvedNamespace}.verdict.${verdict.key}`, values);
  };
  const valueText = (raw: SpecVerdictValue, inherited: string): string | number => {
    if (typeof raw === 'string' || typeof raw === 'number') return raw;
    if (isSpecVerdict(raw)) return sentence(raw, inherited);
    return listFormatFor(locale).format(raw.map((item) => (typeof item === 'string' ? item : sentence(item, inherited))));
  };
  const sentences: readonly SpecVerdict[] = isSpecVerdict(value) ? [value] : value;
  return sentences.map((entry) => sentence(entry, namespace)).join(sentenceJoiner(locale));
}

/** The English translator the model-facing path formats with. Built once, lazily: the
 *  default catalog is already in the bundle, so this costs a function, not a fetch. */
let englishTranslate: SpecVerdictTranslate | null = null;
function englishTranslator(): SpecVerdictTranslate {
  englishTranslate ??= createTranslator({ locale: 'en', messages: defaultMessages as never }) as unknown as SpecVerdictTranslate;
  return englishTranslate;
}

/** A verdict in ENGLISH — what the model reads, and what the tests assert against. */
export function formatSpecVerdictInEnglish(value: SpecVerdictResult, namespace: string): string {
  return formatSpecVerdict(value, namespace, englishTranslator(), 'en');
}

/**
 * A resolved field value as the MODEL reads it: a verdict becomes its English sentence,
 * anything else passes through untouched. The one place the prompt side formats.
 */
export function specValueInEnglish(value: unknown, namespace: string): unknown {
  return isSpecVerdictResult(value) ? formatSpecVerdictInEnglish(value, namespace) : value;
}
