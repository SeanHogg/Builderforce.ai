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

export type ToolCategory = 'delivery' | 'finops' | 'governance' | 'quality';
export type ToolKind = 'calculator' | 'questionnaire' | 'quiz';

// ── Shared result shape (rendered by one generic ToolResultView) ──────────────

export interface ToolMetric {
  label: string;
  value: string;
  /** Optional band/explanation under the value. */
  hint?: string;
  /** 1..5 tier for a colored meter (optional). */
  tier?: number;
}

export interface ToolRecommendation {
  title: string;
  detail: string;
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

// ── Tool definition (discriminated by kind) ───────────────────────────────────

interface ToolBase {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  category: ToolCategory;
  /** A one-paragraph "what this measures / why it matters". */
  about: string;
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

export type Tool = CalculatorTool | QuestionnaireTool | QuizTool;

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
}

/** Public, client-safe full definition (no compute fn). */
export type ToolDefinition =
  | (ToolSummary & { kind: 'calculator'; about: string; inputs: CalculatorInput[] })
  | (ToolSummary & { kind: 'questionnaire'; about: string; scale: ScaleAnchor[]; sections: QuestionnaireSection[] })
  | (ToolSummary & { kind: 'quiz'; about: string; levels: QuizLevel[]; questions: QuizQuestion[] });

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
  return { ...toSummary(t), kind: 'questionnaire', about: t.about, scale: t.scale, sections: t.sections };
}

// ── Shared questionnaire scorer (CMMI-style averaging → bands + plan) ──────────

const LEVEL_NAMES = ['Initial', 'Managed', 'Defined', 'Quantitatively Managed', 'Optimizing'];

export function clampLevel(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

/**
 * Score a questionnaire: each section is the rounded mean of its 1..5 answers;
 * the overall is the mean of rated sections; the plan targets each section's
 * level+1 (lowest first). Shared by every questionnaire tool.
 */
export function scoreQuestionnaire(tool: QuestionnaireTool, answers: Record<string, number>): ToolResult {
  const metrics: ToolMetric[] = [];
  const plan: Array<{ name: string; from: number; action: string }> = [];
  const levels: number[] = [];

  for (const section of tool.sections) {
    const vals = section.questions
      .map((q) => answers[q.id])
      .filter((v): v is number => typeof v === 'number' && v >= 1 && v <= 5);
    if (vals.length === 0) {
      metrics.push({ label: section.name, value: 'Not assessed' });
      continue;
    }
    const lvl = clampLevel(vals.reduce((s, v) => s + v, 0) / vals.length);
    levels.push(lvl);
    metrics.push({ label: section.name, value: `Level ${lvl} — ${LEVEL_NAMES[lvl - 1]}`, tier: lvl });
    if (lvl < 5) {
      plan.push({ name: section.name, from: lvl, action: section.recommendations[lvl + 1] ?? 'Continue improving this area.' });
    }
  }

  const overall = levels.length ? Math.round((levels.reduce((s, v) => s + v, 0) / levels.length) * 10) / 10 : null;
  plan.sort((a, b) => a.from - b.from);

  return {
    headline: overall != null ? `Level ${overall} — ${LEVEL_NAMES[clampLevel(overall) - 1]}` : 'Not enough answers yet',
    summary: overall != null ? undefined : 'Answer the questions to see your rating and plan.',
    score: overall,
    scoreLabel: overall != null ? LEVEL_NAMES[clampLevel(overall) - 1] : null,
    metrics,
    recommendations: plan.map((p) => ({ title: `${p.name} — to Level ${p.from + 1}`, detail: p.action })),
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
export function scoreQuiz(tool: QuizTool, answers: Record<string, number>): ToolResult {
  const maxLevel = tool.levels.reduce((m, l) => Math.max(m, l.level), 1);
  const levelDef = (lvl: number): QuizLevel | undefined => tool.levels.find((l) => l.level === lvl);
  const levelName = (lvl: number): string => levelDef(lvl)?.name ?? `Level ${lvl}`;
  const clamp = (n: number): number => Math.max(1, Math.min(maxLevel, Math.round(n)));

  const metrics: ToolMetric[] = [];
  const picked: number[] = [];
  const weak: Array<{ dimension: string; level: number; next?: QuizOption }> = [];

  for (const q of tool.questions) {
    const raw = answers[q.id];
    const lvl = typeof raw === 'number' && raw >= 1 ? clamp(raw) : null;
    if (lvl == null) {
      metrics.push({ label: q.dimension, value: 'Not answered' });
      continue;
    }
    picked.push(lvl);
    metrics.push({ label: q.dimension, value: `Level ${lvl} — ${levelName(lvl)}`, tier: lvl });
    if (lvl < maxLevel) {
      weak.push({ dimension: q.dimension, level: lvl, next: q.options.find((o) => o.level === lvl + 1) });
    }
  }

  if (picked.length === 0) {
    return {
      headline: 'Not enough answers yet',
      summary: 'Answer each dimension to see your level and what to do next.',
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
    recommendations.push({ title: `Reach Level ${band + 1} — ${levelName(band + 1)}`, detail: matched.advance });
  }
  weak.sort((a, b) => a.level - b.level);
  for (const w of weak) {
    recommendations.push({
      title: `${w.dimension} — to Level ${w.level + 1}`,
      detail: w.next ? `Aim for: ${w.next.text}` : 'Keep maturing this dimension.',
    });
  }

  return {
    headline: `Level ${band} — ${levelName(band)}`,
    summary: matched?.summary,
    score: overall,
    scoreLabel: levelName(band),
    metrics,
    recommendations,
  };
}
