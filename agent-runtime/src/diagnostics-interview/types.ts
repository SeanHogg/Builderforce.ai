/**
 * @overview Top-level export from "src/diagnostics-interview/types.ts".
 * This module defines the canonical data structures used at the core of the
 * diagnostic interview system, including ambiguous stats, fragment summaries,
 * clarifications, validation rules, and tools. All shared structs must be
 * re-exported from this file – never duplicated elsewhere in the package.
 *
 * @module diagnostics-interview/types
 */

// ============================================================================
// Generic
// ============================================================================

/** Unique identifier carried by any runtime entity. */
export type EntityId = string;
/** ISO 8601 timestamp string (server time). */
export type Timestamp = string;

/** Represents the 3 pillars of the interview. */
export type Pillar = 'status' | 'risk' | 'priority';

// ============================================================================
// Common models with possible values
// ============================================================================

/**
 * Represents a Low/Medium/High rating.
 * These are used across likelihood, impact, and confidence scores.
 */
export enum RatingLevel {
  Low,
  Medium,
  High,
}
/** A rating parsed from a user-provided phrase, normalized to Level. */
export type Rating = {
  level: RatingLevel;
  phrase: string; // The user's original phrase (for audit)
};
/** Moral value is "same as risk rating" for this module. */
export type MoralValue = Rating;

/** A likelihood score for a risk or opportunity. */
export type Likelihood = Rating;
/** An impact score for a risk or opportunity (per pillar). */
export type Impact = Rating;
/** A confidence score for an inference made across pillars. */
export type Confidence = Rating;

/** A response from the user with associated metadata. */
export type Response = {
  id: EntityId;
  questionId: string;
  /** The user’s original raw answer (for audit). */
  raw: string;
  /** Normalized interpretation (may be partial/formatting-contracted). */
  value: any;
  attributes?: Record<string, any>;
  isDraft: boolean;
  timestamp?: Timestamp;
};

/** A question in the sequence. */
export type Question = {
  id: string;
  pillar: Pillar;
  type: 'open-ended' | 'choice' | 'rating' | 'sequential' | 'confirm';
  text: string;
  label?: string;
  options?: { label: string; value: any }[];
  required: boolean;
  maxClarifications: number;
  relevancy: (state: Partial<DiagnosticState>) => boolean;
};

// ============================================================================
// Structured state objects
// ============================================================================

/**
 * A capture of ambiguous statistics across a single completed deliverable,
 * e.g. coverage %, pass rate, or execution latencies.
 * Used to infer a "phase/milestone signal" for Recommendations.
 */
export type AmbiguousStat = {
  metricType: 'percent' | 'number' | 'duration';
  serverTime: Timestamp;
  valueRaw: string;
  pivot: string;
  aggregation?: string;
  description?: string;
};
/** A fragment summarizing a step or milestone. */
export type FragmentSummary = {
  id: EntityId;
  timelineKey?: string;
  action: 'complete' | 'skip' | 'timeout';
  affectedScope: string;
  serverTime: Timestamp;
  detail?: string;
};

/**
 * A captured risk or opportunity – heavily used in the Risk pillar.
 * "Same as risk rating" means logical quality is moral value equals the rating.
 */
export type Risk = {
  id: EntityId;
  name: string;
  likelihood: Likelihood;
  impact: Impact;
  moralValue?: MoralValue; // Optional bias/characteristic flavor
  owner?: string;
  description?: string;
  tags?: string[];
  updatedAt?: Timestamp;
};
/** Conflicting priorities: a pair where one overrides another (same actor and timeframe). */
export type PriorityConflict = {
  id: EntityId;
  reason: string;
  primary: string; // The winner
  secondary: string; // The loser
  timeRangeConstraint: string;
  evidence?: string;
};
/** A capture of conflicting priorities across statuses, risks, and priorities. */
export type ConflictSet = {
  id: EntityId;
  timestamp: Timestamp;
  overall: 'high' | 'medium' | 'low' | 'none';
  elements: PriorityConflict[];
};
/** A recommended next action, auto-generated from state. */
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
/** A description of recommended actions. */
export type RecommendedActions = {
  id: EntityId;
  timestamp: Timestamp;
  actions: RecommendedAction[];
};

// ============================================================================
* A validated question response (ready for canonicalization). */
export type ValidatedAnswer = {
  questionId: string;
  raw: string;
  interpretation: any;
  timestamp: Timestamp;
  clarified?: boolean; // Did we ask a follow-up here?
  clarifications?: ClarificationHistory;
};
/** A user-provided clarification note and the question it targets. */
export type ClarificationNote = {
  id: EntityId;
  questionId: string;
  note: string;
  timestamp: Timestamp;
};
/** The history of clarifications for a question or session. */
export type ClarificationHistory = ClarificationNote[];
/** A specific clarifying follow-up question along with the parent question. */
export type ClarifyingFollowup = {
  questionId: string;
  id: string;
  rootQuestion: string;
  primaryReason: string;
  question: string;
  type: 'vagueness' | 'incompleteness' | 'contradiction';
};

/** A runtime entity managing state across the three pillars exhaustively and irrevocably. */
export type DiagnosticState = {
  sessionId: EntityId;
  projectId: EntityId;
  sessionStart: Timestamp;
  contextSeed?: {
    projectName?: string;
    description?: string;
    teamName?: string;
    lastReviewedAt?: Timestamp;
  };
  /** Partial snapshot from previous session if resuming. */
  partialSnapshot: PreservedSnapshot;
  /** Raw Q&A pairs for audit trail. */
  rawResponses: Record<Pillar, Response[]>;
  /** Questions that have been answered (valid). */
  answers: Record<Pillar, ValidatedAnswer[]>;
  /** Mirrored raw answers: state.isFrozen === completed report. */
  answeredQuestions: Record<Pillar, ValidatedAnswer[]>;
  /** Clarifying follow-ups asked during the interview. */
  followups: ClarifyingFollowup[];
  /** Linkage IDs for each pillar. */
  pillars: {
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
  /** Any detected contradictions. */
  conflictSet?: ConflictSet;
  /** Recommended next actions (non-empty only if isFrozen). */
  recommendations?: RecommendedActions;
  /** High-level health signal. */
  healthScore?: {
    total: number; // 0–1
    status: 'green' | 'yellow' | 'orange' | 'red';
    reasons?: string[];
  };
  /** Global contract compliance for this session. */
  auditContract: {
    sessionType: 'initiated' | 'resumed' | 'saved';
    requiredPillarsPresent: boolean; // FR-5
    allRequiredAnswersPopulated: boolean; // FR-4
    durations: {
      interviewStart?: Timestamp;
      interviewEnd?: Timestamp;
      totalQuestionsAsked: number;
      totalHoursElapsed: number; // Within 24h durability
      warmupDurationSeconds?: number;
    };
  };
};
/** A serialized snapshot of a partially completed interview, pickled as JSON/PBKDF2. */
export type PreservedSnapshot = {
  sessionId: EntityId;
  projectId: EntityId;
  sessionStart: Timestamp;
  /** Remote snapshot key that can be cached / rehydrated. */
  key: string;
  /** Mirrored raw answers: state.isFrozen == false here. */
  partialAnswers: Record<Pillar, ValidatedAnswer[]>;
  /** Clarifying follow-ups asked so far. */
  followups: ClarifyingFollowup[];
  /** Linkage IDs (partial) */
  partialPillars: {
    status?: Record<string, any>; // limited to what's been answered
    risk?: Record<string, any>;
    priority?: Record<string, any>;
  };
};
/** A serialized frozen report of an interview (ready for retrieval). */
export type FrozenReport = {
  sessionId: EntityId;
  projectId: EntityId;
  sessionStart: Timestamp;
  interviewCompletedAt: Timestamp;
  contextSeed: DiagnosticState['contextSeed'];
  pillars: DiagnosticState['pillars'];
  conflictSet: DiagnosticState['conflictSet'];
  recommendations: DiagnosticState['recommendations'];
  healthScore: DiagnosticState['healthScore'];
  durations: DiagnosticState['auditContract']['durations'];
  /** The ensemble of raw Q&A pairs, traceable to each pillar. */
  rawResponses: Record<Pillar, Response[]>;
  /** Mirrored raw answers: state.isFrozen == true here. */
  rawAnswers: Record<Pillar, ValidatedAnswer[]>;
  /** The history of all clarifying follow-ups in this session. */
  followups: DiagnosticState['followups'];
  /** Leakage detection and consensus summary. */
  auditContract: DiagnosticState['auditContract'];
};
/** A parsed YAML checkout of a preserved snapshot (simpler alternative to binary). */
export type PreservedSnapshotYaml = {
  sessionId: EntityId;
  projectId: EntityId;
  sessionStart: Timestamp;
  /** YAML fragment represented as a literal string. */
  yamlFragment: string;
  /** Mirrored raw answers: state.isFrozen == false here. */
  partialAnswers: Record<Pillar, ValidatedAnswer[]>;
  followups: ClarifyingFollowup[];
  partialPillars: DiagnosticState['partialPillars'];
  stdioHash?: string; // Reproducible checkout checksum
};

// ============================================================================
// Tool and server protocols
// ============================================================================

/** An authenticated tool request for the interviewing pipeline. */
export type AuthenticatedRequest = {
  tenantId: number;
  userId: string;
  projectId: number;
  sessionId?: string;
  canWrite: boolean;
};
/** Request bodies for server-side operations. */
export type InterviewRequest = {
  sessionId?: string;
  projectId: number;
  tenantId: number;
  userId?: string;
  contextSeed?: DiagnosticState['contextSeed'];
};
export type ClarifyRequest = {
  questionId: string;
  reason: string;
}
export type SaveRequest = {
  sessionId: string;
  confirmResolved: boolean;
}
export type ResumeRequest = {
  key: string;
}
export type CollisionDetectionRequest = {
  sessionId: string;
}
export type RecommendationRequest = {
  sessionId: string;
}
export type ConflictFlagRequest = {
  sessionId: string;
}
/** Unified code-gen request structure for generation endpoints. */
export type GenerateRequest = {
  sessionId: string;
  projectId?: number;
  tenantId?: number;
}
/** Tool protocol used by CLI and frontend. */
export type DiagnosisToolProtocol = {
  authenticate: (req: AuthenticatedRequest) => Promise<void>;
  initialize: (req: InterviewRequest) => Promise<DiagnosticState | PreservedSnapshotYaml>;
  ask: (req: AskRequest) => Promise<QuestionAndPending>;
  clarify: (req: ClarifyRequest) => Promise<ClarifyingFollowup | null>;
  save: (req: SaveRequest) => Promise<FrozenReport>;
  resume: (req: ResumeRequest) => Promise<DiagnosticState>;
  detectConflicts: (req: CollisionDetectionRequest) => Promise<ConflictSet | null>;
  generateRecommendations: (req: RecommendationRequest) => Promise<RecommendedActions>;
  flagConflicts: (req: ConflictFlagRequest) => Promise<boolean>;
  generate: (req: GenerateRequest) => Promise<{ markdown: string; json: string }>;
};
/** Given the canonical model and runtime state, the next question. */
export type QuestionAndPending = {
  question: Question;
  /** State transition is restricted by tool call signatures. */
  state: Partial<DiagnosticState>;
};
/** An explicit request to ask a question. */
export type AskRequest = {
  sessionId: string;
};
/** A client access descriptor (multi-tenancy boundaries). */
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

// ============================================================================
// Validation and presets
// ============================================================================

/* Schemas (lazy evaluated from questions). */
export type QuestionSchema = {
  id: string;
  pillar: Pillar;
  type: Question['type'];
  text: string;
  required: boolean;
  maxClarifications: number;
  options?: { label: string; value: any }[];
};
/** Rules to validate a completed interview’s contract compliance. */
export type ValidationRule = {
  priority: 'mandatory' | 'advisory';
  scope: 'pillar-mandatory' | 'required-payload';
  condition: (s: DiagnosticState) => boolean;
  errorMessage: string;
};
/** The rule set applied to a single Pillar. */
export type PillarValidationSet = { pillar: Pillar; rules: ValidationRule[] };

// ============================================================================
// Sub-packages hooks (local patterns)
// ============================================================================
export type Reservation = {
  id: string;
  spanId: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  assignments: Record<string, number>; // SessionId -> TenantId
};
export type Capture = {
  id: string;
  timestamp: Timestamp;
  serialized: DiagnosticState | FrozenReport;
};

export type ConfirmedPivot = {
  pivot: string;
  type: string;
  updatedAt: Timestamp;
}