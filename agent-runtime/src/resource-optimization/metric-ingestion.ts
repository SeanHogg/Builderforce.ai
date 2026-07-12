/**
 * Metric Ingestion Service for Resource Optimization Advisory System
 * Branch: builderforce/task-319
 */

import type {
  AgentMetric,
  AgentType,
  AgentRegistration,
  WorkflowMetric,
  TimeGranularity,
} from './types.js';

// In-memory storage (can be backed by Postgres later for persistence)
const agents: Map<string, AgentMetric> = new Map();
const workflows: Map<string, WorkflowMetric> = new Map();
const agentRegistrations: Array<AgentRegistration> = [];

type AgentRegistration = {
  agentId: string;
  agentType: AgentType;
  role?: string;
  team?: string;
  skillTags: string[];
  costTier: string;
  availabilitySchedule: {
    baseHours: { start: string; end: string };
    daysOfWeek: (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
  };
  registeredAt: Date;
};

/**
 * Register an agent with its metadata.
 */
export function registerAgent(registration: AgentRegistration): void {
  const { agentId, agentType } = registration;
  const exists = agents.get(agentId);

  if (exists && exists.agentType !== agentType) {
    throw new Error(`Agent ${agentId} already registered with different type`);
  }

  agentRegistrations.push({
    ...registration,
    registeredAt: registration.registeredAt || new Date(),
  });

  // Initialize metric entry if not exists
  if (!exists) {
    // System-assumed initial idle time (no activity yet)
    agents.set(agentId, {
      ...registration,
      agentType,
      role: registration.role,
      team: registration.team,
      skillTags: registration.skillTags,
      costTier: registration.costTier as any,
      queueDepth: 0,
      avgTaskDuration: undefined,
      completionRate: 0,
      errorRate: 0,
      idleTime: 0,
      utilization: 0,
      lastUpdated: new Date(),
      availabilitySchedule: registration.availabilitySchedule,
      metadata: {},
    });
  } else {
    // Update metadata, keep existing metric snapshot
    const updated = {
      ...exists,
      role: registration.role,
      team: registration.team,
      skillTags: registration.skillTags,
      availabilitySchedule: registration.availabilitySchedule,
      costTier: registration.costTier as any,
      lastUpdated: new Date(),
    };
    agents.set(agentId, updated);
  }
}

/**
 * Push real-time metrics (webhook method).
 */
export function pushAgentMetrics(agentId: string, metrics: Partial<AgentMetric>): void {
  const existing = agents.get(agentId);
  if (!existing) {
    throw new Error(`Agent ${agentId} not registered`);
  }

  agents.set(agentId, {
    ...existing,
    queueDepth: metrics.queueDepth ?? existing.queueDepth,
    avgTaskDuration: metrics.avgTaskDuration ?? existing.avgTaskDuration,
    completionRate: metrics.completionRate ?? existing.completionRate,
    errorRate: metrics.errorRate ?? existing.errorRate,
    idleTime: metrics.idleTime ?? existing.idleTime,
    utilization: metrics.utilization ?? existing.utilization,
    lastUpdated: new Date(),
    metadata: {
      ...existing.metadata,
      ...metrics.metadata,
    },
  });
}

/**
 * Push workflow-level metrics.
 */
export function pushWorkflowMetrics(workflowId: string, metrics: Partial<WorkflowMetric>): void {
  const existing = workflows.get(workflowId);
  if (!existing) {
    // Default start time is now if not provided
    workflows.set(workflowId, {
      ...metrics,
      cycleTime: metrics.cycleTime ?? 0,
      handoffLatency: metrics.handoffLatency ?? 0,
      reworkRate: metrics.reworkRate ?? 0,
      slaBreachCount: metrics.slaBreachCount ?? 0,
      stageThroughput: metrics.stageThroughput ?? new Map(),
      lastUpdated: metrics.lastUpdated ?? new Date(),
    });
  } else {
    workflows.set(workflowId, {
      ...existing,
      className: metrics.className,
      team: metrics.team,
      cycleTime: metrics.cycleTime ?? existing.cycleTime,
      handoffLatency: metrics.handoffLatency ?? existing.handoffLatency,
      reworkRate: metrics.reworkRate ?? existing.reworkRate,
      slaBreachCount: metrics.slaBreachCount ?? existing.slaBreachCount,
      stageThroughput: metrics.stageThroughput
        ? new Map([...existing.stageThroughput, ...metrics.stageThroughput])
        : existing.stageThroughput,
      lastUpdated: metrics.lastUpdated ?? new Date(),
    });
  }
}

/**
 * Statistics over a time window for an entity.
 */
export interface EntityStats {
  minV: number;
  maxV: number;
  avgV: number;
  count: number;
}

// Helper to get historical stats
function getHistoryStats<T extends Date>(
  timeseries: Map<string, T>,
  // Simplified: in memory, so "time window" just means all entries
): EntityStats {
  const values = Array.from(timeseries.values()).map((v) => (v as any).valueOf());

  if (values.length === 0) {
    return { minV: 0, maxV: 0, avgV: 0, count: 0 };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  return {
    minV: Math.min(...values),
    maxV: Math.max(...values),
    avgV: sum / values.length,
    count: values.length,
  };
}

/**
 * List all registered agents with current metrics.
 */
export function listAgents(options?: { includeInactive?: boolean }): Array<AgentMetric> {
  return Array.from(agents.values()).filter((a) => options?.includeInactive || a.utilization > 0);
}

/**
 * Get a specific agent's current metrics.
 */
export function getAgent(agentId: string): AgentMetric | undefined {
  return agents.get(agentId);
}

/**
 * List all workflows with current metrics.
 */
export function listWorkflows(): Array<WorkflowMetric> {
  return Array.from(workflows.values());
}

/**
 * Get a specific workflow's current metrics.
 */
export function getWorkflow(workflowId: string): WorkflowMetric | undefined {
  return workflows.get(workflowId);
}

/**
 * Query historical metric trends (in-memory approximation).
 * In production, this should query persisted telemetry tables.
 */
export function queryMetricHistory(params: {
  agentId?: string;
  workflowId?: string;
  startTime?: Date;
  endTime?: Date;
  timeGranularity?: TimeGranularity;
  dimension?: 'utilization' | 'throughput' | 'latency' | 'queueDepth';
}): Array<{ timestamp: Date; value: number; metric: (typeof params)['dimension'] }> {
  const { agentId, workflowId, startTime = new Date(0), endTime = new Date() } = params;

  const maps: Map<string, unknown>[] =
    agentId && workflows
      ? []
      : agentId
        ? [agents]
        : workflowId
          ? [workflows]
          : [agents, workflows];

  // Filter maps by entity
  let trimmed = maps;
  if (agentId) {
    trimmed = trimmed.map((map) => new Map([[agentId, map.get(agentId)]]));
  }
  if (workflowId) {
    trimmed = trimmed.map((map) => new Map([[workflowId, map.get(workflowId)]]));
  }

  const result: Array<{ timestamp: Date; value: number; metric: string }> = [];

  trimmed.forEach((map) => {
    for (const [_, metric] of map.entries()) {
      let timestamp: Date;
      let value: number;
      let metricName: string;

      if ('lastUpdated' in metric && 'utilization' in metric) {
        timestamp = (metric as AgentMetric).lastUpdated;
        value = (metric as AgentMetric).utilization;
        metricName = params.dimension ?? 'utilization';
      } else if ('lastUpdated' in metric && 'cycleTime' in metric) {
        timestamp = (metric as WorkflowMetric).lastUpdated;
        value = (metric as WorkflowMetric).cycleTime;
        metricName = params.dimension ?? 'cycleTime';
      } else {
        continue; // Skip unknown types
      }

      // Time window filter
      if (timestamp < startTime || timestamp >= endTime) {
        continue;
      }

      if (params.dimension && metricName !== params.dimension) {
        continue;
      }

      result.push({ timestamp, value, metric: metricName });
    }
  });

  // Sort by timestamp
  result.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return result;
}

/**
 * Cleanup stale data older than a threshold.
 */
export function pruneExpiredEntries(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
  const now = Date.now();
  const cutoff = now - maxAgeMs;

  for (const [agentId, agent] of agents.entries()) {
    if (agent.lastUpdated.getTime() < cutoff) {
      agents.delete(agentId);
    }
  }

  for (const [workflowId, workflow] of workflows.entries()) {
    if (workflow.lastUpdated.getTime() < cutoff) {
      workflows.delete(workflowId);
    }
  }

  // Prune registrations that have no metrics
  const agentIds = new Set(agents.keys());
  const activeRegistrations = agentRegistrations.filter((reg) => agentIds.has(reg.agentId));
  agentRegistrations.length = 0;
  agentRegistrations.push(...activeRegistrations);
}

/**
 * For use in tests: reset all state.
 */
export function resetInMemoryStore(): void {
  agents.clear();
  workflows.clear();
  agentRegistrations.length = 0;
}