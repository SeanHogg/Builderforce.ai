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

/** Remediation lifecycle a diagnostic's filed ticket(s) are in (mirrors the
 *  backend `RemediationState`). `none` = no remediation ticket → fall back to gaps. */
export type RemediationState = 'none' | 'filed' | 'pr_open' | 'resolved';

/** Real remediation status for a diagnostic, derived from its filed tickets
 *  (mirrors the backend `RemediationSummary`). Drives the "Remediation PR opened"
 *  badge on the diagnostics strip. */
export interface RemediationSummary {
  state: RemediationState;
  total: number;
  open: number;
  prUrl: string | null;
}

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
  /** Emoji icon for the diagnostic (audit / tool). */
  icon: string;
  score: number | null;
  scoreLabel: string | null;
  headline: string;
  /** Number of open gaps (recommendations) the latest run flagged. */
  gapCount: number;
  /** Real remediation status derived from the diagnostic's filed ticket(s). */
  remediation: RemediationSummary;
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

/** Compact per-diagnostic summary carried on a rollup row (mirrors backend
 *  `ProjectDiagnosticSummary`) — lets the project card render each diagnostic
 *  from the single cached rollup read. */
export interface ProjectDiagnosticSummary {
  toolId: string;
  name: string;
  icon: string;
  score: number | null;
  scoreLabel: string | null;
  gapCount: number;
  /** Real remediation status (filed / PR-open / resolved) for the card badge. */
  remediation: RemediationSummary;
}

export interface TenantProjectScore {
  projectId: number;
  name: string;
  score: number | null;
  scoreLabel: string | null;
  diagnosticCount: number;
  lastRunAt: string;
  diagnostics: ProjectDiagnosticSummary[];
}

/** Project diagnostic ratings rolled up to the workspace. */
export interface TenantDiagnosticsRollup {
  result: ToolResult;
  projects: TenantProjectScore[];
}

/** A system-level audit type (SOC 2, Architecture, Quality, PM Vision) — an
 *  externally-scored diagnostic run against a project. Mirrors the backend
 *  `SystemAuditSummary`. */
export interface SystemAuditSummary {
  id: string;
  name: string;
  category: ToolCategory;
  icon: string;
  blurb: string;
}

/** Outcome of kicking off an audit run. */
export interface AuditRunOutcome {
  started: true;
  auditId: string;
  mode: 'agent' | 'deterministic';
  run: SavedToolRun;
  agentTask?: { taskId: number; status: string };
  /** All remediation tickets filed (one per gap for ticketPerFinding audits). */
  agentTasks?: Array<{ taskId: number; status: string }>;
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
