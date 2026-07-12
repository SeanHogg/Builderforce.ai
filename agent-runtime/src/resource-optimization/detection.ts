/**
 * Constraint Detection Engine
 * Branch: builderforce/task-319
 */

import type {
  Alert,
  AgentMetric,
  ConstraintPattern,
  Severity,
  WorkflowMetric,
  ThresholdProfile,
} from './types.js';

// Default threshold profiles by agent type and goal (human/AI)
const defaultThresholdProfiles: Record<string, ThresholdProfile> = {
  default: {
    agentType: 'human',
    profileName: 'default-human',
    overloadThresholdPct: 80,
    idleThresholdPct: 10,
    queueDepthThreshold: 50,
    queueDepthDurationMs: 15 * 60 * 1000, // 15 minutes
    errorRateThreshold: 0.05, // 5%
    errorRateDurationMs: 5 * 60 * 1000, // 5 minutes
    cycleTimeThresholdMs: 10 * 60 * 1000, // 10 minutes
    slackBreachRateThreshold: 0.01, // 1% of requests
  },

  ai: {
    agentType: 'ai',
    profileName: 'default-ai',
    overloadThresholdPct: 85, // AI can be more efficient
    idleThresholdPct: 15, // AI can tolerate more headroom
    queueDepthThreshold: 200, // More queue for AI inference
    queueDepthDurationMs: 20 * 60 * 1000, // 20 minutes
    errorRateThreshold: 0.02, // 2% (better than human)
    errorRateDurationMs: 5 * 60 * 1000, // 5 minutes
    cycleTimeThresholdMs: 60 * 1000, // 1 minute latency target
    slackBreachRateThreshold: 0.005, // 0.5%
  },
};

// In-memory profiles (loaded from config in production)
const profilesByAgentType: Map<string, ThresholdProfile> = new Map();

/**
 * Initialize the detection engine with a custom threshold profile.
 */
export function loadThresholdProfile(profile: ThresholdProfile): void {
  const key = `${profile.agentType}-${profile.profileName}`;
  profilesByAgentType.set(key, profile);
  defaultThresholdProfiles[profile.agentType] = profile; // Override default
}

/**
 * Get profile for a given agent.
 */
export function getProfileForAgent(agent: AgentMetric): ThresholdProfile {
  const key = `${agent.agentType}-${agent.role || agent.team || 'default'}`;
  return profilesByAgentType.get(key) || defaultThresholdProfiles[agent.agentType];
}

/**
 * Detect constraints across all agents and workflows.
 * Returns newly created alerts (not already present).
 */
export function detectConstraints(): Array<Alert> {
  const newlyCreated: Alert[] = [];

  // 1. Detect agent overload
  for (const [agentId, agent] of agents.entries()) {
    const profile = getProfileForAgent(agent);

    // Check queue depth overtime
    if (agent.queueDepth >= profile.queueDepthThreshold) {
      newlyCreated.push(...detectQueueDepthConstraint(agent, profile));
    }

    // Check utilization over time
    if (agent.utilization > profile.overloadThresholdPct) {
      newlyCreated.push(...detectOverloadConstraint(agent, profile));
    }

    // Check idle time
    if (agent.utilization < profile.idleThresholdPct) {
      newlyCreated.push(...detectUnderutilizationConstraint(agent));
    }

    // Check error rate
    if (agent.errorRate && agent.errorRate > profile.errorRateThreshold) {
      newlyCreated.push(...detectErrorRateConstraint(agent, profile));
    }
  }

  // 2. Detect workflow bottlenecks and skill mismatch
  for (const [workflowId, workflow] of workflows.entries()) {
    newlyCreated.push(...detectWorkflowConstraints(workflow));
  }

  return newlyCreated;
}

/**
 * Detect queue depth violation.
 */
function detectQueueDepthConstraint(agent: AgentMetric, profile: ThresholdProfile): Array<Alert> {
  const now = new Date();
  const existing = findAlertedByConstraint(agentId: agent.agentId, pattern: 'overload', now);
  if (existing) return []; // Already reporting

  return [
    {
      alertId: `alert-${agent.agentId}-queue-${now.toISOString().replace(/[:.]/g, '-')}`,
      severity: determineSeverity(agent.queueDepth, profile.overloadThresholdPct),
      confidence: calculateConfidence(agent.queueDepth, profile.overloadThresholdPct, 'queueDepth'),
      pattern: 'overload',
      agentId: agent.agentId,
      metrics: {
        queueDepth: agent.queueDepth,
      },
      thresholdType: 'queueDepth',
      thresholdValue: profile.queueDepthThreshold,
      currentValue: agent.queueDepth,
      breachedDuration: now.getTime() - (asDate(agent.lastUpdated).getTime() - 60000), // Account for snapshot timing
      description: `Queue depth ${agent.queueDepth} exceeds threshold ${profile.queueDepthThreshold} on agent ${agent.agentId}`,
      detectedAt: now,
    },
  ];
}

/**
 * Detect utilization overload.
 */
function detectOverloadConstraint(agent: AgentMetric, profile: ThresholdProfile): Array<Alert> {
  const now = new Date();
  const existing = findAlertedByConstraint(agentId: agent.agentId, pattern: 'overload', now);
  if (existing) return []; // Already reporting

  // Look back in recent metric history to see how long utilization remains above threshold
  const history = metricsApi.queryMetricHistory({
    agentId: agent.agentId,
    startTime: new Date(now.getTime() - 2 * 60 * 1000),
    endTime: now,
    timeGranularity: '1m',
    dimension: 'utilization',
  });

  const aboveThresholdCount = history.filter((h) => h.value > profile.overloadThresholdPct).length;
  const durationMs = aboveThresholdCount * 60000; // Each point is 1 min

  if (durationMs >= profile.queueDepthDurationMs) {
    return [
      {
        alertId: `alert-${agent.agentId}-util-${now.toISOString().replace(/[:.]/g, '-')}`,
        severity: determineSeverity(agent.utilization, profile.overloadThresholdPct),
        confidence: calculateConfidence(agent.utilization, profile.overloadThresholdPct, 'utilization'),
        pattern: 'overload',
        agentId: agent.agentId,
        metrics: {
          utilization: agent.utilization,
          queueDepth: agent.queueDepth,
        },
        thresholdType: 'utilization',
        thresholdValue: profile.overloadThresholdPct,
        currentValue: agent.utilization,
        breachedDuration: durationMs,
        description: `Agent ${agent.agentId} utilization ${agent.utilization}% exceeds threshold ${profile.overloadThresholdPct}% for ${durationMs / 1000} seconds`,
        detectedAt: now,
      },
    ];
  }

  return [];
}

/**
 * Detect underutilization.
 */
function detectUnderutilizationConstraint(agent: AgentMetric): Array<Alert> {
  const profile = defaultThresholdProfiles.ai;
  const now = new Date();
  const existing = findAlertedByConstraint(agentId: agent.agentId, pattern: 'underutilization', now);
  if (existing) return [];

  const history = metricsApi.queryMetricHistory({
    agentId: agent.agentId,
    startTime: new Date(now.getTime() - 2 * 60 * 1000),
    endTime: now,
    timeGranularity: '1m',
    dimension: 'utilization',
  });

  const belowThresholdCount = history.filter((h) => h.value < profile.idleThresholdPct).length;
  const durationMs = belowThresholdCount * 60000;

  if (durationMs >= 5 * 60 * 1000) {
    return [
      {
        alertId: `alert-${agent.agentId}-idle-${now.toISOString().replace(/[:.]/g, '-')}`,
        severity: 'low',
        confidence: 0.75,
        pattern: 'underutilization',
        agentId: agent.agentId,
        metrics: {
          utilization: agent.utilization,
          idleTime: agent.idleTime,
        },
        thresholdType: 'utilization',
        thresholdValue: profile.idleThresholdPct,
        currentValue: agent.utilization,
        breachedDuration: durationMs,
        description: `Agent ${agent.agentId} utilization ${agent.utilization}% below idle threshold ${profile.idleThresholdPct}% for ${durationMs / 1000} seconds`,
        detectedAt: now,
      },
    ];
  }

  return [];
}

/**
 * Detect error rate spikes.
 */
function detectErrorRateConstraint(agent: AgentMetric, profile: ThresholdProfile): Array<Alert> {
  if (!agent.errorRate) return [];

  const now = new Date();
  const existing = findAlertedByConstraint(agentId: agent.agentId, pattern: 'skill-mismatch', now);
  if (existing) return [];

  const history = metricsApi.queryMetricHistory({
    agentId: agent.agentId,
    startTime: new Date(now.getTime() - 2 * 60 * 1000),
    endTime: now,
    timeGranularity: '1m',
  });

  const aboveThresholdCount = history.filter((h) => h.value > profile.errorRateThreshold).length;
  const durationMs = aboveThresholdCount * 60000;

  if (durationMs >= profile.errorRateDurationMs) {
    return [
      {
        alertId: `alert-${agent.agentId}-error-${now.toISOString().replace(/[:.]/g, '-')}`,
        severity: calculateSeverityFromErrorRate(agent.errorRate),
        confidence: calculateConfidence(agent.errorRate, profile.errorRateThreshold, 'errorRate'),
        pattern: 'skill-mismatch',
        agentId: agent.agentId,
        metrics: {
          errorRate: agent.errorRate,
        },
        thresholdType: 'errorRate',
        thresholdValue: profile.errorRateThreshold,
        currentValue: agent.errorRate,
        breachedDuration: durationMs,
        description: `Agent ${agent.agentId} error rate ${agent.errorRate} (${(agent.errorRate * 100).toFixed(2)}%) exceeds threshold ${profile.errorRateThreshold} for ${durationMs / 1000} seconds`,
        detectedAt: now,
      },
    ];
  }

  return [];
}

/**
 * Detect workflow-level constraints.
 */
function detectWorkflowConstraints(workflow: WorkflowMetric): Array<Alert> {
  const now = new Date();
  const existing = findAlertedByConstraint(workflowId: workflow.workflowId, pattern: 'bottleneck', now);
  if (existing) return [];

  // Check cycle time
  if (workflow.cycleTime > 10 * 60 * 1000) {
    return [
      {
        alertId: `alert-${workflow.workflowId}-bottleneck-${now.toISOString().replace(/[:.]/g, '-')}`,
        severity: determineSeverity(workflow.cycleTime, 10 * 60 * 1000),
        confidence: 0.8,
        pattern: 'bottleneck',
        workflowId: workflow.workflowId,
        className: workflow.className,
        team: workflow.team,
        metrics: {
          cycleTime: workflow.cycleTime,
        },
        thresholdType: 'cycleTime',
        thresholdValue: 10 * 60 * 1000,
        currentValue: workflow.cycleTime,
        breachedDuration: 5 * 60 * 1000,
        description: `Workflow ${workflow.workflowId} cycle time ${workflow.cycleTime}ms exceeds 10min threshold`,
        detectedAt: now,
      },
    ];
  }

  return [];
}

// ==============================================================================
// Alert Detection Helpers
// ==============================================================================

function findAlertedByConstraint(agentId?: string, workflowId?: string, pattern: ConstraintPattern, now: Date): Alert | undefined {
  const existing = alertsApi.listActiveAlerts({
    pattern,
    agentId,
    workflowId,
  });
  return existing[0];
}

// Local cached API methods (call actual services to avoid circular dependency)
let alertsApi: typeof import('./alerts.js')['createAlert'];
let metricsApi: typeof import('./metric-ingestion.js')['queryMetricHistory'];

/**
 * Set up dependencies (called when detector is integrated into runtime).
 */
export function setDependencies({
  alerts: alertsService,
  metrics: metricsService,
}: {
  alerts: typeof import('./alerts.js')['createAlert'];
  metrics: typeof import('./metric-ingestion.js')['queryMetricHistory'];
}): void {
  alertsApi = alertsService;
  metricsApi = metricsService;
}

/**
 * Helper to convert lastUpdated to Date.
 */
function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date();
}

/**
 * Determine severity based on how far above/below threshold.
 */
function determineSeverity(actual: number, threshold: number): Severity {
  if (actual > threshold * 1.2) return 'critical';
  if (actual > threshold * 1.1) return 'high';
  if (actual > threshold * 1.05) return 'medium';
  return 'low';
}

/**
 * Determine severity from high error rate.
 */
function calculateSeverityFromErrorRate(errorRate: number): Severity {
  if (errorRate > 0.1) return 'critical';
  if (errorRate > 0.05) return 'high';
  if (errorRate > 0.03) return 'medium';
  return 'low';
}

/**
 * Calculate confidence score based on deviation magnitude.
 */
function calculateConfidence(actual: number, threshold: number, type: 'queueDepth' | 'utilization' | 'errorRate'): number {
  const ratio = actual / threshold;
  if (ratio > 1.3) return 0.95;
  if (ratio > 1.15) return 0.88;
  if (ratio > 1.05) return 0.75;
  if (ratio > 1.01) return 0.6;
  return 0.4;
}