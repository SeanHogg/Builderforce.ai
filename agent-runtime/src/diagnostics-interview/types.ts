/**
 * Canonical data model for the Diagnostic Interview system.
 *
 * The interview is a structured, conversational flow over three pillars:
 *   - status: phase, completion signal, last/next deliverable
 *   - risk: top risks, likelihood, impact, materialized risks
 *   - priority: top priority, changes, deprioritizations
 *
 * All downstream consumers (JSON report, Markdown report, audit trail,
 * saved sessions, recommendation engine) use this single canonical model.
 */

export type EntityId = string;
export type Timestamp = string;

export type Pillar = 'status' | 'risk' | 'priority';

export enum RatingLevel {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
}

export type Rating = {
  level: RatingLevel;
  phrase: string;
};

export type Likelihood = Rating;
export type Impact = Rating;
export type Confidence = Rating;

export type Response = {
  id: EntityId;
  questionId: string;
  raw: string;
  value: unknown;
  attributes?: Record<string, unknown>;
  isDraft: boolean;
  timestamp?: Timestamp;
};

export type QuestionType = 'open-ended' | 'choice' | 'rating' | 'sequential' | 'confirm';

export type Question = {
  id: string;
  pillar: Pillar;
  type: QuestionType;
  text: string;
  label?: string;
  options?: { label: string; value: unknown }[];
  required: boolean;
  maxClarifications: number;
  relevancy: (state: DiagnosticState) => boolean;
};

export type AmbiguousStat = {
  metricType: 'percent' | 'number' | 'duration';
  serverTime: Timestamp;
  valueRaw: string;
  pivot: string;
  aggregation?: string;
  description?: string;
};

export type FragmentSummary = {
  id: EntityId;
  timelineKey?: string;
  action: 'complete' | 'skip' | 'timeout';
  affectedScope: string;
  serverTime: Timestamp;
  detail?: string;
};

export type Risk = {
  id: EntityId;
  name: string;
  likelihood: Likelihood;
  impact: Impact;
  moralValue?: Rating;
  owner?: string;
  description?: string;
  tags?: string[];
  updatedAt?: Timestamp;
};

export type PriorityConflict = {
  id: EntityId;
  reason: string;
  primary: string;
  secondary: string;
  timeRangeConstraint: string;
  evidence?: string;
};

export type ConflictSet = {
  id: EntityId;
  timestamp: Timestamp;
  overall: 'high' | 'medium' | 'low' | 'none';
  elements: PriorityConflict[];
};

export type RecommendedAction = {
  id: EntityId;
  anchor: {
    commentary: string;
    source: 'recommendation_engine';
  };
  suggested: string;
  reason: string;
  validity: 'plausible' | 'cautious' | 'overrides_risks';
};

export type RecommendedActions = {
  id: EntityId;
  timestamp: Timestamp;
  actions: RecommendedAction[];
};

export type ValidatedAnswer = {
  questionId: string;
  raw: string;
  interpretation: unknown;
  timestamp: Timestamp;
  clarified?: boolean;
  clarifications?: ClarificationHistory;
};

export type ClarificationNote = {
  id: EntityId;
  questionId: string;
  note: string;
  timestamp: Timestamp;
};

export type ClarificationHistory = ClarificationNote[];

export type ClarifyingFollowup = {
  questionId: string;
  id: string;
  rootQuestion: string;
  primaryReason: string;
  question: string;
  type: 'vagueness' | 'incompleteness' | 'contradiction';
};

export type ContextSeed = {
  projectName?: string;
  description?: string;
  teamName?: string;
  lastReviewedAt?: Timestamp;
};

export type PillarData = {
  status?: {
    currentPhase?: string;
    completionSignal?: AmbiguousStat;
    lastCompletedDeliverable?: FragmentSummary;
    nextDeliverable?: FragmentSummary;
  };
  risk?: Risk[];
  priority?: {
    topPriority?: string;
    averted?: string;
    deprioritized?: string;
  };
};

export type AuditContract = {
  sessionType: 'initiated' | 'resumed' | 'saved';
  requiredPillarsPresent: boolean;
  allRequiredAnswersPopulated: boolean;
  durations: {
    interviewStart?: Timestamp;
    interviewEnd?: Timestamp;
    totalQuestionsAsked: number;
    totalHoursElapsed: number;
    warmupDurationSeconds?: number;
  };
};

export type HealthScore = {
  total: number;
  status: 'green' | 'yellow' | 'orange' | 'red';
  reasons?: string[];
};

export type DiagnosticState = {
  sessionId: EntityId;
  projectId: EntityId;
  sessionStart: Timestamp;
  contextSeed?: ContextSeed;
  partialSnapshot: PreservedSnapshot;
  rawResponses: Record<Pillar, Response[]>;
  answers: Record<Pillar, ValidatedAnswer[]>;
  answeredQuestions: Record<Pillar, ValidatedAnswer[]>;
  followups: ClarifyingFollowup[];
  pillars: PillarData;
  conflictSet?: ConflictSet;
  recommendations?: RecommendedActions;
  healthScore?: HealthScore;
  auditContract: AuditContract;
};

export type PreservedSnapshot = {
  sessionId: EntityId;
  projectId: EntityId;
  sessionStart: Timestamp;
  key: string;
  partialAnswers: Record<Pillar, ValidatedAnswer[]>;
  followups: ClarifyingFollowup[];
  partialPillars: Record<Pillar, Record<string, unknown> | undefined>;
};

export type FrozenReport = {
  sessionId: EntityId;
  projectId: EntityId;
  sessionStart: Timestamp;
  interviewCompletedAt: Timestamp;
  contextSeed?: ContextSeed;
  pillars: PillarData;
  conflictSet?: ConflictSet;
  recommendations?: RecommendedActions;
  healthScore?: HealthScore;
  durations: AuditContract['durations'];
  rawResponses: Record<Pillar, Response[]>;
  rawAnswers: Record<Pillar, ValidatedAnswer[]>;
  followups: ClarifyingFollowup[];
  auditContract: AuditContract;
};

export type PreservedSnapshotYaml = {
  sessionId: EntityId;
  projectId: EntityId;
  sessionStart: Timestamp;
  yamlFragment: string;
  partialAnswers: Record<Pillar, ValidatedAnswer[]>;
  followups: ClarifyingFollowup[];
  partialPillars: Record<Pillar, Record<string, unknown> | undefined>;
  stdioHash?: string;
};

export type AuthenticatedRequest = {
  tenantId: number;
  userId: string;
  projectId: number;
  sessionId?: string;
  canWrite: boolean;
};

export type InterviewRequest = {
  sessionId?: string;
  projectId: number;
  tenantId: number;
  userId?: string;
  contextSeed?: ContextSeed;
};

export type ClarifyRequest = {
  sessionId: string;
  questionId?: string;
  reason: string;
};

export type SaveRequest = {
  sessionId: string;
  confirmResolved: boolean;
};

export type ResumeRequest = {
  key: string;
};

export type CollisionDetectionRequest = {
  sessionId: string;
};

export type RecommendationRequest = {
  sessionId: string;
};

export type ConflictFlagRequest = {
  sessionId: string;
};

export type GenerateRequest = {
  sessionId: string;
  projectId?: number;
  tenantId?: number;
};

export type AskRequest = {
  sessionId: string;
};

export type QuestionAndPending = {
  question: Question;
  state: Partial<DiagnosticState>;
};

export type AccessDescriptor = {
  tenantId: number;
  projectId: number;
  userId: string;
  sessionId: string;
  permissions: {
    canRead: boolean;
    canWrite: boolean;
  };
};

export type ValidationRule = {
  priority: 'mandatory' | 'advisory';
  scope: 'pillar-mandatory' | 'required-payload';
  condition: (s: DiagnosticState) => boolean;
  errorMessage: string;
};

export type PillarValidationSet = { pillar: Pillar; rules: ValidationRule[] };
