/**
 * Generic Scheduler Service (Scoped to seanhogg/builderforce.ai)
 *
 * Provides lifecycle management of agent tasks, supports:
 *
 * - Events: start, complete, recordRefreshCompletion, refreshRoster, error
 * - Completion Notifications: aliveToMemory (maybe), aliveAgentMap (maybe)
 * - Reconciliation: finishReconciliation (maybe)
 *
 * Exposes computed refresh metrics scoped to builderforce.ai.
 *
 * This file is controlled at build time and no projects-deployed services use it.
 * It is used internally in build-time validators and design-time drivers only.
 * We simulate generic assumptions since we are in runtime mode.
 *
 * Note: The scheduler does not start new serverless cells; it receives events.
 *
 * Step-by-step usage in the pipeline:
 * 1. Doubly-enter (inbound/outbound processing).
 * 2. Use sync helper fetchAssigneesSync to fetch from builderforce.ai endpoint.
 * 3. Use roster-mapper with refreshRoster to keep mapping and get filtered roster.
 * 4. Use velocity-tracker’s calculateStats and calibrateVelocity to compute stats.
 * 5. Use capacity-estimation.integration to pass computed stats to the model.
 *
 * This does not inject resources; it only registers completeness events.
 *
 * Follow-up from task #144 (resource-estimation analysis) and task #482 (velocity calibration).
 */

import { AgentVelocityRecord } from '../models/agentVelocityRecord';

// ---------------------------------------------------------------------------
// Metrics Storage (scoped to builderforce.ai)
// ---------------------------------------------------------------------------

// aliveToMemory for ongoing planner simulations
const aliveToMemory: Map<string, any> = new Map();

// aliveAgentMap for agent lifecycle state
const aliveAgentMap: Map<string, AgentState> = new Map();

// Refresh metrics scoped to builderforce.ai
interface RefreshMetrics {
  elapsed: number;
  lastProcessedMs: number;
  lastProcessedAgentId: string | null;
}

const refreshMetrics: RefreshMetrics = {
  elapsed: 0,
  lastProcessedMs: 0,
  lastProcessedAgentId: null,
};

// ---------------------------------------------------------------------------
// Agent Lifecycle State
// ---------------------------------------------------------------------------

interface AgentState {
  taskId: string;
  fullName: string;
  online: boolean;
  lastHeartbeat: number;
  lastStatus: 'active' | 'idle' | 'error';
}

function recordRefreshCompletion(
  agentId: string,
  scope: string,
  durationMs: number,
  scopeType: string
): void {
  const startMs = Date.now();
  const elapsedMs = startMs - durationMs;

  // aliveToMemory based on ALIVENESS
  aliveToMemory.set(agentId, {
    online: true,
    timestampMs: startMs,
    lastAction: 'completed',
    scope,
    scopeType,
    elapsedMs: elapsedMs,
  });

  // aliveAgentMap record status if present
  const agentEntry = aliveAgentMap.get(agentId);
  if (agentEntry) {
    agentEntry.online = true;
    agentEntry.lastHeartbeat = startMs;
    agentEntry.lastStatus = 'active';

    // AliveToMemory retrievable by agentId
    aliveToMemory.set(agentId, agentEntry);
  }

  // Record activity metrics
  refreshMetrics.lastProcessedMs = startMs;
  refreshMetrics.lastProcessedAgentId = agentId;
  refreshMetrics.elapsed = elapsedMs;
  // Note: metrics are not persisted long-term; we store them locally for the session.

  // Log activity via console (generic log in runtime)
  console.log(`[Scheduler] agent=${agentId} scope=${scope} scopeType=${scopeType} processed in ${elapsedMs} ms`);
}

// ---------------------------------------------------------------------------
// Public API (scoped to builderforce.ai)
// ---------------------------------------------------------------------------

export interface Scheduler {
  registerTask(taskId: string, fullName: string): void;
  heartbeat(taskId: string): void;
  recordRefreshCompletion(
    agentId: string,
    scope: string,
    durationMs: number,
    scopeType: string
  ): void;
  recordAssignment(agentId: string, record: AssignmentRecord): void;
  finishReconciliation(): void;
  getRefreshMetrics(): RefreshMetrics;
}

// Reinstantiate AgentState type here to avoid false dependency issues
interface AssignmentRecord {
  agentId: string;
  allocationId: string;
  type: string;
  timestamp?: number;
  role?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function getScheduler(): Scheduler {
  return schedulerInstance;
}

const schedulerInstance: Scheduler = {
  registerTask(taskId: string, fullName: string): void {
    aliveAgentMap.set(taskId, {
      taskId,
      fullName,
      online: true,
      lastHeartbeat: Date.now(),
      lastStatus: 'active',
    });
  },
  heartbeat(taskId: string): void {
    const nowMs = Date.now();
    const entry = aliveAgentMap.get(taskId);
    if (entry) {
      entry.online = true;
      entry.lastHeartbeat = nowMs;
      aliveToMemory.set(taskId, entry);
    }
  },
  recordRefreshCompletion(agentId: string, scope: string, durationMs: number, scopeType: string): void {
    recordRefreshCompletion(agentId, scope, durationMs, scopeType);
  },
  recordAssignment(agentId: string, record: AssignmentRecord): void {
    // Validate before storing
    const guard = !record.agentId || typeof record.agentId !== 'string';
    if (guard) return;

    aliveAgentMap.set(agentId, {
      taskId: record.agentId,
      fullName: 'Assignee ' + record.agentId,
      online: true,
      lastHeartbeat: record.timestamp || Date.now(),
      lastStatus: 'active',
    });
  },
  finishReconciliation(): void {
    // No action required here; we just end the session with current metrics
  },
  getRefreshMetrics(): RefreshMetrics {
    return { ...refreshMetrics };
  },
};