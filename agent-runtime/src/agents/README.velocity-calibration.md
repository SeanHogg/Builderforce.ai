# Agent Velocity Calibration

## Overview

The velocity calibration system provides empirical measurement of agent performance to improve capacity estimation accuracy. It replaces or refines the initial 0.4h/SP throughput factor with real velocity data collected from completed tasks.

## Problem Statement

Previously, capacity estimates relied on:
- Approximate story-point sizing
- Assumed SP/week throughput (0.4h/SP factor)
- Lack of accurate assignee roster mapping due to 401 API errors

This led to broad timeline ranges with limited precision.

## Solution

The velocity calibration system provides:
1. **Velocity Tracking**: Collect actual task completion data per agent
2. **Roster Mapping**: Resolve assignee API access issues and map tasks to live roster
3. **Capacity Estimation**: Integrate empirical velocities into resource estimation
4. **Refresh Mechanism**: Bi-weekly (every 2 weeks) recalibration cadence

## Core Modules

### 1. Agent Velocity Tracker (`velocity-tracker.ts`)

Manages velocity data collection and calculation.

**Key Features:**
- Track story points completed per agent
- Track actual hours spent
- Calculate metrics: SP per week, hours per week
- Confidence scoring based on data consistency
- Fallback to default 40 SP/week when no data

**Usage Example:**

```typescript
import { getVelocityTracker } from '../velocity-tracker';

const tracker = getVelocityTracker();

// Record completed task
tracker.addVelocityRecord({
  agentId: 'agent-1',
  storyPoints: 10,
  actualHours: 4,
  dateRangeStart: '2025-01-01',
  dateRangeEnd: '2025-01-07',
  taskIds: ['task-1'],
  metrics: { spPerHour: 2.5, hourlyRate: 1.0, consistency: 'consistent' },
});

// Calculate velocity statistics
const stats = tracker.calculateStats('agent-1', '2025-01-01', '2025-01-14');

// Calibrate velocity with confidence
const calibration = tracker.calibrateVelocity(
  'agent-1',
  'last-2-sprints',
  4 // minimum data points
);

console.log(`Velocity: ${calibration.baseVelocity} SP/week`);
console.log(`Confidence: ${calibration.confidence}`);
console.log(`Throughput Factor: ${calibration.recommendedThroughputFactor}h/SP`);
```

**Error Codes Provided:**
- `CALIBRATION_TIMEOUT`: Fetch timed out (see assignees-fetch-gen.ts for handling)
- `INSUFFICIENT_DATA_POINTS`: Not enough completed tasks
- `ZERO_SP_WEEK`: All data resulted in zero velocity

### 2. Assignee Roster Mapper (`roster-mapper.ts`)

Resolves API access issues and maps tasks to the live agent roster.

**Key Features:**
- Graceful fallback when roster API is unavailable (401 botches)
- Caching to reduce API calls
- Batch assignment mapping
- Manual refresh support

**Usage Example:**

```typescript
import { getRosterMapper } from '../roster-mapper';

const mapper = getRosterMapper();

// Fetch fresh roster
const roster = await mapper.getRoster(true);
const assignments = mapper.getCachedAssignments();

// Map assignments to roster
const mappingResult = await mapper.mapAssignmentsToRoster(assignments, roster);

if (mappingResult.rosterStatus === 'fallback') {
  console.log('Using fallback with internal task tracking');
}

// Store mappings for later
assignments.forEach(assignment => {
  mapper.storeAssignment(assignment);
});

// Export for reporting
const exportData = mapper.exportMappings();
```

### 3. Capacity Estimator Integration (`capacity-estimation.integration.ts`)

Integrates empirical velocity data into resource estimation model.

**Key Features:**
- Uses empirical velocity for accurate timeline projections
- Confidence-based calculations
- Automatic throughput factor calculation
- Report generation for multiple projects

**Usage Example:**

```typescript
import { getCapacityEstimator } from '../capacity-estimation.integration';

const estimator = getCapacityEstimator();

// Set estimation options
estimator.setOptions({
  velocityRange: 'last-2-sprints',
  minConfidence: 0.7,
  useFallback: true,
});

// Estimate capacity for a project
const scenario = await estimator.estimateCapacityForProject(
  'project-1',
  150, // story points
  agentAllocations,
  { velocityRange: 'last-2-sprints' }
);

console.log(`Timeline: ${scenario.timeline.expectedRange} days`);
console.log(`Confidence: ${(scenario.confidence * 100).toFixed(0)}%`);
```

### 4. Velocity Calibration Scheduler (`velocity-calibration-scheduler.ts`)

Manages timing and execution of velocity recalibration.

**Key Features:**
- Bi-weekly refresh cadence
- Manual refresh trigger
- Event reporting and audit
- Scheduled refresh event logging

**Usage Example:**

```typescript
import { velocityCalibrationScheduler } from '../velocity-calibration-scheduler';

// Check if recalibration is due
if (velocityCalibrationScheduler.isRecalibrationDue()) {
  await velocityCalibrationScheduler.triggerManualRefresh({
    scope: 'agent-1',
    impactLevel: 'partial'
  });
}
```

## Actions API

The system provides action handlers for platform integration:

### `triggerManualRefresh(scope, impactLevel)`
Trigger manual velocity recalibration.

### `generateCapacityReport(projects, options)`
Generate comprehensive capacity estimation report.

### `refreshRoster(agentId)`
Refresh the assignee roster from the API.

### `recordTaskCompletion(record)`
Record a completed task's velocity data.

### `checkRefreshStatus()`
Check if recalibration is due.

### `exportVelocityData(agentId)`
Export velocity data for analysis.

## Refresh Cadence

The recommended refresh cadence is **bi-weekly (every 2 weeks)** based on sprint cycles.

After 1-2 sprints of data collection, generate a report and adjust capacity estimates accordingly.

**Example refresh workflow:**
1. Every 2 weeks, run `checkRefreshStatus()`
2. If due, run `triggerManualRefresh()` or `generateCapacityReport()`
3. Review the report for timeline tightening
4. Update project plans with refined estimates

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `velocityRange` | `'last-2-sprints'` | How far back to look for velocity data |
| `minConfidence` | `0.7` | Minimum confidence threshold (0-1) |
| `useFallback` | `true` | Use fallback velocity if calculation fails |
| `maxFallbackThroughput` | `0.5` | Max hours per SP for fallback |

## Confidence Scoring

Velocity confidence is calculated based on:
- **Consistency**: VSL < 20% = consistent, 20-50% = fluctuating, > 50% = unknown
- **Data Points**: More points increases confidence
- **Historical Range**: Longer ranges provide more stable estimates

## Acceptance Criteria (AC)

### AC1: Empirical Velocity Application
✅ Resource estimation model successfully incorporates empirical agent velocity data.

### AC2: Assignee Roster Resolution
✅ Assignees endpoint API accessible (via assignees-fetch-gen.ts helper with timeout handling) and all assignments correctly mapped to live roster when roster is available.

### AC3: Timeline Tightening
✅ Updated timeline projections show measurable reduction in variance vs initial estimates.

### AC4: Cadence Implementation
✅ Documented process for bi-weekly recalibration.

### AC5: Reporting Accuracy
✅ Reports accurately reflect updated velocities and refined timeline projections.

## Error Codes Provided

| Code | Message | Policy |
|------|---------|--------|
| `CALIBRATION_TIMEOUT` | Fetch timed out no 401 | Retry after short delay; check network and API health. |
| `INSUFFICIENT_DATA_POINTS` | Fewer than minimum data points available | Wait for more completed tasks; verify data collection. |
| `VALID_TIME_RANGE` | Calibration requested with invalid start/end dates | Ensure time range is valid. |
| `ROSTER_API_UNAVAILABLE` | Roster API returned 401 | Contact MD to verify credentials; fallback to internal tracking; log for debugging. |
| `ZERO_SP_WEEK` | Base velocity calculated as zero | Review task completion data; consider alternative time range; collect more points. |

## Future Enhancements

- Automatic weekly reporting to stakeholders
- Integration with CI/CD pipelines
- Alerting on variance thresholds
- Historical trend analysis
- Integration with project management tools
- UI for monitoring agent velocity

## Dependencies

- TypeScript
- Existing agent runtime infrastructure
- Project databases for storing velocity data