/** Team Health Dashboard shared TypeScript types */

export type ContributorType = 'human' | 'agent';

/** Contributor metadata */
export interface Contributor {
  id: string;
  name: string;
  type: ContributorType;
  assignedUserId?: string | null;
  agentRef?: string | null;
  agentHostId?: number | null;
  capacity: number;
  tasksAssigned: number;
  tasksCompleted: number;
  avgTaskDurationSeconds: number;
}

/** Extended contributor load for Workload panel (FR-1) */
export interface ContributorLoad extends Contributor {
  activeTaskCount: number;
  storyPoints: number;
}

/** Task metadata for health dashboard */
export interface HealthTask {
  id: number;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeType: ContributorType;
  priority?: string;
  tags?: string[];
  storyPoints?: number;
  blockedSince?: number; // timestamp when status became 'blocked'
  blockingNote?: string | null; // what/who is blocking
  lastActivityAt?: number; // timestamp of last status change/tag+label update
  intentionallyPaused?: boolean;
  pauseNote?: string | null;
  pauseExpiresAt?: number;
}

/** Agent-specific status per the PRD required fields */
export interface AgentHealth {
  agentHostId: number;
  agentRef: string;
  name: string;
  agentStatus: AgentStatus;
  queueDepth: number; // tasks assigned but not yet started
  lastAction?: string | null;
  lastRunStart?: number | null;
  lastRunEnd?: number | null;
  completedSinceRestart: number;
  avgTaskDurationSeconds: number;
  lastError?: string | null;
  lastAcknowledgement?: number | null;
  lastKeepAlive?: number | null;
}

/** Agent status enum as defined in PRD */
export type AgentStatus = 'idle' | 'running' | 'waiting_on_human' | 'blocked' | 'error';

/** Task status enum domain constants */
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'ready'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked';

/** Blocker details */
export interface Blocker {
  task: HealthTask;
  ageHours: number; // time since blockedSince
  blocking: { what: string | null; who: string | null };
}

/** Aging WIP item */
export interface AgingWip {
  task: HealthTask;
  ageInThresholds: number; // 1x threshold = 1, 2x = 2, 3x+ = 3
  staleDays: number;
}

/** Return type for computeOverload */
export interface OverloadResult {
  level: 'ok' | 'warning' | 'critical';
  pct: number;
}

/** Team Health Score breakdown for rendering */
export interface ScoreDimension {
  label: string;
  score: number;
}

export interface HealthScoreBreakdown {
  overall: number;
  blockerScore: number;
  overCapScore: number;
  agingScore: number;
  agentScore: number;
  breakdown: ScoreDimension[];
}

/** Team Health Score configuration */
export interface HealthScoreConfig {
  weights: {
    blockerCount: number;
    overCapacityPct: number;
    agingWipCount: number;
    agentErrorRate: number;
  };
  thresholds: {
    blockerAgeThresholds: {
      urgent: number; // hours
      high: number;
      medium: number;
      low: number;
      unknown: number;
    };
    agingWipThresholdDays: number;
    agingWipEpicThresholdDays: number;
    agentIdleQueueThresholdMin: number;
    overloadWarningPct?: number; // e.g. 120
    overloadCriticalPct?: number; // e.g. 150
  };
}

/** Alert deduplication key (immutable unique identifier for alert items) */
export interface AlertDedupKey {
  type: 'blocker' | 'overload' | 'agingWip' | 'agentError';
  resourceId: string; // task.id for blockers/agingWIP, agentHostId for agents, userId for overload
  timestamp: number;
}

/** Alert emission */
export interface HealthAlert {
  id: string;
  type: 'blocker' | 'overload' | 'agingWip' | 'agentError';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  detail: string;
  summary: string;
  resourceId: string;
  timestamp: number;
  dedupKey: AlertDedupKey;
  actionable: boolean;
}

/** Complete Team Health Dashboard data payload */
export interface TeamHealthData {
  healthScore: {
    overall: number;
    components: {
      blockerCount: number;
      overCapacityPct: number;
      agingWipCount: number;
      agentErrorRate: number;
    };
    config: HealthScoreConfig;
  };
  contributors: ContributorLoad[];
  blockers: Blocker[];
  agingWip: AgingWip[];
  agents: AgentHealth[];
  alerts: HealthAlert[];
  lastUpdated: number;
}

/** API schema response */
export interface TeamHealthResponse {
  success: boolean;
  data?: TeamHealthData;
  error?: string;
  warnings?: string[];
}
