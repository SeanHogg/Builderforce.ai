/**
 * Server-side i18n for the Diagnostics & Tools registry.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * Every other user-facing surface on the platform is translated: the frontend
 * runs next-intl over five catalogs, and transactional email renders through
 * `emailMessages.ts`. The tools were the hole in that. Their content — the
 * name, the tagline, the "what this measures" paragraph, every questionnaire
 * statement, every advancement action — is not frontend copy and not email
 * copy: it is DATA the API serves from `toolDefinitions.ts`, and it was served
 * in English to everyone. A French workspace could switch the whole product to
 * French and still be asked, in English, whether "the team limits
 * work-in-progress". Worse, the free logged-out diagnostics are the platform's
 * front door — the one page a visitor sees before they have an account.
 *
 * ── THE SHAPE, AND WHY ENGLISH IS NOT IN HERE ───────────────────────────────
 * The catalog holds the FOUR non-English locales. English is not duplicated,
 * because `toolDefinitions.ts` already IS the English copy — and a second copy
 * of it here would be a second thing to update, which is how a tool ends up
 * saying one thing to an English reader and a stale other thing to everyone
 * else. Localization is therefore a projection: walk a definition, and for each
 * string swap in the translation for its structural key.
 *
 * Completeness is enforced by `toolMessages.test.ts`, which derives the key set
 * from the live registry and fails the build when any locale is missing one.
 * That is the same guarantee `emailMessages.ts` gets from its exhaustive
 * interface, arrived at differently because these keys are generated from data
 * rather than declared: a new tool must ship translated or the build goes red.
 *
 * ── KEYS ────────────────────────────────────────────────────────────────────
 * Structural, derived from the definition itself, never hand-assigned:
 *
 *   tool.<id>.name | .tagline | .about
 *   tool.<id>.input.<inputId>.label | .unit | .help | .option.<value>
 *   tool.<id>.scale.<value>
 *   tool.<id>.section.<key>.name | .description
 *   tool.<id>.q.<questionId>
 *   tool.<id>.rec.<sectionKey>.<level>
 *   tool.<id>.level.<n>.name | .summary | .advance
 *   tool.<id>.quiz.<questionId>.dimension | .text | .option.<level>
 *   tool.<id>.field.<fieldId>.label | .placeholder | .help | .option.<value>
 *   tool.<id>.result.<slug>      — the findings an ANALYZER composes itself
 *   tool.shared.analyzer.<slug>  — analyzer copy more than one of them emits
 *   result.*   — the chrome the SHARED scorers emit around a tool's own copy
 *
 * A key with no translation falls back to the English in the definition. That
 * fallback is a safety net for a locale that somehow escaped narrowing, NOT a
 * workflow: the test makes an untranslated key a build failure, so nothing
 * reaches it in practice.
 */

import {
  SHARED_ANALYZER_COPY,
  analyzerResultKey,
  interpolate,
  sharedAnalyzerKey,
  type CopyVars,
  type ToolCopy,
} from './analyzerCopy';
import { localeFromHeaders } from '../../infrastructure/email/emailLocale';
import { DEFAULT_TOOL_LOCALE, type ToolLocale } from './resultCopy';
import { TOOL_MESSAGES_ZH } from './toolMessages.zh';
import { TOOL_MESSAGES_ES } from './toolMessages.es';
import { TOOL_MESSAGES_FR } from './toolMessages.fr';
import { TOOL_MESSAGES_DE } from './toolMessages.de';
import type {
  AnalyzerField,
  CalculatorInput,
  QuestionnaireSection,
  QuizLevel,
  QuizQuestion,
  ScaleAnchor,
  Tool,
} from './toolTypes';

/**
 * The locale a tool is rendered in — the SAME five the frontend and email serve
 * (`infrastructure/email/emailLocale.ts`). Re-exported here so a caller doing
 * tool localization imports one module, not two.
 */
export { DEFAULT_TOOL_LOCALE, type ToolLocale } from './resultCopy';

/**
 * The language a request is asking for, narrowed to a locale the tools can be
 * rendered in.
 *
 * Lives in the APPLICATION layer, not in the route, for two reasons. The route
 * layer must not reach into `infrastructure/` (the layering guard enforces it),
 * and more importantly the chain itself is a decision — explicit header, then
 * the NEXT_LOCALE cookie, then `Accept-Language` — that email already makes the
 * same way. Two copies of that chain is two chances to order it differently and
 * serve a visitor a diagnostic in a language they did not pick.
 */
export function toolLocaleFromHeaders(hints: {
  explicit?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): ToolLocale {
  return localeFromHeaders(hints) ?? DEFAULT_TOOL_LOCALE;
}

/** Flat, structural-key → translated string. */
export type ToolMessages = Readonly<Record<string, string>>;

/** English is absent by design: the definitions are the English copy. */
const CATALOGS: Partial<Record<ToolLocale, ToolMessages>> = {
  zh: TOOL_MESSAGES_ZH,
  es: TOOL_MESSAGES_ES,
  fr: TOOL_MESSAGES_FR,
  de: TOOL_MESSAGES_DE,
};

/** Every locale this module can actually translate into (English excluded — it
 *  needs no translation). Exported so the completeness test enumerates the same
 *  set the runtime does. */
export const TRANSLATED_TOOL_LOCALES = Object.keys(CATALOGS) as ToolLocale[];

/**
 * A lookup bound to one locale: `t(key, englishFallback)`.
 *
 * Returns the English it was handed when the key is absent, so a partially
 * translated catalog degrades string by string rather than rendering `undefined`
 * into a public page.
 */
export type ToolTranslator = (key: string, english: string) => string;

export function toolTranslator(locale: ToolLocale): ToolTranslator {
  const catalog = CATALOGS[locale];
  if (!catalog) return (_key, english) => english;
  return (key, english) => catalog[key] ?? english;
}

/**
 * The raw catalog for a locale, or undefined for one that needs none (English).
 *
 * Exists so completeness can be asserted on KEY PRESENCE rather than on "the
 * translation differs from the English". Those are not the same question, and
 * the second one is wrong: `%`, `$`, `Initial`, `Remote` and `Northwind` are
 * correct in several of these languages unchanged, so a difference test would
 * demand that a translator make them worse to satisfy the build.
 */
export function toolCatalog(locale: ToolLocale): ToolMessages | undefined {
  return CATALOGS[locale];
}

// ── Structural key builders ──────────────────────────────────────────────────
// One definition of every key shape, used by the localizer, by the extractor the
// completeness test walks, and by any future translation tooling. Two hand-built
// key strings in two places is how a translation lands under a key nothing reads.

export const toolKey = {
  name: (id: string) => `tool.${id}.name`,
  tagline: (id: string) => `tool.${id}.tagline`,
  about: (id: string) => `tool.${id}.about`,
  inputLabel: (id: string, input: string) => `tool.${id}.input.${input}.label`,
  inputUnit: (id: string, input: string) => `tool.${id}.input.${input}.unit`,
  inputHelp: (id: string, input: string) => `tool.${id}.input.${input}.help`,
  inputOption: (id: string, input: string, value: number) => `tool.${id}.input.${input}.option.${value}`,
  scale: (id: string, value: number) => `tool.${id}.scale.${value}`,
  sectionName: (id: string, key: string) => `tool.${id}.section.${key}.name`,
  sectionDescription: (id: string, key: string) => `tool.${id}.section.${key}.description`,
  question: (id: string, question: string) => `tool.${id}.q.${question}`,
  recommendation: (id: string, section: string, level: string | number) => `tool.${id}.rec.${section}.${level}`,
  levelName: (id: string, level: number) => `tool.${id}.level.${level}.name`,
  levelSummary: (id: string, level: number) => `tool.${id}.level.${level}.summary`,
  levelAdvance: (id: string, level: number) => `tool.${id}.level.${level}.advance`,
  quizDimension: (id: string, question: string) => `tool.${id}.quiz.${question}.dimension`,
  quizText: (id: string, question: string) => `tool.${id}.quiz.${question}.text`,
  quizOption: (id: string, question: string, level: number) => `tool.${id}.quiz.${question}.option.${level}`,
  fieldLabel: (id: string, field: string) => `tool.${id}.field.${field}.label`,
  fieldPlaceholder: (id: string, field: string) => `tool.${id}.field.${field}.placeholder`,
  fieldHelp: (id: string, field: string) => `tool.${id}.field.${field}.help`,
  fieldOption: (id: string, field: string, value: string) => `tool.${id}.field.${field}.option.${value}`,
  /** One analyzer's own result copy. Re-exported from `analyzerCopy.ts` so the
   *  key has ONE definition even though two modules build it. */
  result: analyzerResultKey,
  sharedAnalyzer: sharedAnalyzerKey,
} as const;

// ── Localizers ───────────────────────────────────────────────────────────────

function localizeInputs(id: string, inputs: CalculatorInput[], t: ToolTranslator): CalculatorInput[] {
  return inputs.map((i) => ({
    ...i,
    label: t(toolKey.inputLabel(id, i.id), i.label),
    ...(i.unit ? { unit: t(toolKey.inputUnit(id, i.id), i.unit) } : {}),
    ...(i.help ? { help: t(toolKey.inputHelp(id, i.id), i.help) } : {}),
    ...(i.options ? { options: i.options.map((o) => ({ ...o, label: t(toolKey.inputOption(id, i.id, o.value), o.label) })) } : {}),
  }));
}

function localizeScale(id: string, scale: ScaleAnchor[], t: ToolTranslator): ScaleAnchor[] {
  return scale.map((a) => ({ ...a, label: t(toolKey.scale(id, a.value), a.label) }));
}

function localizeSections(id: string, sections: QuestionnaireSection[], t: ToolTranslator): QuestionnaireSection[] {
  return sections.map((s) => ({
    ...s,
    name: t(toolKey.sectionName(id, s.key), s.name),
    description: t(toolKey.sectionDescription(id, s.key), s.description),
    questions: s.questions.map((q) => ({ ...q, text: t(toolKey.question(id, q.id), q.text) })),
    recommendations: Object.fromEntries(
      Object.entries(s.recommendations).map(([level, text]) => [level, t(toolKey.recommendation(id, s.key, level), text)]),
    ) as Record<number, string>,
  }));
}

function localizeLevels(id: string, levels: QuizLevel[], t: ToolTranslator): QuizLevel[] {
  return levels.map((l) => ({
    ...l,
    name: t(toolKey.levelName(id, l.level), l.name),
    summary: t(toolKey.levelSummary(id, l.level), l.summary),
    advance: t(toolKey.levelAdvance(id, l.level), l.advance),
  }));
}

function localizeQuizQuestions(id: string, questions: QuizQuestion[], t: ToolTranslator): QuizQuestion[] {
  return questions.map((q) => ({
    ...q,
    dimension: t(toolKey.quizDimension(id, q.id), q.dimension),
    text: t(toolKey.quizText(id, q.id), q.text),
    options: q.options.map((o) => ({ ...o, text: t(toolKey.quizOption(id, q.id, o.level), o.text) })),
  }));
}

function localizeFields(id: string, fields: AnalyzerField[], t: ToolTranslator): AnalyzerField[] {
  return fields.map((f) => ({
    ...f,
    label: t(toolKey.fieldLabel(id, f.id), f.label),
    ...(f.placeholder ? { placeholder: t(toolKey.fieldPlaceholder(id, f.id), f.placeholder) } : {}),
    ...(f.help ? { help: t(toolKey.fieldHelp(id, f.id), f.help) } : {}),
    ...(f.options ? { options: f.options.map((o) => ({ ...o, label: t(toolKey.fieldOption(id, f.id, o.value), o.label) })) } : {}),
  }));
}

/**
 * A TOOL with every user-facing string swapped for the locale's.
 *
 * Returns a `Tool`, not a `ToolDefinition`, so the SCORERS can run against it —
 * which is what makes a questionnaire's RESULT localized without a second
 * translation pass. A questionnaire result is built from the tool's own section
 * names and advancement actions; score the localized tool and they come out in
 * the reader's language, from the same catalog entry the question came from.
 * The compute/score functions are carried across untouched (they are code).
 */
export function localizeTool<T extends Tool>(tool: T, locale: ToolLocale): T {
  if (locale === DEFAULT_TOOL_LOCALE) return tool;
  const t = toolTranslator(locale);
  const base = {
    name: t(toolKey.name(tool.id), tool.name),
    tagline: t(toolKey.tagline(tool.id), tool.tagline),
    about: t(toolKey.about(tool.id), tool.about),
  };
  // Generic in T, and each branch casts back to it. The function is
  // kind-PRESERVING by construction — every branch spreads its own input and
  // replaces only string fields — but TypeScript cannot see that a
  // `QuestionnaireTool` in yields a `QuestionnaireTool` out through a switch on
  // the discriminant. Returning a bare `Tool` instead would push the cast onto
  // every caller, and a caller casting a tool to the kind it "should" be is how
  // a scorer ends up run against the wrong shape.
  switch (tool.kind) {
    case 'calculator':
      return { ...tool, ...base, inputs: localizeInputs(tool.id, tool.inputs, t) } as T;
    case 'questionnaire':
      return {
        ...tool, ...base,
        scale: localizeScale(tool.id, tool.scale, t),
        sections: localizeSections(tool.id, tool.sections, t),
      } as T;
    case 'quiz':
      return {
        ...tool, ...base,
        levels: localizeLevels(tool.id, tool.levels, t),
        questions: localizeQuizQuestions(tool.id, tool.questions, t),
      } as T;
    case 'analyzer':
      return { ...tool, ...base, fields: localizeFields(tool.id, tool.fields, t) } as T;
  }
}

/** Every key a tool's definition needs translated, with its English source. Used
 *  by the completeness test and by the localizer's own key builders, so the two
 *  can never disagree about what "fully translated" means. */
export function toolMessageEntries(tool: Tool): Array<[key: string, english: string]> {
  const entries: Array<[string, string]> = [
    [toolKey.name(tool.id), tool.name],
    [toolKey.tagline(tool.id), tool.tagline],
    [toolKey.about(tool.id), tool.about],
  ];
  if (tool.kind === 'calculator') {
    for (const i of tool.inputs) {
      entries.push([toolKey.inputLabel(tool.id, i.id), i.label]);
      if (i.unit) entries.push([toolKey.inputUnit(tool.id, i.id), i.unit]);
      if (i.help) entries.push([toolKey.inputHelp(tool.id, i.id), i.help]);
      for (const o of i.options ?? []) entries.push([toolKey.inputOption(tool.id, i.id, o.value), o.label]);
    }
  }
  if (tool.kind === 'questionnaire') {
    for (const a of tool.scale) entries.push([toolKey.scale(tool.id, a.value), a.label]);
    for (const s of tool.sections) {
      entries.push([toolKey.sectionName(tool.id, s.key), s.name]);
      entries.push([toolKey.sectionDescription(tool.id, s.key), s.description]);
      for (const q of s.questions) entries.push([toolKey.question(tool.id, q.id), q.text]);
      for (const [level, text] of Object.entries(s.recommendations)) {
        entries.push([toolKey.recommendation(tool.id, s.key, level), text]);
      }
    }
  }
  if (tool.kind === 'quiz') {
    for (const l of tool.levels) {
      entries.push([toolKey.levelName(tool.id, l.level), l.name]);
      entries.push([toolKey.levelSummary(tool.id, l.level), l.summary]);
      entries.push([toolKey.levelAdvance(tool.id, l.level), l.advance]);
    }
    for (const q of tool.questions) {
      entries.push([toolKey.quizDimension(tool.id, q.id), q.dimension]);
      entries.push([toolKey.quizText(tool.id, q.id), q.text]);
      for (const o of q.options) entries.push([toolKey.quizOption(tool.id, q.id, o.level), o.text]);
    }
  }
  if (tool.kind === 'analyzer') {
    for (const f of tool.fields) {
      entries.push([toolKey.fieldLabel(tool.id, f.id), f.label]);
      if (f.placeholder) entries.push([toolKey.fieldPlaceholder(tool.id, f.id), f.placeholder]);
      if (f.help) entries.push([toolKey.fieldHelp(tool.id, f.id), f.help]);
      for (const o of f.options ?? []) entries.push([toolKey.fieldOption(tool.id, f.id, o.value), o.label]);
    }
  }
  // Result prose the tool's OWN CODE composes — an analyzer's findings, or a
  // data provider's telemetry narration. This is the half a definition-only
  // translation could never reach, and it is walked for every kind because both
  // of those live behind the same declaration.
  for (const [slug, english] of Object.entries(tool.copy ?? {})) {
    entries.push([toolKey.result(tool.id, slug), english]);
  }
  return entries;
}


// ── Analyzer result copy ─────────────────────────────────────────────────────

/**
 * The copy lookup an analyzer's `analyze()` is handed.
 *
 * Resolution is deliberate and only two steps deep: a slug the analyzer DECLARES
 * resolves under its own key, anything else falls back to the shared analyzer
 * namespace, and each step ends at the English the declaration carries. That
 * ordering is what lets one analyzer override a shared sentence without a flag,
 * and it means an undeclared slug still renders its own name rather than
 * `undefined` — a visible `nothingToRead` in a result is a bug report, an empty
 * headline is a product that looks broken.
 */
export function toolCopy(tool: Tool, locale: ToolLocale): ToolCopy {
  const t = toolTranslator(locale);
  const declared = tool.copy ?? {};
  const copy = ((slug: string, vars?: CopyVars): string => {
    const own = declared[slug];
    const template = own !== undefined
      ? t(toolKey.result(tool.id, slug), own)
      : t(toolKey.sharedAnalyzer(slug), SHARED_ANALYZER_COPY[slug] ?? slug);
    return interpolate(template, vars);
  }) as ToolCopy;
  copy.option = (fieldId: string, value: string): string => {
    // Only an analyzer has string-valued select fields; every other kind answers
    // with the value it was handed rather than pretending to a label it has none
    // of, so one lookup type serves all four kinds.
    const field = tool.kind === 'analyzer' ? tool.fields.find((f) => f.id === fieldId) : undefined;
    const english = field?.options?.find((o) => o.value === value)?.label ?? value;
    return t(toolKey.fieldOption(tool.id, fieldId, value), english);
  };
  copy.locale = locale;
  return copy;
}

/**
 * The shared analyzer namespace as catalog entries.
 *
 * Exported for the completeness test, which asserts key PRESENCE over a set
 * derived from the live registry. These keys belong to no tool, so they cannot
 * come out of `toolMessageEntries` — without this they would be the one corner of
 * the catalog nothing checked, which is exactly where an untranslated string
 * survives to production.
 */
export function sharedAnalyzerEntries(): Array<[key: string, english: string]> {
  return Object.entries(SHARED_ANALYZER_COPY).map(([slug, english]) => [toolKey.sharedAnalyzer(slug), english]);
}

// The chrome the shared scorers emit lives in `resultCopy.ts`, imported by
// `toolTypes.ts` itself — it must not live here, because this module imports
// `toolTypes` for its structural types and the cycle would be a real one.
export { resultCopy, type ResultCopy } from './resultCopy';
