/**
 * Bug-Driven Triage & Remediation - Type Definitions
 */

/**
 * Severity levels for bugs
 */
export enum Severity {
  CRITICAL = 'critical',
  MAJOR = 'major',
  MINOR = 'minor',
}

/**
 * Recommendation types
 */
export enum RecommendationType {
  FOCUSED_TESTING = 'focused_testing',
  CODE_REVIEW = 'code_review',
  REFACTORING = 'refactoring',
}

/**
 * Effort tiers for recommendations
 */
export enum EffortTier {
  SMALL = 'S',
  MEDIUM = 'M',
  LARGE = 'L',
  XP_LARGE = 'XL',
}

/**
 * Bug from issue tracker
 */
export interface Bug {
  id: string;
  title: string;
  description?: string;
  severity: Severity;
  status: string;
  source: 'github' | 'jira' | 'linear' | 'azure_devops';
  sourceId: string;
  labels?: string[];

  // Location information
  files?: string[];
  modules?: string[];
  commitHash?: string;
  stackTrace?: string;

  // Metadata
  createdAt: string;
  closedAt?: string;
  reopenedCount?: number;

  // Additional contextual data
  component?: string;
  priority?: string;
  assignee?: string;
}

/**
 * Module with code metrics
 */
export interface Module {
  path: string;
  name: string;
  files: string[];

  // Code metrics
  linesOfCode?: number;
  cyclomaticComplexity?: number;

  // Analysis data
  defectScore?: number;
  bugCount: number;
  weightedBugCount: number;
}

/**
 * Defect density score
 */
export interface DefectDensityScore {
  modulePath: string;
  score: number;
  bugs: number;
  weightedBugs: number;
  denominator: number; // complexity or LOC

  // Derived metrics
  percentOfTotal?: number;
  isAboveThreshold?: boolean;
}

/**
 * Hotspot - area with elevated defect density
 */
export interface Hotspot {
  path: string;
  name: string;
  modulePath: string;

  // Metrics
  defectScore: number;
  bugCount: number;
  weightedBugs: number;
  linesOfCode?: number;
  cyclomaticComplexity?: number;

  // Detection type
  detectionType: 'high_bug_count' | 'recurrence' | 'high_complexity_bug_mix';

  // Statistical context
  percentile: number; // Performance relative to other modules
  adjacentViolatingFiles?: string[];
  trend: 'increasing' | 'stable' | 'decreasing';
}

/**
 * Recommendation
 */
export interface Recommendation {
  id: string;
  type: RecommendationType;
  priority: number;
  estimatedImpact: string; // qualitative description
  estimatedEffort: EffortTier;

  // Target
  targetPath: string;
  moduleName?: string;

  // Rationale
  rationale: string;
  evidence: {
    severityCounts: { [key in Severity]?: number };
    bugCount: number;
    weightedBugs: number;
    defectScore: number;
  };

  // Action
  action: string; // description of the action to take

  // Owner
  recommendedOwner?: string;
  recommendedReviewer?: string;

  // Context snippets
  contextSnippets?: {
    file: string;
    snippet: string;
    line?: number;
  }[];

  // Estimates
  estimatedLinesAffected?: number;
  estimatedComplexityDelta?: number;

  // State
  status: RecommendationStatus;
  generatedAt: string;
  deliveredTo?: {
    method: 'dashboard' | 'slack' | 'teams' | 'pr_comment';
    timestamp: string;
  };

  // Refactoring task payload (for AI coding agents)
  refactorTaskPayload?: {
    id: string;
    title: string;
    description: string;
    targetFiles: string[];
    desiredOutcome: string;
    constraints: string[];
    context: string[];
  };
}

/**
 * Recommendation status
 */
export enum RecommendationStatus {
  GENERATED = 'generated',      // Just created
  DELIVERED = 'delivered',      // Dropped off to dashboard/channels
  PENDING_APPROVAL = 'pending_approval', // Waiting for human review
  APPROVED = 'approved',        // Human approved, ready for execution
  ACTIONED = 'actioned',        // Work being done
  COMPLETED = 'completed',      // Completed by agent/human
  ARCHIVED = 'archived',        // Dismissed or no longer relevant
}

/**
 * Recommendation action
 */
export interface RecommendationAction {
  id: string;
  recommendationId: string;
  actionedBy: string; // 'agent' | 'human'
  action: 'started' | 'paused' | 'completed' | 'cancelled';
  startedAt: string;
  completedAt?: string;

  // Refactoring details
  refactoringSummary?: string;
  linesModified?: number;
  testCoverageDelta?: number;

  // Results
  defectScoreBefore: number;
  defectScoreAfter?: number;
  actualImpact: string;
}

/**
 * Daily/weekly quality metrics
 */
export interface QualityMetrics {
  date: string;
  repositoryIssues: {
    reopened: number;
    closed: number;
    total: number;
  };
  moduleViolations: Hotspot[];
  thresholdBreaches: {
    repository?: boolean;
    module?: string[];
    file?: string[];
  };
  recommendationCompletionRate: number;
}

/**
 * Weekly digest
 */
export interface QualityDigest {
  weekStartDate: string;
  weekEndDate: string;
  topModules: {
    path: string;
    defectScore: number;
    bugCount: number;
    recommendationType: RecommendationType;
  }[];
  mostCommonSeverities: {
    severity: Severity;
    count: number;
    percent: number;
  }[];
  completedRecommendations: RecommendationAction[];
  actionItems: {
    title: string;
    detail: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    assignedTo?: string;
  }[];
}

/**
 * Trigger analysis request
 */
export interface TriggerAnalysisRequest {
  projectId?: string;
  modulePath?: string;
  force: boolean;
}

/**
 * Recommendation options
 */
export interface RecommendationOptions {
  limit?: number;
  modulePaths?: string[];
  includeDetails?: boolean;
  excludeTypes?: RecommendationType[];
  status?: RecommendationStatus;
}

/**
 * Human approval request
 */
export interface HumanApprovalRequest {
  recommendationId: string;
  agentProposal?: {
    diff?: string;
    commitMessage?: string;
    filesChanged?: string[];
  };
  approved: boolean;
}

/**
 * Quality configuration
 */
export interface QualityConfig {
  thresholds: {
    repository: number;
    module: number;
    file: number;
  };
  weights: {
    [key in Severity]: number;
  };
  metrics: {
    defectDensity: {
      formula: string;
      useComplexity?: boolean;
    };
  };
  recommendation: {
    topN: number;
    effortTiers: {
      [key in EffortTier]: string;
    };
  };
  integrations: {
    slack?: {
      enabled: boolean;
      webhookUrl?: string;
      channel?: string;
    };
    teams?: {
      enabled: boolean;
      webhookUrl?: string;
    };
    issueTrackers?: {
      [key in 'github' | 'jira' | 'linear' | 'azure_devops']?: {
        enabled: boolean;
        token?: string;
      };
    };
  };
}