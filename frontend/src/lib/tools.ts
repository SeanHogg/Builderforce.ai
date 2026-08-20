/**
 * Diagnostics & Tools — shared frontend types. Definitions come from the API
 * (`GET /api/tools`, public) so the backend stays the single source of truth;
 * the generic runner renders whatever it's handed. Compute is a public POST
 * (free preview); saving a run goes through the authenticated `toolsApi`.
 */

/**
 * The architecture analysis's diagnostic id. It is registered like every other
 * audit, but it is the one whose RESULT is a document (the architecture PRD)
 * rather than a scorecard — so more than one surface has to recognise it, and
 * the string lives here rather than being re-typed at each of them.
 */
export const ARCHITECTURE_DIAGNOSTIC_ID = 'architecture-analysis';

export type ToolCategory = 'delivery' | 'finops' | 'governance' | 'quality' | 'career';
export type ToolKind = 'calculator' | 'questionnaire' | 'quiz' | 'analyzer';

export interface ToolSummary {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  category: ToolCategory;
  kind: ToolKind;
  /** True when the tool also has a telemetry-derived "from your data" mode. */
  hasDataDriven?: boolean;
  /** True when the scorecard can be re-lensed into a maturity FRAMEWORK's domains
   *  (COBIT, ITIL). Decided server-side from the framework registry. */
  supportsMaturityFrameworks?: boolean;
}

/**
 * A maturity framework the scorecard can be reported under, from
 * `GET /api/tools/maturity-frameworks`.
 *
 * A LENS, never a second questionnaire: the signals, the score and the plan are
 * identical under every framework — only the grouping and the names of the
 * scorecard rows change, so a CIO can hand the same measurement to an audit
 * committee in the taxonomy that committee already uses.
 */
export interface MaturityFrameworkSummary {
  id: string;
  name: string;
  tagline: string;
  domains: Array<{ key: string; name: string; description: string; practices: string[] }>;
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

/** One field an analyzer reads. `document` is a long paste (a résumé, a posting);
 *  `line` is a single value; `select` is a fixed choice. */
export interface AnalyzerField {
  id: string;
  label: string;
  type: 'document' | 'line' | 'select';
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export type ToolDefinition =
  | (ToolSummary & { kind: 'calculator'; about: string; inputs: CalculatorInput[] })
  | (ToolSummary & { kind: 'questionnaire'; about: string; scale: ScaleAnchor[]; sections: QuestionnaireSection[] })
  | (ToolSummary & { kind: 'quiz'; about: string; levels: QuizLevel[]; questions: QuizQuestion[] })
  | (ToolSummary & { kind: 'analyzer'; about: string; fields: AnalyzerField[] });

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

export interface ToolMetric {
  label: string;
  value: string;
  hint?: string;
  tier?: number;
  /** Stable identity of the row (a section key, a framework domain key) — set by
   *  the server so a scorecard can be regrouped without matching on its label. */
  key?: string;
}
export interface ToolRecommendation {
  title: string;
  detail: string;
  /** How much this one matters. Carried by the career analyzers, which rank their
   *  findings; absent on the questionnaire/quiz plans, already ordered by level. */
  priority?: 'high' | 'medium' | 'low';
}
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

/**
 * Every input/question id a definition scores, whatever its kind.
 *
 * Distinct from {@link defaultInput}, which is empty for a questionnaire or a
 * quiz because those have no defaults to seed — so it cannot be used to tell a
 * CALLER what it may send. The canvas tool (`canvas_add_diagnostic`) needs
 * exactly that: an answer key the tool does not define is dropped rather than
 * posted, because a score computed against a shape the tool never declared is a
 * number that looks computed and is not.
 */
export function questionIds(def: ToolDefinition): string[] {
  if (def.kind === 'calculator') return def.inputs.map((i) => i.id);
  if (def.kind === 'quiz') return def.questions.map((q) => q.id);
  // An analyzer's fields are documents, not scored answers — it has no answer key
  // to hand a caller, so the canvas diagnostic tool correctly posts nothing.
  if (def.kind === 'analyzer') return [];
  return def.sections.flatMap((s) => s.questions.map((q) => q.id));
}

/** Which analyzer fields must carry text before it can run. */
export function requiredFieldIds(def: ToolDefinition): string[] {
  return def.kind === 'analyzer' ? def.fields.filter((f) => f.required).map((f) => f.id) : [];
}

/** Whether every required document has been supplied. */
export function documentsComplete(def: ToolDefinition, values: Record<string, string>): boolean {
  return requiredFieldIds(def).every((id) => (values[id] ?? '').trim().length > 0);
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
