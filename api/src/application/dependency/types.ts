/**
 * Dependency Resolution TypeScript Types
 */

// Main types exported by DependencyResolutionService
export interface TaskNode {
  id: number;
  title: string;
  status: string;
  ownerId: string | null;
  estimateDays: number | null;
  assignedTo: string | null;
  projectId: number;
  dueDate: Date | null;
  createdAt: Date;
  createdBy: string;
  dependencies: number[];  // Upstream task IDs
  downstream: number[];  // Downstream task IDs
}

export interface CriticalPath {
  tasks: TaskNode[];
  totalDurationDays: number;
  startIndex: number;
}

export interface DependencyBlocker {
  task: TaskNode;
  upstreamBlocker: TaskNode | null;
  isHard: boolean;
  stalenessDays: number;
  businessPriority?: string;
  affectedTaskCount: number;
  estimatedScheduleSlipDays: number;
}

export interface ResolutionSuggestion {
  category: 'reassignment' | 'escalation' | 'parallelization' | 'scope_reduction' | 'external_coordination' | 'risk_acceptance';
  description: string;
  suggestedOwner: string;
  estimatedTimeToUnblockMinutes: number;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface DependencyImpactScore {
  blockSize: number;
  totalSlipDays: number;
  businessPriorityWeight: number;
  score: number;
}

export interface DependencyReport {
  projectId: number;
  totalBlockers: number;
  criticalPathTasksAtRisk: number;
  projectedScheduleSlipDays: number;
  rankedBlockers: Array<{
    blocker: DependencyBlocker;
    dependencyImpactScore: DependencyImpactScore;
    resolutionSuggestions: ResolutionSuggestion[];
  }>;
  mermaidDiagram: string;
  countedTasks: number;
}

export interface Config {
  stalenessDays: number;
  reevaluateHours: number;
  businessPriorityWeights: Record<string, number>;
}

// Export config constants
export const DEFAULT_CONFIG: Config = {
  stalenessDays: 3,
  reevaluateHours: 24,
  businessPriorityWeights: {
    'blocker': 10,
    'critical': 8,
    'high': 6,
    'medium': 4,
    'low': 2,
    'normal': 1,
  },
};

export const HARD_BLOCKER_STATUSES = [
  'blocked',
  'on-hold',
  'pending-external',
  'waiting',
  'invalid',
];

export const BUSINESS_DAY_HOURS = 8;