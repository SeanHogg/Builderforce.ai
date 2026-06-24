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
export type ToolKind = 'calculator' | 'questionnaire';

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

export type Tool = CalculatorTool | QuestionnaireTool;

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
  | (ToolSummary & { kind: 'questionnaire'; about: string; scale: ScaleAnchor[]; sections: QuestionnaireSection[] });

export function toSummary(t: Tool): ToolSummary {
  return { id: t.id, name: t.name, tagline: t.tagline, icon: t.icon, category: t.category, kind: t.kind };
}

export function toDefinition(t: Tool): ToolDefinition {
  if (t.kind === 'calculator') {
    return { ...toSummary(t), kind: 'calculator', about: t.about, inputs: t.inputs };
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
