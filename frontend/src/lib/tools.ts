/**
 * Diagnostics & Tools — shared frontend types. Definitions come from the API
 * (`GET /api/tools`, public) so the backend stays the single source of truth;
 * the generic runner renders whatever it's handed. Compute is a public POST
 * (free preview); saving a run goes through the authenticated `toolsApi`.
 */

export type ToolCategory = 'delivery' | 'finops' | 'governance' | 'quality';
export type ToolKind = 'calculator' | 'questionnaire' | 'quiz';

export interface ToolSummary {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  category: ToolCategory;
  kind: ToolKind;
  /** True when the tool also has a telemetry-derived "from your data" mode. */
  hasDataDriven?: boolean;
}

export interface CalculatorInput {
  id: string;
  label: string;
  type: 'number' | 'select';
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  default: number;
  options?: Array<{ value: number; label: string }>;
  help?: string;
}

export interface QuestionnaireQuestion { id: string; text: string }
export interface QuestionnaireSection {
  key: string;
  name: string;
  description: string;
  questions: QuestionnaireQuestion[];
  recommendations: Record<number, string>;
}
export interface ScaleAnchor { value: number; label: string }

export interface QuizOption { level: number; text: string }
export interface QuizQuestion { id: string; dimension: string; text: string; options: QuizOption[] }
export interface QuizLevel { level: number; name: string; summary: string; advance: string }

export type ToolDefinition =
  | (ToolSummary & { kind: 'calculator'; about: string; inputs: CalculatorInput[] })
  | (ToolSummary & { kind: 'questionnaire'; about: string; scale: ScaleAnchor[]; sections: QuestionnaireSection[] })
  | (ToolSummary & { kind: 'quiz'; about: string; levels: QuizLevel[]; questions: QuizQuestion[] });

export interface ToolMetric { label: string; value: string; hint?: string; tier?: number }
export interface ToolRecommendation { title: string; detail: string }
export interface ToolResult {
  headline: string;
  summary?: string;
  score?: number | null;
  scoreLabel?: string | null;
  metrics: ToolMetric[];
  recommendations: ToolRecommendation[];
}

export interface SavedToolRun {
  id: string;
  toolId: string;
  kind: string;
  projectId: number | null;
  input: Record<string, number>;
  result: ToolResult;
  createdBy: string | null;
  createdAt: string;
}

/** One diagnostic's latest result for a project. */
export interface ProjectDiagnostic {
  toolId: string;
  name: string;
  score: number | null;
  scoreLabel: string | null;
  headline: string;
  kind: string;
  createdAt: string;
  /** The full latest run result, for the per-diagnostic results view. */
  result: ToolResult;
}

/** A project's diagnostic rating: an aggregate result + per-diagnostic latest scores. */
export interface ProjectScore {
  result: ToolResult;
  diagnostics: ProjectDiagnostic[];
}

export interface TenantProjectScore {
  projectId: number;
  name: string;
  score: number | null;
  scoreLabel: string | null;
  diagnosticCount: number;
  lastRunAt: string;
}

/** Project diagnostic ratings rolled up to the workspace. */
export interface TenantDiagnosticsRollup {
  result: ToolResult;
  projects: TenantProjectScore[];
}

/** Default input map for a definition (calculator defaults; questionnaires/quizzes start empty). */
export function defaultInput(def: ToolDefinition): Record<string, number> {
  if (def.kind === 'calculator') {
    return Object.fromEntries(def.inputs.map((i) => [i.id, i.default]));
  }
  return {};
}

/** Whether every answer is provided for an answer-based tool. Calculators are
 *  always "complete" (they have defaults), so they can run immediately. */
export function answersComplete(def: ToolDefinition, input: Record<string, number>): boolean {
  if (def.kind === 'questionnaire') {
    return def.sections.every((s) => s.questions.every((q) => typeof input[q.id] === 'number'));
  }
  if (def.kind === 'quiz') {
    return def.questions.every((q) => typeof input[q.id] === 'number');
  }
  return true;
}
