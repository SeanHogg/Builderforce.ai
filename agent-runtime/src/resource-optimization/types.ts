/**
 * Resource Optimization Advisory System - Core Types
 * Branch: builderforce/task-319
 */

// ==============================================================================
// Metric Types
// ==============================================================================

type AgentType = 'ai' | 'human';

type CostTier = 'tier-1' | 'tier-2' | 'tier-3';

type AvailabilitySchedule = {
  baseHours: { start: string; end: string }; // HH:MM 24h
  daysOfWeek: (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
  flexibilityPct?: number; // ±% for base hours
};

type AgentMetric = {
  agentId: string;
  agentType: AgentType;
  role?: string;
  team?: string;
  skillTags: string[];
  costTier: CostTier;
  availabilitySchedule: AvailabilitySchedule;

  queueDepth: number; // Number of tasks waiting
  avgTaskDuration?: number; // ms per task (AI only)
  completionRate?: number; // 0-1 ratio
  errorRate?: number; // 0-1 ratio
  idleTime: number; // ms of idle time
  utilization: number; // % of capacity used (0-100)

  lastUpdated: Date;
  metadata?: Record<string, unknown>;
};

/**
 * Abstract workflow stage (e.g., "code-review", "fix-tests", "deploy")
 */
type WorkflowClassName = string;

type WorkflowMetric = {
  workflowId: string;
  className?: WorkflowClassName;
  team?: string;

  cycleTime: number; // ms per full cycle
  handoffLatency: number; // ms between handoffs
  reworkRate: number; // 0-1 ratio
  slaBreachCount: number;
  stageThroughput: Map<string, number>; // tasks per stage per period
  lastUpdated: Date;
};

// ==============================================================================
// Alert & Constraint Types
// ==============================================================================

type Severity = 'critical' | 'high' | 'medium' | 'low';

type ConstraintPattern = 'overload' | 'bottleneck' | 'skill-mismatch' | 'underutilization';

type Alert = {
  alertId: string;
  severity: Severity;
  confidence: number; // 0-1

  pattern: ConstraintPattern;
  agentId?: string;
  team?: string;
  workflowId?: string;

  metrics: Partial<AgentMetric> | Partial<WorkflowMetric>;

  thresholdType: string;
  thresholdValue: number;
  currentValue: number;
  breachedDuration: number; // ms since breach started

  description: string;
  detectedAt: Date;
  suppressedUntil?: Date; // for duplicate suppression
};

// ==============================================================================
// Recommendation Types
// ==============================================================================

type ActionClass = 're-allocate' | 'hire' | 'workflow-optimization' | 'scale-instance';

type Recommendation = {
  recId: string;
  alertId: string;

  actionClass: ActionClass;
  targetAgents?: string[];
  targetWorkflow?: string;
  involvedTeam?: string;

  expectedImpact: {
    throughputGainPercent?: number;
    latencyReductionMs?: number;
    costDelta?: string;
  };

  effortLevel: 'low' | 'medium' | 'high';
  estimatedEffortMinutes?: number;

  compositeScore: number; // 0-100
  individualScores: {
    impactScore: number; // SL weight
    effortScore: number; // (100 - effort) / 100
    urgencyScore: number; // derived from severity
  };

  confidence: number; // 0-1

  trendProjection?: {
    horizonDays: number;
    forecast: Array<{
      day: number;
      demand: number;
      breachAt?: number; // day when capacity would be breached
    }>;
  };

  description: string;
  steps: string[];
  successCriteria: string[];

  status: 'pending' | 'accepted' | 'modified' | 'deferred' | 'dismissed';
  scheduledFor?: Date;
  actionsTaken: string[];

  created: Date;
  lastUpdated: Date;
};

// ==============================================================================
// Action Tracking Types
// ==============================================================================

type ActionOutcome = {
  actionRecId: string;
  recStatus: 'resolved' | 'partially-resolved' | 'persisted';

  actualImpact: {
    throughputGainPercent?: number;
    latencyReductionMs?: number;
  };
  resolutionNotes: string;

  feedback: {
    rankingAccuracy: number; // how close prediction hit reality (bonus point in next cycle)
    confidenceUpdate?: number;
  };

  capturedAt: Date;
};

type ReallocationTask = {
  taskId: string;
  recId: string;
  fromAgentId: string;
  toAgentIds: string[];

  taskDefinition: {
    workflowClass?: string;
    skillTags?: string[];
    priority?: string;
    deadline?: Date;
  };

  instructions: string;
  recipients: string[];
  channels: string[];
  deliveredAt?: Date;

  assignedAt: Date;
  completedAt?: Date;
};

// ==============================================================================
// Configuration Types
// ==============================================================================

type NotificationConfig = {
  channels: {
    email?: {
      enabled: boolean;
      addresses: string[];
      includeDigest: boolean;
      includeExecutiveSummary: boolean;
    };
    slack?: {
      enabled: boolean;
      webhookUrl: string;
      channels: string[];
    };
    pagerduty?: {
      enabled: boolean;
      serviceKey: string;
      escalationPriority?: string;
    };
    inapp?: {
      enabled: boolean;
      audience: ('all' | 'ops-mgr' | 'eng-lead' | 'hr')[];
    };
  };
  escalationWindowMs: number;
  criticalAlertWindowMs: number;
};

type ThresholdProfile = {
  agentType: AgentType;
  profileName: string;
  overloadThresholdPct: number; // e.g., 80
  idleThresholdPct: number;   // e.g., 10
  queueDepthThreshold: number;
  queueDepthDurationMs: number;
  errorRateThreshold: number;
  errorRateDurationMs: number;
  cycleTimeThresholdMs: number;
  slackBreachRateThreshold: number;
};

// ==============================================================================
// Dashboard Types
// ==============================================================================

type TimeGranularity = '5m' | '15m' | '30m' | '1h' | '1d' | '7d' | '30d' | '90d';

type EntityType = 'agent' | 'workflow';
type Dimension = 'utilization' | 'throughput' | 'latency' | 'queueDepth';

type HeatmapEntry = {
  label: string; // agentId/team/workflowId
  row: string;
  col: string;
  utilization: number;
  constraints: ConstraintPattern[];
  lastUpdated: Date;
};

type BottleneckIndicator = {
  stage: string;
  throughput: number;
  avgQueueTimeMs: number;
  impact: 'blocking' | 'pending' | 'minor';
};

type TrendPoint = {
  timestamp: Date;
  value: number;
  metric: Dimension;
};