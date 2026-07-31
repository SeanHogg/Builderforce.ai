/**
 * Conflict Detection Engine
 *
 * Per PRD rule: Detect when two DISTINCT stakeholders submit requests that assign
 * DIFFERENT P0 priorities to the SAME TEAM within the SAME REVIEW WINDOW.
 *
 * Key correctness fixes vs the prior pass:
 * - Service now owns its store instance (no module-level singleton leaking across
 *   tests/hosts), with an explicit `clear()` / `snapshot()` for test lifecycle.
 * - Dedup key is computed per request-pair with per-request versionId factored in:
 *   the enclosing versionId is NOT the sole scope — colliding versionIds inside
 *   requests are now respected.
 * - In-memory store is only mutated through the service; `getConflictById` checks
 *   the canonical key and the reverse index (id === key).
 * - Sorting + filtering in `listConflicts` is kept deterministic.
 */

import type {
  PriorityRequest,
  ConflictAlert,
  DetectConflictsRequest,
  DetectConflictsResponse,
  ConflictRule,
  ConflictStatus,
} from './types.js';
import { ConflictAlertFactory, generateConflictKey } from './conflict-alert.entity.js';
import { CONFLICT_RULE_SPEC, validateRequestsForConflictDetection } from './conflict-rule.spec.js';

export class ConflictDetectionService {
  private rule: ConflictRule;
  private store: Map<string, ConflictAlert>;

  constructor(initialRule: ConflictRule = CONFLICT_RULE_SPEC as ConflictRule) {
    this.rule = initialRule;
    this.store = new Map();
  }

  /** Clear in-memory store — drives test isolation and deterministic demos. */
  clear(): void {
    this.store.clear();
  }

  snapshot(): Map<string, ConflictAlert> {
    return new Map(this.store);
  }

  /**
   * Detect conflicts in a batch of priority requests.
   *
   * Accept-then-refine pipeline:
   * 1. Validate + drop malformed rows (no stakeholderId/teamId/priority/P0 threshold check)
   * 2. Group by team
   * 3. Within each team, consider only P0 (per spec: `priority==P0`) — both sides.
   * 4. For each distinct stakeholder pair, consider every request-pair within same review window.
   * 5. For each request-pair, compute a stable dedup key and skip if already stored (deduplication).
   */
  detectConflicts(input: DetectConflictsRequest): DetectConflictsResponse {
    try {
      const raw = validateRequestsForConflictDetection(
        input.requests as unknown[],
        input.windowThresholdDays ?? this.rule.windowConstraints.defaultDays
      ) as PriorityRequest[];

      if (raw.length < 2) {
        return { success: true, conflicts: [], duplicatesFound: 0, timestamp: new Date().toISOString() };
      }

      const teamGroups = this.groupByTeam(raw);

      const newAlerts: ConflictAlert[] = [];
      let duplicatesFound = 0;

      // Enclosure-scoped fallback window version — when a request has no own
      // versionId, we fall back to `input.versionId`.
      const scopeVersionId = input.versionId;

      for (const teamId of Object.keys(teamGroups)) {
        const teamRequests = teamGroups[teamId] as PriorityRequest[];

        // Per PRD: P0 priority rule
        const p0 = teamRequests.filter((r) => r.priority === 'P0');
        if (p0.length < 2) continue;

        // Stakeholder -> requests
        const byStakeholder = new Map<string, PriorityRequest[]>();
        for (const req of p0) {
          const sid = req.stakeholderId;
          const list = byStakeholder.get(sid);
          if (list) list.push(req);
          else byStakeholder.set(sid, [req]);
        }

        const distinctStakeholders = Array.from(byStakeholder.keys());
        if (distinctStakeholders.length < 2) continue;

        // Distinct stakeholder pairs
        for (let i = 0; i < distinctStakeholders.length; i++) {
          for (let j = i + 1; j < distinctStakeholders.length; j++) {
            const sid1 = distinctStakeholders[i];
            const sid2 = distinctStakeholders[j];
            const reqs1 = byStakeholder.get(sid1)!;
            const reqs2 = byStakeholder.get(sid2)!;

            for (const r1 of reqs1) {
              for (const r2 of reqs2) {
                if (!this.inSameReviewWindow(r1, r2, input.windowThresholdDays, scopeVersionId)) continue;

                // Per-pair dedup key: per-request version wins over scope
                const versionKey = (r1.versionId ?? r2.versionId ?? scopeVersionId) as string | undefined;
                const key = generateConflictKey(sid1, sid2, teamId, versionKey);

                if (this.store.has(key)) {
                  duplicatesFound++;
                  continue;
                }

                const alert = ConflictAlertFactory.createAlert(
                  { stakeholderId: r1.stakeholderId, stakeholderName: r1.stakeholder.name || r1.stakeholderId, role: r1.stakeholder.role, email: r1.stakeholder.email },
                  { stakeholderId: r2.stakeholderId, stakeholderName: r2.stakeholder.name || r2.stakeholderId, role: r2.stakeholder.role, email: r2.stakeholder.email },
                  {
                    teamId,
                    teamName: (r1.team?.name || r2.team?.name || teamId) as string,
                    organization: (r1.team?.organization ?? r2.team?.organization),
                  },
                  teamId,
                  r1.priority,
                  r2.priority,
                  [r1.id, r2.id],
                  versionKey
                );

                // Ensure detection date reflects detect time, not factory time
                alert.detectedAt = new Date().toISOString();

                this.store.set(key, alert);
                newAlerts.push(alert);
              }
            }
          }
        }
      }

      return {
        success: true,
        conflicts: newAlerts,
        duplicatesFound,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        conflicts: [],
        duplicatesFound: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Same-review-window predicate.
   *
   * Precedence (high to low):
   * 1. If both requests have explicit reviewWindowStart/End, use window overlap.
   * 2. If both have versionId, same versionId == same window.
   * 3. If either has createdAt within `thresholdDays` of the other — within threshold == same window.
   * 4. If a scope versionId was passed, fallback: requests that agree on that scope are within same window.
   */
  private inSameReviewWindow(
    r1: PriorityRequest,
    r2: PriorityRequest,
    windowThresholdDays: number | undefined,
    scopeVersionId: string | undefined
  ): boolean {
    const thresholdDays = windowThresholdDays ?? this.rule.windowConstraints.defaultDays;

    // Explicit window overlap check first
    if (r1.reviewWindowStart && r1.reviewWindowEnd && r2.reviewWindowStart && r2.reviewWindowEnd) {
      const start1 = new Date(r1.reviewWindowStart).getTime();
      const end1 = new Date(r1.reviewWindowEnd).getTime();
      const start2 = new Date(r2.reviewWindowStart).getTime();
      const end2 = new Date(r2.reviewWindowEnd).getTime();
      if (Number.isNaN(start1) || Number.isNaN(end1) || Number.isNaN(start2) || Number.isNaN(end2)) {
        // If dates unparseable, decline to assert overlap — fall through
      } else {
        return start1 <= end2 && start2 <= end1;
      }
    }

    // Same versionId implies same review window
    if (r1.versionId && r2.versionId) {
      if (r1.versionId === r2.versionId) return true;
      // Different explicit versionIds = different windows per spec — no conflict
      return false;
    }

    // One request has a version, the other relies on the scope version: if they agree, allow
    if (scopeVersionId) {
      const v1 = r1.versionId ?? scopeVersionId;
      const v2 = r2.versionId ?? scopeVersionId;
      if (typeof v1 === 'string' && typeof v2 === 'string' && v1 === v2) return true;
    }

    // Final fallback: createdAt proximity within threshold
    const c1 = new Date(r1.createdAt).getTime();
    const c2 = new Date(r2.createdAt).getTime();
    if (Number.isNaN(c1) || Number.isNaN(c2)) {
      // If we can't parse createdAt, and we can't claim same version/window, do not report a conflict
      return false;
    }
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    return Math.abs(c1 - c2) <= thresholdMs;
  }

  private groupByTeam(requests: PriorityRequest[]): Record<string, PriorityRequest[]> {
    const out: Record<string, PriorityRequest[]> = {};
    for (const req of requests) {
      const teamId = req.teamId || 'unknown';
      const list = out[teamId];
      if (list) list.push(req);
      else out[teamId] = [req];
    }
    return out;
  }

  // ── Query / Mutation surface ────────────────────────────────────────────────

  listConflicts(query: {
    status?: string;
    versionId?: string;
    teamId?: string;
    stakeholderId?: string;
    severity?: string;
  }): ConflictAlert[] {
    let result = Array.from(this.store.values());

    if (query.status && query.status !== 'all') {
      result = result.filter((c) => c.status === query.status);
    }
    if (query.versionId) {
      const vid = query.versionId;
      result = result.filter((c) => c.versionIds.includes(vid) || c.key.versionId === vid);
    }
    if (query.teamId) {
      result = result.filter((c) => c.key.teamId === query.teamId);
    }
    if (query.stakeholderId) {
      result = result.filter((c) => c.stakeholders.some((s) => s.stakeholderId === query.stakeholderId));
    }
    if (query.severity) {
      result = result.filter((c) => c.severity === query.severity);
    }

    return result.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
  }

  getConflictById(id: string): ConflictAlert | undefined {
    if (this.store.has(id)) return this.store.get(id);
    // Some callers pass the alert's own id (which == canonical key). Fallback search
    // only needed for legacy-migrated stores.
    return Array.from(this.store.values()).find((c) => c.id === id);
  }

  resolveConflict(
    id: string,
    action: ConflictStatus,
    note?: string,
    resolverUserId?: string
  ): ConflictAlert | null {
    const existing = this.getConflictById(id);
    if (!existing) return null;

    const updated: ConflictAlert = {
      ...existing,
      status: action,
      resolutionNote: note,
      resolvedBy: resolverUserId,
      resolvedAt: new Date().toISOString(),
    };

    this.store.set(existing.id, updated);
    return updated;
  }

  getActiveRule(): ConflictRule {
    return this.rule;
  }

  updateRule(rule: ConflictRule): ConflictRule {
    this.rule = rule;
    return this.rule;
  }
}

// ── Back-compat shims for older tests ───────────────────────────────────────

// A module-level store used by some tests that directly import the helpers.
// Kept for back-compat; the authoritative store lives inside ConflictDetectionService.
const _legacyConflictStore = new Map<string, ConflictAlert>();

export function clearConflictStore(): void {
  _legacyConflictStore.clear();
  conflictDetectionService.clear();
}

export function getConflictStore(): Map<string, ConflictAlert> {
  // Return the singleton's store for inspection
  return conflictDetectionService.snapshot();
}

export const conflictDetectionService = new ConflictDetectionService(CONFLICT_RULE_SPEC);
