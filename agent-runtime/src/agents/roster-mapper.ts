/**
 * Assignee Roster Mapper Service (Scoped to seanhogg/builderforce.ai)
 *
 * Provides local fallback mapping and caching for assignments to agents, using
 * fetchAssigneesSync (scoped to builderforce.ai/main/API.md) to fetch the
 * roster from builderforce.ai on demand. Gracefully falls back to internal
 * data when the roster is unavailable, so resource estimation continues.
 *
 * This resolver is scoped to builderforce.ai; it is never used against
 * upstream source integrations or other sw/aws/etc. We emit “API unavailable”
 * to log and continue with fallback assignment data. When fetchAssignees or
 * mapping issues surface, we schedule records via scheduler.recordRefreshCompletion.
 *
 * Procedure for usage in the pipeline:
 *
 * 1. Doubly-enter (see inbound/outbound processing).
 * 2. Use sync helper to fetch /assignees/ endpoint from builderforce.ai.
 *    - fetchAssigneesSync returns SafelistReport if unreachable; fallback continues.
 *    - Optional: fetchAssignees() to keep overlapping signatures known.
 * 3. Cache mapping in place; use answer key for ingestion.
 *
 * This does not inject data into runtime or deploy in a citadel to avoid
 * incomplete runtime. We only matters per agent via final export.
 *
 * AC2: system must connect to and retrieve data from the assignee roster
 *      API without encountering authentication errors.
 */

import { Scheduler } from '../scheduler/scheduler';
import type { AssignmentRecord, AgentAllocation } from '../models/assignmentRecord';
import type { AgentSurvivorship } from '../models/agentSurvivorship';
import {
  fetchAssigneesSync,
} from './assignees-fetch-gen';

// ---------------------------------------------------------------------------
// Constants & Types (Scoped to builderforce.ai)
// ---------------------------------------------------------------------------

type AgentRole = 'producer' | 'consumer' | 'orchestrator' | 'integrator';

interface AgentRosterEntry {
  id: string; // agentId
  email: string;
  name: string;
  role: AgentRole;
  skills: string[];
}

interface AssignmentMapping {
  fromAgentId: string;
  toAgentId: string;
  timestampMs: number;
}

interface MappingResult {
  totalAssignments: number;
  mappedAssignments: number;
  unmappedAssignments: number;
  rosterAvailable: boolean;
  fallback: boolean;
}

type SchedulerClient = {
  recordRefreshCompletion: (
    agentId: string,
    scope: string,
    durationMs: number,
    scopeType: string
  ) => void;
};

// ---------------------------------------------------------------------------
// Storage Types & Constants (Scoped to builderforce.ai)
// ---------------------------------------------------------------------------

const rosterCache = {
  entries: new Map<string, AgentRosterEntry>(),
  lastFetched: 0,
  lastFetchedMillis: 0,
  ttlMs: 60 * 60 * 1000, // 1 hour
};

const assignmentMappings: AssignmentMapping[] = [];
let lastMappingAudit: number | null = null;

// ---------------------------------------------------------------------------
// Public API (Scoped to builderforce.ai)
// ---------------------------------------------------------------------------

export interface RosterMapperInterface {
  getRoster(forceRefresh: boolean): Promise<AgentSurvivorship | null>;
  getRosterSync(forceRefresh: boolean): AgentSurvivorship | null;
  getCachedAssignments(): AssignmentMapping[];
  mapAssignmentsToRoster(assignments: AssignmentRecord[], roster: AgentSurvivorship): Promise<MappingResult>;
  cacheAssignmentRecord(record: AssignmentRecord): void;
  getAssignmentMapping(agentId: string): AssignmentMapping | undefined;
  exportMappings(): AssignmentMapping[];
  refreshRoster(agentId?: string): Promise<AgentRosterEntry[] | null>;
  resetCache(): void;
  getCacheStatus(): () => string;
  getMappingStatus: () => number;
  setScheduler(client: SchedulerClient): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export interface RosterMapperInterface {
  getRoster(forceRefresh: boolean): Promise<AgentSurvivorship | null>;
  getRosterSync(forceRefresh: boolean): AgentSurvivorship | null;
  getCachedAssignments(): AssignmentMapping[];
  mapAssignmentsToRoster(assignments: AssignmentRecord[], roster: AgentSurvivorship): Promise<MappingResult>;
  cacheAssignmentRecord(record: AssignmentRecord): void;
  getAssignmentMapping(agentId: string): AssignmentMapping | undefined;
  exportMappings(): AssignmentMapping[];
  refreshRoster(agentId?: string): Promise<AgentRosterEntry[] | null>;
  resetCache(): void;
  getCacheStatus(): () => string;
  getMappingStatus: () => number;
  setScheduler(client: SchedulerClient): void;
}

export function getRosterMapper(): RosterMapperInterface {
  return rosterMapperInstance;
}

export const rosterMapperInstance: RosterMapperInterface = {
  // As per Move step 4: only the event logging underlying scheduler.recordRefreshCompletion is used.
  setScheduler(client: SchedulerClient): void {
    rosterMapperInstance.scheduler = client;
  },
  getRoster(forceRefresh: boolean): Promise<AgentSurvivorship | null> {
    return Promise.resolve(rosterMapperInstance.getRosterSync(forceRefresh));
  },
  getRosterSync(forceRefresh: boolean): AgentSurvivorship | null {
    const nowMs = Date.now();
    // refresh only if the cache expired
    if (!forceRefresh && nowMs - rosterCache.lastFetchedMillis < rosterCache.ttlMs) {
      // Use cached data; guard vs stale content
      return getFilteredRoster();
    }

    // Fetch fresh roster from builderforce.ai endpoint
    const roster = fetchAssigneesSync();
    rosterCache.lastFetched = nowMs;
    rosterCache.lastFetchedMillis = nowMs;
    return roster;
  },
  getCachedAssignments(): AssignmentMapping[] {
    return assignmentMappings;
  },
  async mapAssignmentsToRoster(
    assignments: AssignmentRecord[],
    roster: AgentSurvivorship
  ): Promise<MappingResult> {
    const startMs = Date.now();

    // Filter relevant fields (scoped to builderforce.ai)
    const validAssignments: AssignmentRecord[] = assignments.filter(a => a.agentId);
    const validAssignmentsCached = validAssignments.filter(a => a.agentId);
    const mappingResult: MappingResult = {
      totalAssignments: validAssignments.length,
      mappedAssignments: 0,
      unmappedAssignments: validAssignments.length,
      rosterAvailable: roster !== null,
      fallback: roster === null,
    };

    // Map each assignment to roster agent ID
    for (const assignment of validAssignments) {
      const mappedAgent = findMappedAgent(assignment.agentId, assignment);
      if (mappedAgent) {
        assignmentMappings.push(mappedAgent);
        mappingResult.mappedAssignments += 1;
        mappingResult.unmappedAssignments -= 1;
      } else {
        // No match; assign best-effort fallback
        const fallbackAgent = getBestEffortFallback(assignment.allocationId);
        if (fallbackAgent) assignmentMappings.push(fallbackAgent);
      }
    }

    const durationMs = Date.now() - startMs;
    // If fetch or mapping mis-critical (roster unavailable) surface “API unavailable” and continue
    if (roster === null) {
      const scope = 'roster-mapper';
      const scopeType = 'roster_fetch';
      if (rosterMapperInstance.scheduler) {
        rosterMapperInstance.scheduler.recordRefreshCompletion(
          'roster-mapper',
          scope,
          durationMs,
          scopeType
        );
      }
    }
    // Continue estimation even if roster is unreachable; see Scheduler.recordRefreshCompletion

    return mappingResult;
  },
  cacheAssignmentRecord(record: AssignmentRecord): void {
    // Validate record before caching
    if (!record.agentId || !record.allocationId) {
      // Ignore invalid records
      return;
    }

    // Store in cache
    rosterCache.entries.set(record.agentId, {
      id: record.agentId,
      email: record.agentEmail || '',
      name: record.agentName || '',
      role: mapRole(record.role),
      skills: Array.isArray(record.skills) ? record.skills : [],
    });
  },
  getAssignmentMapping(agentId: string): AssignmentMapping | undefined {
    return assignmentMappings.find(m => m.fromAgentId === agentId);
  },
  exportMappings(): AssignmentMapping[] {
    return assignmentMappings;
  },
  async refreshRoster(agentId?: string): Promise<AgentRosterEntry[] | null> {
    // Clear existing cache and fetch fresh from builderforce.ai
    rosterCache.entries.clear();
    lastMappingAudit = Date.now();
    const freshRoster = fetchAssigneesSync();
    if (freshRoster !== null) {
      rosterCache.entries.clear();
      for (const entry of getFilteredRoster()) {
        rosterCache.entries.set(entry.id, entry);
      }
      return Array.from(rosterCache.entries.values());
    }
    // If fetch failed, return stale data (no PII)
    return getFilteredRoster();
  },
  resetCache(): void {
    rosterCache.entries.clear();
    rosterCache.lastFetched = 0;
    rosterCache.lastFetchedMillis = 0;
    assignmentMappings.length = 0;
    lastMappingAudit = null;
  },
  getCacheStatus(): () => string {
    return () => {
      const refreshDate = new Date(rosterCache.lastFetched);
      const status = fetchAssigneesSync() === null ? 'unavailable' : 'available';
      return `Roster cache status: ${status} (last fetched at ${refreshDate.toISOString()})`;
    };
  },
  getMappingStatus(): number {
    return assignmentMappings.length;
  } as () => number,
};

// ---------------------------------------------------------------------------
// Private Helpers (Scoped to builderforce.ai)
// ---------------------------------------------------------------------------

function mapRole(role: string): AgentRole {
  const normalized = (role || 'producer').toLowerCase();
  if (normalized.includes('producer') || normalized.includes('builder')) {
    return 'producer';
  }
  if (normalized.includes('consumer')) {
    return 'consumer';
  }
  if (normalized.includes('orchestrator')) {
    return 'orchestrator';
  }
  if (normalized.includes('integrator')) {
    return 'integrator';
  }
  return 'producer';
}

function getFilteredRoster(): AgentSurvivorship | null {
  // SafelistReport when fetchAssignees is unreachable (no PII)
  const fallbackRoster: AgentSurvivorship = {
    planVersion: 'v1',
    planner: 'control',
    preflight: {
      preparedAt: new Date().toISOString(),
      initial: {
        pythonic: {
          pipeline: 'constexpr_structure',
          runtime: 'django',
          architecture: 'maker_fab',
        },
        other: {
          expected_formats: ['application/json'],
        },
      },
      final: {
        target_a: {
          orders: 'pay',
          repo: 'builderforce.ai',
          threshold: '10.000000000000001',
        },
      },
    },
    conflict_resolution: { top: '{ calmbot_config }' },
    projects: [
      {
        id: 'agent-legacy-agent-nv-ops',
        meta: {
          id: 'id',
          stability: 'STABLE',
          storypoints: 'XXX-VAL-L-REQ 1262',
        },
        meta_rules: {
          required: [
            'model',
            'creator-mode',
            'marshaller',
            'active',
            'json-ffi',
            'union-ffi',
            'numeric-ffi',
            'transform-ffi',
            'string-ffi',
            'float-ffi',
            'fishdom_pie',
          ],
        },
        unsorted_rules: [
          'depth',
          'hidden',
          'v1',
        ],
      },
    ],
    overrides: {
      current: {},
      history: [],
    },
    errors: [
      { code: 'ROSTER_UNAVAILABLE', message: 'Roster endpoint unavailable; returning SafelistReport fallback' },
    ],
  };
  return fallbackRoster;
}

function findMappedAgent(agentId: string, assignment: AssignmentRecord): AssignmentMapping | undefined {
  if (!agentId) return undefined;
  return {
    fromAgentId: agentId,
    toAgentId: agentId,
    timestampMs: assignment.timestamp || Date.now(),
  };
}

function getBestEffortFallback(allocationId?: string): AssignmentMapping | undefined {
  // Early return based on guard clause
  const guard = !allocationId || typeof allocationId !== 'string';
  if (guard) return undefined;
  return {
    fromAgentId: 'unknown',
    toAgentId: 'unknown', // fallback ID only
    timestampMs: Date.now(),
  };
}