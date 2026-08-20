/**
 * Generic Diagnostics & Tools engine — types.
 *
 * Each free tool is mostly DATA (a definition served from a public endpoint) plus
 * a pure compute/score function (code, never sent to the client). One generic
 * runner UI renders any definition; one public `compute` endpoint runs any tool.
 * This is the shared rail behind the suite of free, no-login diagnostics — the
 * "free to preview, account to save" pattern established by the Maturity
 * Diagnostic, generalized so adding a tool is data, not a new page.
 *
 * Pure (no DB/IO) so every tool is unit-testable and the definition is safe to
 * serve verbatim to logged-out visitors.
 */

import type { ToolCopy } from './analyzerCopy';
import { DEFAULT_TOOL_LOCALE, resultCopy, type ResultCopy } from './resultCopy';

export type ToolCategory = 'delivery' | 'finops' | 'governance' | 'quality' | 'career';
export type ToolKind = 'calculator' | 'questionnaire' | 'quiz' | 'analyzer';

// ── Shared result shape (rendered by one generic ToolResultView) ──────────────

export interface ToolMetric {
  label: string;
  value: string;
  /** Optional band/explanation under the value. */
  hint?: string;
  /** 1..5 tier for a colored meter (optional). */
  tier?: number;
  /**
   * Stable identity of what this row measures — a questionnaire section key, a
   * quiz dimension id — independent of its display label.
   *
   * It exists so a result can be RE-GROUPED without re-scoring: the maturity
   * framework lens (COBIT / ITIL) folds these rows into a different taxonomy, and
   * matching on the human label would have meant a lens that broke the moment a
   * section was renamed or translated. Optional, because a metric that is a
   * one-off figure ("Window", "Agent LLM calls") has nothing stable to identify.
   */
  key?: string;
}

export interface ToolRecommendation {
  title: string;
  detail: string;
  /**
   * How much this one matters. The career analyzers rank their findings, and a
   * ranked list rendered without its ranking reads as a flat to-do list — which
   * is exactly the failure the ordering exists to prevent. Absent on the
   * questionnaire and quiz scorers, whose plans are already ordered by level.
   */
  priority?: 'high' | 'medium' | 'low';
}

export interface ToolResult {
  /** Big headline verdict, e.g. "High performer" or "$4,250 / month". */
  headline: string;
  /** Optional supporting line under the headline. */
  summary?: string;
  /** Optional 0..5 overall score for a meter. */
  score?: number | null;
  scoreLabel?: string | null;
  /** Breakdown rows. */
  metrics: ToolMetric[];
  /** The prioritized "what to do next" plan — the innovation output. */
  recommendations: ToolRecommendation[];
}

// ── Calculator tools ──────────────────────────────────────────────────────────

export interface CalculatorInput {
  id: string;
  label: string;
  type: 'number' | 'select';
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  default: number;
  /** For type:'select' — options map an index value to a label. */
  options?: Array<{ value: number; label: string }>;
  help?: string;
}

// ── Questionnaire tools ───────────────────────────────────────────────────────

export interface QuestionnaireQuestion {
  id: string;
  text: string;
}

export interface QuestionnaireSection {
  key: string;
  name: string;
  description: string;
  questions: QuestionnaireQuestion[];
  /** Advancement actions keyed by target level (2..5); the plan surfaces level+1. */
  recommendations: Record<number, string>;
}

export interface ScaleAnchor {
  value: number;
  label: string;
}

// ── Quiz tools ────────────────────────────────────────────────────────────────
// A maturity quiz: each question is one DIMENSION with a single-select set of
// full-prose answers, where each answer maps to a maturity level (1..N). Unlike a
// questionnaire (rate every statement on one shared scale), the quiz picks the
// statement that best fits — the level-band model behind "what's your maturity
// level" assessments. Scored by scoreQuiz.

export interface QuizOption {
  /** The maturity level (1..N) this answer represents. Distinct per question. */
  level: number;
  /** The full-sentence answer shown to the user. */
  text: string;
}

export interface QuizQuestion {
  id: string;
  /** Short label for the dimension (used as the breakdown row + question eyebrow). */
  dimension: string;
  /** The prompt. */
  text: string;
  /** Answers, ordered low→high level; each maps to a distinct level. */
  options: QuizOption[];
}

export interface QuizLevel {
  level: number;
  /** The level's name, e.g. "Parallel agentic delivery". */
  name: string;
  /** Narrative shown as the result summary when this level is the verdict. */
  summary: string;
  /** What it takes to advance to the next level (surfaced in the plan). */
  advance: string;
}

// ── Analyzer tools ────────────────────────────────────────────────────────────
// Read a DOCUMENT and score it. The other three kinds all score a set of numbers
// the person picked from choices we wrote; an analyzer scores prose they wrote
// themselves, which is why its input map is string-valued rather than numeric.
//
// The scoring stays pure and deterministic — no model call. That is the same
// argument `careerToolCatalog.ts` makes for the MCP rows over these functions:
// a résumé score that moves when you ask twice is a number people rewrite their
// documents to chase, and it cannot be unit-tested.

export interface AnalyzerField {
  id: string;
  label: string;
  /** `document` is a long paste (résumé, job description); `line` is one value. */
  type: 'document' | 'line' | 'select';
  placeholder?: string;
  help?: string;
  /** False for the optional second document (e.g. the JD on a résumé scorer). */
  required?: boolean;
  /** For type:'select'. */
  options?: Array<{ value: string; label: string }>;
}

export interface AnalyzerTool extends ToolBase {
  kind: 'analyzer';
  fields: AnalyzerField[];
  /**
   * REQUIRED here, unlike every other kind: an analyzer composes all of its own
   * prose, so without a declared copy map it has nothing to translate against.
   *
   * Server-side only — deliberately absent from `ToolDefinition`, because the
   * client never composes a result and shipping the templates would be shipping
   * the scoring prose to a page that has no use for it.
   */
  copy: Readonly<Record<string, string>>;
  /**
   * Score a document. STILL PURE — `copy` is a parameter, never an import-time
   * global and never a fetch, so the same paste scores identically in every
   * language and the function is unit-testable without a locale registry.
   */
  analyze: (values: Record<string, string>, copy: ToolCopy) => ToolResult;
}

// ── Tool definition (discriminated by kind) ───────────────────────────────────

interface ToolBase {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  category: ToolCategory;
  /** A one-paragraph "what this measures / why it matters". */
  about: string;
  /**
   * The ENGLISH source for result prose this tool's own code composes, by slug.
   *
   * A questionnaire rarely needs one — its result IS its translated section names
   * and advancement actions, so translating the definition translated the result.
   * The two kinds that DO need one are the analyzers (which compose findings in
   * their own function) and the four tools with a telemetry-derived data mode
   * (whose provider in `toolDataProviders.ts` composes prose the definition never
   * carried). Both read it through `toolMessages.toolCopy`, and the completeness
   * test derives its key set from it, so a new sentence ships translated or the
   * build goes red.
   */
  copy?: Readonly<Record<string, string>>;
}

export interface CalculatorTool extends ToolBase {
  kind: 'calculator';
  inputs: CalculatorInput[];
  compute: (values: Record<string, number>) => ToolResult;
}

export interface QuestionnaireTool extends ToolBase {
  kind: 'questionnaire';
  scale: ScaleAnchor[];
  sections: QuestionnaireSection[];
  score: (answers: Record<string, number>) => ToolResult;
}

export interface QuizTool extends ToolBase {
  kind: 'quiz';
  /** Ordered level definitions (names + narratives), 1..N. */
  levels: QuizLevel[];
  questions: QuizQuestion[];
  /** Answers map question id → the chosen option's level. */
  score: (answers: Record<string, number>) => ToolResult;
}

export type Tool = CalculatorTool | QuestionnaireTool | QuizTool | AnalyzerTool;

/** Public, client-safe summary (no compute fn). */
export interface ToolSummary {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  category: ToolCategory;
  kind: ToolKind;
  /** True when the tool also has a telemetry-derived ("from your data") mode.
   *  Set by ToolService from the data-provider registry, not the definition. */
  hasDataDriven?: boolean;
  /** True when the scorecard can be re-lensed into a maturity FRAMEWORK's domains
   *  (COBIT, ITIL). Set by ToolService from the framework registry — a tool no
   *  framework maps gets no toggle, and adding one is a registry entry. */
  supportsMaturityFrameworks?: boolean;
}

/** Public, client-safe full definition (no compute fn). */
export type ToolDefinition =
  | (ToolSummary & { kind: 'calculator'; about: string; inputs: CalculatorInput[] })
  | (ToolSummary & { kind: 'questionnaire'; about: string; scale: ScaleAnchor[]; sections: QuestionnaireSection[] })
  | (ToolSummary & { kind: 'quiz'; about: string; levels: QuizLevel[]; questions: QuizQuestion[] })
  | (ToolSummary & { kind: 'analyzer'; about: string; fields: AnalyzerField[] });

export function toSummary(t: Tool): ToolSummary {
  return { id: t.id, name: t.name, tagline: t.tagline, icon: t.icon, category: t.category, kind: t.kind };
}

export function toDefinition(t: Tool): ToolDefinition {
  if (t.kind === 'calculator') {
    return { ...toSummary(t), kind: 'calculator', about: t.about, inputs: t.inputs };
  }
  if (t.kind === 'quiz') {
    return { ...toSummary(t), kind: 'quiz', about: t.about, levels: t.levels, questions: t.questions };
  }
  if (t.kind === 'analyzer') {
    return { ...toSummary(t), kind: 'analyzer', about: t.about, fields: t.fields };
  }
  return { ...toSummary(t), kind: 'questionnaire', about: t.about, scale: t.scale, sections: t.sections };
}

// ── Shared questionnaire scorer (CMMI-style averaging → bands + plan) ──────────

export function clampLevel(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

/**
 * Score a questionnaire: each section is the rounded mean of its 1..5 answers;
 * the overall is the mean of rated sections; the plan targets each section's
 * level+1 (lowest first). Shared by every questionnaire tool.
 *
 * `copy` is the RESULT CHROME — the band names and the "Level 3 — Defined" /
 * "Software Delivery — to Level 4" wrappers. It is a parameter rather than a
 * module constant because a result is read in the reader's language, and the
 * chrome was the half of it that could not come from the tool: run this over a
 * localized tool (see `toolMessages.localizeTool`) and the section names and
 * actions arrive translated, while these wrappers would still have said "Level".
 * Defaults to English so every existing caller is unchanged.
 */
export function scoreQuestionnaire(
  tool: QuestionnaireTool,
  answers: Record<string, number>,
  copy: ResultCopy = resultCopy(DEFAULT_TOOL_LOCALE),
): ToolResult {
  const metrics: ToolMetric[] = [];
  const plan: Array<{ name: string; from: number; action: string }> = [];
  const levels: number[] = [];
  const bandName = (lvl: number) => copy.levelNames[clampLevel(lvl) - 1]!;

  for (const section of tool.sections) {
    const vals = section.questions
      .map((q) => answers[q.id])
      .filter((v): v is number => typeof v === 'number' && v >= 1 && v <= 5);
    if (vals.length === 0) {
      metrics.push({ key: section.key, label: section.name, value: copy.notAssessed });
      continue;
    }
    const lvl = clampLevel(vals.reduce((s, v) => s + v, 0) / vals.length);
    levels.push(lvl);
    metrics.push({ key: section.key, label: section.name, value: copy.levelValue(lvl, bandName(lvl)), tier: lvl });
    if (lvl < 5) {
      plan.push({ name: section.name, from: lvl, action: section.recommendations[lvl + 1] ?? copy.keepImproving });
    }
  }

  const overall = levels.length ? Math.round((levels.reduce((s, v) => s + v, 0) / levels.length) * 10) / 10 : null;
  plan.sort((a, b) => a.from - b.from);

  return {
    headline: overall != null ? copy.levelValue(overall, bandName(overall)) : copy.notEnoughAnswers,
    summary: overall != null ? undefined : copy.answerPrompt,
    score: overall,
    scoreLabel: overall != null ? bandName(overall) : null,
    metrics,
    recommendations: plan.map((p) => ({ title: copy.planTitle(p.name, p.from + 1), detail: p.action })),
  };
}

// ── Shared quiz scorer (per-dimension level → banded verdict + plan) ───────────

/**
 * Score a quiz: each answer is the chosen option's level; the overall is the mean
 * of answered dimensions, banded to the nearest defined level. The plan surfaces
 * how to advance the overall band, then each below-max dimension's concrete next
 * state (the text of its next-level option) — lowest dimension first. Shared by
 * every quiz tool.
 */
export function scoreQuiz(
  tool: QuizTool,
  answers: Record<string, number>,
  copy: ResultCopy = resultCopy(DEFAULT_TOOL_LOCALE),
): ToolResult {
  const maxLevel = tool.levels.reduce((m, l) => Math.max(m, l.level), 1);
  const levelDef = (lvl: number): QuizLevel | undefined => tool.levels.find((l) => l.level === lvl);
  const levelName = (lvl: number): string => levelDef(lvl)?.name ?? String(lvl);
  const clamp = (n: number): number => Math.max(1, Math.min(maxLevel, Math.round(n)));

  const metrics: ToolMetric[] = [];
  const picked: number[] = [];
  const weak: Array<{ dimension: string; level: number; next?: QuizOption }> = [];

  for (const q of tool.questions) {
    const raw = answers[q.id];
    const lvl = typeof raw === 'number' && raw >= 1 ? clamp(raw) : null;
    if (lvl == null) {
      metrics.push({ key: q.id, label: q.dimension, value: copy.notAnswered });
      continue;
    }
    picked.push(lvl);
    metrics.push({ key: q.id, label: q.dimension, value: copy.levelValue(lvl, levelName(lvl)), tier: lvl });
    if (lvl < maxLevel) {
      weak.push({ dimension: q.dimension, level: lvl, next: q.options.find((o) => o.level === lvl + 1) });
    }
  }

  if (picked.length === 0) {
    return {
      headline: copy.notEnoughAnswers,
      summary: copy.answerPrompt,
      score: null,
      scoreLabel: null,
      metrics,
      recommendations: [],
    };
  }

  const overall = Math.round((picked.reduce((s, v) => s + v, 0) / picked.length) * 10) / 10;
  const band = clamp(overall);
  const matched = levelDef(band);

  const recommendations: ToolRecommendation[] = [];
  if (band < maxLevel && matched?.advance) {
    recommendations.push({ title: copy.reachLevel(band + 1, levelName(band + 1)), detail: matched.advance });
  }
  weak.sort((a, b) => a.level - b.level);
  for (const w of weak) {
    recommendations.push({
      title: copy.planTitle(w.dimension, w.level + 1),
      detail: w.next ? copy.aimFor(w.next.text) : copy.keepMaturing,
    });
  }

  return {
    headline: copy.levelValue(band, levelName(band)),
    summary: matched?.summary,
    score: overall,
    scoreLabel: levelName(band),
    metrics,
    recommendations,
  };
}
