# Resource Optimization Advisory System

> **Branch:** `builderforce/task-319`
> **Description:** Continuous workload monitoring, constraint detection, and actionable recommendation generation for Agent and human workflows.
> **Owner:** Code-creator Agent
> **Last Updated:** 2026-08-24

## Overview

The Resource Optimization Advisory System (ROAS) continuously monitors the utilization and efficiency of BuilderForce Agents, tracks human workflow metrics, and detects constraint patterns (overload, bottlenecks, skill mismatches, underutilization). It generates ranked optimization recommendations and delivers alerts and digests through configurable channels.

## Architecture

### Core Components

1. **Metric Ingestion Service** (`src/resource-optimization/metric-ingestion.ts`)
   - Poll-based and webhook-driven metric collection
   - Agent metadata tracking (role, skills, team, cost tier, availability)
   - Human workflow metrics (cycle time, handoff latency, rework rate, SLA breaches)

2. **Constraint Detection Engine** (`src/resource-optimization/constraint-detection.ts`)
   - Threshold-based monitoring
   - Pattern recognition (overload, bottleneck, skill mismatch, underutilization)
   - Severity assignment (Critical/High/Medium/Low) and confidence scoring
   - Duplicate suppression with configurable escalation windows

3. **Recommendation Engine** (`src/resource-optimization/recommendation-engine.ts`)
   - Action class enumeration (Re-allocate, Hire/Onboard, Workflow Optimization, Scale Agent Instance)
   - Ranked recommendation generation (composite score weighting impact, effort, urgency)
   - Headroom validation before re-allocation
   - Trend projection for hiring signals (90-day horizon)

4. **Alert & Notification Service** (`src/resource-optimization/notifications.ts`)
   - Real-time alert delivery (Critical/High severity)
   - Channels: email, Slack, PagerDuty (configurable)
   - Daily digest for Operations Manager & Engineering Lead
   - Weekly executive summary report

5. **Action Tracking** (`src/resource-optimization/action-tracking.ts`)
   - Accept/modify/defer/dismiss workflow
   - Re-allocation task generation
   - Outcome logging and engine feedback

6. **Dashboard Interfaces** (`src/resource-optimization/dashboard.ts`)
   - Real-time capacity heatmap
   - Workflow pipeline view with bottleneck indicators
   - Query API for historical trend views

## Data Model

### Metric Types

```typescript
type AgentMetric = {
  agentId: string;
  agentType: 'ai' | 'human';
  role?: string;
  team?: string;
  skillTags: string[];
  costTier: 'tier-1' | 'tier-2' | 'tier-3';

  queueDepth: number;           // Number of tasks in queue
  avgTaskDuration?: number;     // ms per task (AI only)
  completionRate?: number;      // 0-1 ratio
  errorRate?: number;           // 0-1 ratio
  idleTime: number;             // ms of idle time
  utilization: number;          // % of capacity used

  lastUpdated: Date;
  metadata?: Record<string, unknown>;
};

type WorkflowMetric = {
  workflowId: string;
  className?: string;
  team?: string;

  cycleTime: number;            // ms per full cycle
  handoffLatency: number;       // ms between handoffs
  reworkRate: number;           // 0-1 ratio
  slaBreachCount: number;
  stageThroughput: Map<string, number>;  // tasks per stage per period
  lastUpdated: Date;
};

type Alert = {
  alertId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;           // 0-1

  // Constraint pattern
  pattern: 'overload' | 'bottleneck' | 'skill-mismatch' | 'underutilization';

  // Affected resources
  agentId?: string;
  team?: string;
  workflowId?: string;

  // Metrics at detection
  metrics: Partial<AgentMetric> | Partial<WorkflowMetric>;

  // Threshold details
  thresholdType: string;
  thresholdValue: number;
  currentValue: number;
  breachedDuration: number;     // ms since breach started

  description: string;
  detectedAt: Date;
  suppressedUntil?: Date;       // for duplicate suppression
};
```

### Recommendation Types

```typescript
type ActionClass = 're-allocate' | 'hire' | 'workflow-optimization' | 'scale-instance';

type Recommendation = {
  recId: string;

  // Underlying constraint
  alertId: string;

  // Primary recommendation
  actionClass: ActionClass;

  // Affected parties
  targetAgents?: string[];         // agents receiving work
  targetWorkflow?: string;         // workflow class
  involvedTeam?: string;

  // Expected impact
  expectedImpact: {
    throughputGainPercent?: number; // % throughput improvement
    latencyReductionMs?: number;    // ms improvement
    costDelta?: string;            // "$XXXX" or "(saves $XXXX)"
  };

  // Implementation
  effortLevel: 'low' | 'medium' | 'high';
  estimatedEffortMinutes?: number;

  // Scoring
  compositeScore: number;          // 0-100
  individualScores: {
    impactScore: number;
    effortScore: number;
    urgencyScore: number;
  };

  confidence: number;              // 0-1

  // Temporal
  trendProjection?: {
    horizonDays: number;
    forecast: { day: number; demand: number; breachAt?: number }[];
  };

  description: string;
  steps: string[];
  successCriteria: string[];

  // Lifecycle
  status: 'pending' | 'accepted' | 'modified' | 'deferred' | 'dismissed';
  scheduledFor?: Date;
  actionsTaken: string[];          // outcome tracking

  created: Date;
  lastUpdated: Date;
};
```

### Action Tracking

```typescript
type ActionOutcome = {
  actionRecId: string;
  recStatus: 'resolved' | 'partially-resolved' | 'persisted';

  // Resolution details
  actualImpact: {
    throughputGainPercent?: number;
    latencyReductionMs?: number;
  };
  resolutionNotes: string;

  // Feedback engine
  feedback: {
    rankingAccuracy: number;       // how close prediction hit reality
    confidenceUpdate?: number;
  };

  capturedAt: Date;
};

type ReallocationTask = {
  taskId: string;
  recId: string;
  fromAgentId: string;
  toAgentIds: string[];

  // Task specifications
  taskDefinition: {
    workflowClass?: string;
    skillTags?: string[];
    priority?: string;
    deadline?: Date;
  };

  // Delivery
  instructions: string;          // human-readable task handoff
  recipients: string[];          // agent + supervisor emails/channels
  channels: string[];            // e.g. ['slack', 'email']
  deliveredAt?: Date;

  // Tracking
  assignedAt: Date;
  completedAt?: Date;
};
```

## Configuration

### Threshold Profiles

```typescript
type ThresholdProfile = {
  agentType: 'ai' | 'human';
  profileName: string;

  // Utilization thresholds
  overloadThresholdPct: number;           // e.g., 80%
  idleThresholdPct: number;               // e.g., 10%

  // Queue thresholds
  queueDepthThreshold: number;
  queueDepthDurationMs: number;           // min duration to trigger alert

  // Error rate thresholds
  errorRateThreshold: number;             // 0-1
  errorRateDurationMs: number;             // min duration

  // Performance thresholds
  cycleTimeThresholdMs: number;           // max cycle time
  slackBreachRateThreshold: number;       // SLA breach rate
};
```

### Notification Channels

```typescript
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
  escalationWindowMs: number;    // suppress duplicates within this window
  criticalAlertWindowMs: number; // time window for critical alerts
};
```

## API Surface

### Metric Ingestion

```ts
/**
 * Register a new agent and its metadata.
 */
await registerAgent(agentId, agentType, role, team, skillTags, costTier, availabilitySchedule);

/**
 * Push real-time metrics (webhook or polling).
 */
await pushAgentMetrics(agentId, metrics);

/**
 * Push workflow-level metrics.
 */
await pushWorkflowMetrics(workflowId, metrics);

/**
 * List all agents with current metrics.
 */
const agents = await listAgents({ includeMetrics: true });

/**
 * Query historical metric trends.
 */
const history = await queryMetricHistory({
  agentId,
  startTime,
  endTime,
  timeGranularity: '1h' | '5m' | '1d',
});
```

### Constraint Detection

```ts
/**
 * Run a full constraint detection scan.
 */
const alerts = await detectConstraints();

/**
 * Retrieve constraints for a specific agent/team/workflow.
 */
const alerts = await getConstraints({ agentId, team, workflowId });

/**
 * Check for active constraint with duplicate suppression.
 */
const activeAlert = hasActiveConstraint(agentId, alertPattern);
```

### Recommendation Engine

```ts
/**
 * Generate rankings for a specific constraint.
 */
const recommendations = await generateRecommendations(alertId);

/**
 * Get recommendations with status filters.
 */
const recs = await listRecommendations({
  alertId,
  actionClass,
  status,
  sortBy: 'compositeScore' | 'expectedImpact' | 'urgency',
  limit,
});

/**
 * Get trend projection for hiring signals.
 */
const projection = await getHiringProjection(agentId, days?: number); // default 90
```

### Notifications

```ts
/**
 * Send a real-time alert.
 */
await sendAlert(alert, channels);

/**
 * Send daily digest.
 */
await sendDailyDigest();

/**
 * Send weekly executive summary.
 */
await sendWeeklySummary();
```

### Action Tracking

```ts
/**
 * Accept, modify, or dismiss a recommendation.
 */
const updatedRec = await updateRecommendation(recId, status, notes, modifications);
// status: 'accepted' | 'modified' | 'deferred' | 'dismissed'

/**
 * Get recommendation outcomes (feedback for engine).
 */
const outcomes = await getRecommendationOutcomes(timedelta: { after: Date });

/**
 * Reject a recommendation and log the reason.
 */
await rejectRecommendation(recId, reason);

/**
 * Accept a re-allocation and generate task instructions.
 */
const taskResult = await acceptReallocation(recId, modifications);
// Returns ReallocationTask for delivery to agent/supervisor
```

### Dashboard

```ts
/**
 * Get real-time capacity heatmap.
 */
const heatmap = await getCapacityHeatmap(timeRange: { start, end });

/**
 * Get workflow pipeline view.
 */
const pipeline = await getWorkflowPipeline(teamId, timeRange);

/**
 * Get recommendation backlog.
 */
const backlog = await getRecommendationBacklog(filters);

/**
 * Query historical trends.
 */
const trends = await getHistoricalTrend({
  entity: 'agent' | 'workflow',
  entityId,
  dimension,
  startTime,
  endTime,
  timeGranularity: '1h' | '5m' | '1d' | '7d' | '30d' | '90d',
});

/**
 * Get capacity health score.
 */
const healthScore = await getCapacityHealthScore({ window: '24h' | '7d' | '30d' });
```

## Integration Points

### With BuilderForce Agents

1. **Agent Metadata:** Use existing `.builderforce/context.yaml` and agentNode doc for role/team/skill annotation.
2. **Task Queue Integration:** Deploy monitoring collector that polls `/api/agents/:id/sessions` for queue stats.
3. **Workflow Hooks:** Inject `workflow_status` tool result collection to detect bottlenecks in orchestrated workflows.

### With Human Workflows

1. **Slack/IM Channels:** Extend existing `extensions/*/runtime.ts` channels to expose webhook event ingestion points.
2. **Custom Event Sources:** Provide open CORS webhook endpoint for custom event sources (HRIS, PM tools) to push metrics.

### With builderforce.ai Cloud (Future)

1. Store constraints/recommendations in cloud DB for cross-gateway visibility.
2. Expose webhooks to cloud gateway for global fleet monitoring.
3. Centralize threshold profiles and notification configs in builderforce.ai portal.

## Out of Scope (for now)

- Autonomous executor (engine advises; humans decide).
- Compensation/budget management integration.
- Hiring onboarding workflow integration.
- Integration with specific project tools (Jira, Asana) beyond generic source adapters.
- Multi-tenant resource pooling across orgs.
- Real-time voice/chat interaction.

## Implementation Notes

- **Headroom Validation:** Before suggesting re-allocation, confirm receiving agent has ≥ 10% headroom (projected utilization ≤ 90% of threshold).
- **Duplicate Suppression:** Coalesce multiple events of same pattern in same escalation window to a single alert with confidence aggregation.
- **Trend Projection:** Use linear regression over historical demand vs. period during hiring signal generation with 95% CI.
- **Engine Feedback:** Capture actual impact after 7 days; re-train rank weights quarterly if performance gaps > 20%.
- **Security:** RBAC enforcement (viewer/contributor/admin) on alert/recommendation actions.

## Revision History

| Date | Agent Role | Change |
|------|------------|--------|
| 2026-08-24 | code-creator | Initial design and implementation plan |