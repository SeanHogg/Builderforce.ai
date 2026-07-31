/**
 * Unit Tests for Conflict Detection Service
 *
 * Coverage: Edge cases before happy paths (per test-generator persona)
 *
 * Tests per PRD Acceptance Criteria:
 * - Given two distinct stakeholders with P0 for same team in same review window, alert MUST be generated
 * - Alert MUST include correct labels (conflicting items, stakeholders, detection date)
 * - Subsequent detections of identical conflict MUST NOT create duplicates
 * - Each alert MUST contain clear summary explaining rule violation
 * - List API MUST return detected conflicts filtered by status
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConflictDetectionService,
  clearConflictStore,
  getConflictStore,
  conflictDetectionService,
} from '../src/conflict-detector.service';
import {
  generateConflictKey,
  parseConflictKey,
  ConflictAlertFactory,
  buildConflictingPriorities,
} from '../src/conflict-alert.entity';
import { comparePriorities, isPriorityAtOrAbove, validateRequestsForConflictDetection } from '../src/conflict-rule.spec';

// ──────────────────────────────────────────────────────────────────────────────
// Test Data Builders
// ──────────────────────────────────────────────────────────────────────────────

function buildRequest(overrides: Partial<any> = {}): any {
  return {
    id: 'req-001',
    title: 'Test Request',
    description: 'Test Description',
    priority: 'P0',
    stakeholderId: 'alice',
    stakeholder: {
      name: 'Alice Smith',
      role: 'Product Manager',
      email: 'alice@example.com',
    },
    teamId: 'engineering',
    team: {
      name: 'Engineering Team',
      organization: 'Product',
    },
    versionId: 'V1',
    reviewWindowStart: '2025-06-01T00:00:00Z',
    reviewWindowEnd: '2025-07-01T00:00:00Z',
    createdAt: '2025-06-23T08:00:00Z',
    updatedAt: '2025-06-23T09:00:00Z',
    sourceSystem: 'priority_queue',
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Conflict Key Generation Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('generateConflictKey', () => {
  beforeEach(() => clearConflictStore());

  it('should generate stable keys with sorted stakeholders', () => {
    const key1 = generateConflictKey('bob', 'alice', 'engineering', 'V1');
    const key2 = generateConflictKey('alice', 'bob', 'engineering', 'V1');
    expect(key1).toBe(key2);
  });

  it('should include versionId when provided', () => {
    const withVersion = generateConflictKey('alice', 'bob', 'engineering', 'V1');
    const withoutVersion = generateConflictKey('alice', 'bob', 'engineering');
    expect(withVersion).toContain('V1');
    expect(withoutVersion).not.toContain('V1');
  });

  it('should produce different keys for different teams', () => {
    const key1 = generateConflictKey('alice', 'bob', 'engineering', 'V1');
    const key2 = generateConflictKey('alice', 'bob', 'platform', 'V1');
    expect(key1).not.toBe(key2);
  });
});

describe('parseConflictKey', () => {
  it('should parse key into structured object', () => {
    const key = 'alice__bob__engineering__V1';
    const parsed = parseConflictKey(key);
    expect(parsed.stakeholderId1).toBe('alice');
    expect(parsed.stakeholderId2).toBe('bob');
    expect(parsed.teamId).toBe('engineering');
    expect(parsed.versionId).toBe('V1');
  });

  it('should throw on invalid key format', () => {
    expect(() => parseConflictKey('invalid')).toThrow();
  });

  it('should handle key without versionId', () => {
    const key = 'alice__bob__engineering';
    const parsed = parseConflictKey(key);
    expect(parsed.versionId).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ConflictAlertFactory Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('ConflictAlertFactory', () => {
  beforeEach(() => clearConflictStore());

  it('should create alert with full labeling per PRD requirements', () => {
    const alert = ConflictAlertFactory.createAlert(
      { id: 'alice', name: 'Alice Smith', role: 'Product Manager' } as any,
      { id: 'bob', name: 'Bob Johnson', role: 'Engineering Manager' } as any,
      { id: 'engineering', name: 'Engineering Team' } as any,
      'engineering',
      'P0',
      'P0',
      ['req-001', 'req-002'],
      'V1'
    );

    // Labeling requirements: conflicting items, stakeholders, detection date
    expect(alert.title).toBeDefined();
    expect(alert.description).toBeDefined();
    expect(alert.detectedAt).toBeDefined();
    expect(alert.stakeholders.length).toBe(2);
    expect(alert.stakeholders[0].stakeholderId).toBe('alice');
    expect(alert.stakeholders[1].stakeholderId).toBe('bob');
    expect(alert.versionIds).toContain('V1');
    expect(alert.sourceRequestIds).toEqual(['req-001', 'req-002']);
    expect(alert.status).toBe('open');
    expect(alert.id).toBeDefined();
    expect(alert.key).toBeDefined();
  });

  it('should generate concise summary explaining rule violation', () => {
    const alert = ConflictAlertFactory.createAlert(
      { id: 'alice', name: 'Alice' } as any,
      { id: 'bob', name: 'Bob' } as any,
      { id: 'eng', name: 'Engineering' } as any,
      'eng',
      'P0',
      'P0',
      ['req-001', 'req-002'],
      'V1'
    );

    // PRD: summary MUST explain reasoning
    expect(alert.summary).toContain('Conflict');
    expect(alert.summary).toContain('P0');
    expect(alert.summary.length).toBeGreaterThan(20);
  });

  it('should attach alerts to priority version per PRD', () => {
    const alert = ConflictAlertFactory.createAlert(
      { id: 'alice', name: 'Alice' } as any,
      { id: 'bob', name: 'Bob' } as any,
      { id: 'eng', name: 'Engineering' } as any,
      'eng',
      'P0',
      'P0',
      ['req-001', 'req-002'],
      'V2'
    );

    expect(alert.versionIds).toEqual(['V2']);
  });

  it('should handle stakeholder id variations', () => {
    const alert = ConflictAlertFactory.createAlert(
      { stakeholderId: 'alice', stakeholderName: 'Alice' } as any,
      { stakeholderId: 'bob', stakeholderName: 'Bob' } as any,
      { teamId: 'eng', teamName: 'Engineering' } as any,
      'eng',
      'P0',
      'P0',
      ['req-001', 'req-002']
    );

    expect(alert.stakeholders.length).toBe(2);
  });

  it('should set critical severity for P0 vs P0', () => {
    const alert = ConflictAlertFactory.createAlert(
      { id: 'alice', name: 'Alice' } as any,
      { id: 'bob', name: 'Bob' } as any,
      { id: 'eng', name: 'Engineering' } as any,
      'eng',
      'P0',
      'P0',
      ['req-001', 'req-002']
    );

    expect(alert.severity).toBe('critical');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Conflict Detection Service — Edge Cases First
// ──────────────────────────────────────────────────────────────────────────────

describe('ConflictDetectionService — Edge Cases', () => {
  let service: ConflictDetectionService;

  beforeEach(() => {
    clearConflictStore();
    service = new ConflictDetectionService();
  });

  it('should handle empty requests array', () => {
    const result = service.detectConflicts({ requests: [] as any });
    expect(result.success).toBe(true);
    expect(result.conflicts.length).toBe(0);
    expect(result.duplicatesFound).toBe(0);
  });

  it('should handle single request (no pair possible)', () => {
    const result = service.detectConflicts({
      requests: [buildRequest({ id: 'req-001' })],
    });
    expect(result.success).toBe(true);
    expect(result.conflicts.length).toBe(0);
  });

  it('should NOT detect conflict for same stakeholder (distinct stakeholder rule)', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice' }),
        buildRequest({ id: 'req-002', stakeholderId: 'alice' }),
      ],
    });
    // Same stakeholder — no conflict per rule
    expect(result.conflicts.length).toBe(0);
  });

  it('should NOT detect conflict for different teams (same team rule)', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'platform' }),
      ],
    });
    expect(result.conflicts.length).toBe(0);
  });

  it('should NOT detect conflict for non-P0 priorities (P0 rule)', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', priority: 'P1' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', priority: 'P1' }),
      ],
    });
    expect(result.conflicts.length).toBe(0);
  });

  it('should NOT detect conflict when requests are in different review windows', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({
          id: 'req-001',
          stakeholderId: 'alice',
          versionId: 'V1',
          reviewWindowStart: '2025-06-01T00:00:00Z',
          reviewWindowEnd: '2025-06-15T00:00:00Z',
        }),
        buildRequest({
          id: 'req-002',
          stakeholderId: 'bob',
          versionId: 'V2',
          reviewWindowStart: '2025-07-01T00:00:00Z',
          reviewWindowEnd: '2025-07-15T00:00:00Z',
        }),
      ],
    });
    // Different non-overlapping windows
    expect(result.conflicts.length).toBe(0);
  });

  it('should filter invalid requests (missing stakeholderId)', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice' }),
        buildRequest({ id: 'req-002', stakeholderId: undefined as any }),
      ],
    });
    expect(result.conflicts.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Conflict Detection Service — Happy Path (PRD Acceptance Criteria)
// ──────────────────────────────────────────────────────────────────────────────

describe('ConflictDetectionService — Happy Path', () => {
  let service: ConflictDetectionService;

  beforeEach(() => {
    clearConflictStore();
    service = new ConflictDetectionService();
  });

  it('AC-1: two distinct stakeholders same team same window P0-P0 MUST generate alert', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
      ],
      versionId: 'V1',
    });

    expect(result.success).toBe(true);
    expect(result.conflicts.length).toBe(1);

    const alert = result.conflicts[0];
    // Alert labeling
    expect(alert.title).toBeDefined();
    expect(alert.stakeholders.length).toBe(2);
    expect(alert.detectedAt).toBeDefined();
    expect(alert.versionIds).toContain('V1');
    expect(alert.sourceRequestIds.length).toBe(2);
  });

  it('AC-2: alert MUST include correct labels for conflicting items, stakeholders, detection date', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
      ],
      versionId: 'V1',
    });

    const alert = result.conflicts[0];
    expect(alert.conflictingPriorities.team.teamId).toBe('engineering');
    expect(alert.conflictingPriorities.priority1).toBe('P0');
    expect(alert.conflictingPriorities.priority2).toBe('P0');
    expect(alert.stakeholders.map((s) => s.stakeholderId)).toContain('alice');
    expect(alert.stakeholders.map((s) => s.stakeholderId)).toContain('bob');
    expect(new Date(alert.detectedAt).getTime()).not.toBeNaN();
  });

  it('AC-3: duplicate detection MUST NOT create new alerts', () => {
    const requests = [
      buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
      buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
    ];

    const first = service.detectConflicts({ requests, versionId: 'V1' });
    expect(first.conflicts.length).toBe(1);
    expect(first.duplicatesFound).toBe(0);

    const second = service.detectConflicts({ requests, versionId: 'V1' });
    expect(second.conflicts.length).toBe(0); // Deduplicated
    expect(second.duplicatesFound).toBe(1);
  });

  it('AC-4: each alert MUST contain clear summary explaining rule violation', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
      ],
      versionId: 'V1',
    });

    const alert = result.conflicts[0];
    expect(alert.summary).toBeDefined();
    expect(alert.summary.length).toBeGreaterThan(20);
    // Summary should explain the violation
    expect(alert.summary.toLowerCase()).toContain('conflict');
  });

  it('should support overlapping review windows', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({
          id: 'req-001',
          stakeholderId: 'alice',
          teamId: 'engineering',
          versionId: undefined,
          reviewWindowStart: '2025-06-01T00:00:00Z',
          reviewWindowEnd: '2025-06-20T00:00:00Z',
        }),
        buildRequest({
          id: 'req-002',
          stakeholderId: 'bob',
          teamId: 'engineering',
          versionId: undefined,
          reviewWindowStart: '2025-06-15T00:00:00Z',
          reviewWindowEnd: '2025-07-01T00:00:00Z',
        }),
      ],
    });

    // Windows overlap (Jun 15-20) — should generate conflict
    expect(result.conflicts.length).toBe(1);
  });

  it('should handle three+ stakeholders (all pairs)', () => {
    const result = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'eng' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'eng' }),
        buildRequest({ id: 'req-003', stakeholderId: 'charlie', teamId: 'eng' }),
      ],
      versionId: 'V1',
    });

    // alice-bob, alice-charlie, bob-charlie = 3 conflicts
    expect(result.conflicts.length).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// List & Resolution — Per PRD List API Requirements
// ──────────────────────────────────────────────────────────────────────────────

describe('ConflictDetectionService — List & Resolution', () => {
  let service: ConflictDetectionService;

  beforeEach(() => {
    clearConflictStore();
    service = new ConflictDetectionService();
  });

  it('AC-5: List API MUST return conflicts with labels, summaries, version attachment', () => {
    service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
      ],
      versionId: 'V1',
    });

    const all = service.listConflicts({});
    expect(all.length).toBe(1);
    expect(all[0].title).toBeDefined();
    expect(all[0].summary).toBeDefined();
    expect(all[0].versionIds).toContain('V1');
  });

  it('should filter by status', () => {
    service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
      ],
      versionId: 'V1',
    });

    const open = service.listConflicts({ status: 'open' });
    expect(open.length).toBe(1);

    const resolved = service.listConflicts({ status: 'resolved' });
    expect(resolved.length).toBe(0);
  });

  it('should filter by versionId', () => {
    service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
      ],
      versionId: 'V1',
    });

    expect(service.listConflicts({ versionId: 'V1' }).length).toBe(1);
    expect(service.listConflicts({ versionId: 'V2' }).length).toBe(0);
  });

  it('should filter by teamId and stakeholderId', () => {
    service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
      ],
      versionId: 'V1',
    });

    expect(service.listConflicts({ teamId: 'engineering' }).length).toBe(1);
    expect(service.listConflicts({ teamId: 'platform' }).length).toBe(0);
    expect(service.listConflicts({ stakeholderId: 'alice' }).length).toBe(1);
    expect(service.listConflicts({ stakeholderId: 'nobody' }).length).toBe(0);
  });

  it('should support manual resolution (acknowledge, resolve, dismiss)', () => {
    const detectResult = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
      ],
      versionId: 'V1',
    });

    const id = detectResult.conflicts[0].id;

    const resolved = service.resolveConflict(id, 'resolved', 'Owner decided', 'charlie');
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolutionNote).toBe('Owner decided');
    expect(resolved!.resolvedBy).toBe('charlie');
    expect(resolved!.resolvedAt).toBeDefined();

    // After resolution, filtering by 'open' should not include it
    expect(service.listConflicts({ status: 'open' }).length).toBe(0);
    expect(service.listConflicts({ status: 'resolved' }).length).toBe(1);
  });

  it('should NOT create duplicate entries in store after resolve', () => {
    const detectResult = service.detectConflicts({
      requests: [
        buildRequest({ id: 'req-001', stakeholderId: 'alice', teamId: 'engineering' }),
        buildRequest({ id: 'req-002', stakeholderId: 'bob', teamId: 'engineering' }),
      ],
      versionId: 'V1',
    });

    const id = detectResult.conflicts[0].id;
    service.resolveConflict(id, 'dismissed', 'Not relevant', 'charlie');

    // Store should have exactly 1 entry, not 2 (the bug this tests for)
    const all = service.listConflicts({});
    expect(all.length).toBe(1);
  });

  it('getConflictById should return undefined for unknown id', () => {
    expect(service.getConflictById('nonexistent')).toBeUndefined();
  });

  it('resolveConflict should return null for unknown id', () => {
    expect(service.resolveConflict('nonexistent', 'resolved')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Rule Helpers Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('Rule Helpers', () => {
  it('comparePriorities should order P0 > P1 > P2 > P3', () => {
    expect(comparePriorities('P0', 'P1')).toBeLessThan(0);
    expect(comparePriorities('P1', 'P0')).toBeGreaterThan(0);
    expect(comparePriorities('P0', 'P0')).toBe(0);
    expect(comparePriorities('P3', 'P0')).toBeGreaterThan(0);
  });

  it('isPriorityAtOrAbove should respect threshold', () => {
    expect(isPriorityAtOrAbove('P0', 'P0')).toBe(true);
    expect(isPriorityAtOrAbove('P0', 'P1')).toBe(true);
    expect(isPriorityAtOrAbove('P1', 'P0')).toBe(false);
  });

  it('validateRequestsForConflictDetection should filter invalid entries', () => {
    const valid = validateRequestsForConflictDetection([
      buildRequest({ id: 'req-001', priority: 'P0' }),
      { id: 'bad', priority: 'P0' } as any, // missing stakeholderId, teamId
      { stakeholderId: 'alice', teamId: 'eng', priority: 'INVALID' } as any,
    ]);

    expect(valid.length).toBe(1);
  });

  it('validateRequestsForConflictDetection should throw on non-array', () => {
    expect(() => validateRequestsForConflictDetection(null as any)).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Sample Payload Integration (functional accuracy per PRD)
// ──────────────────────────────────────────────────────────────────────────────

describe('Sample Payloads — Functional Accuracy', () => {
  beforeEach(() => clearConflictStore());

  it('should handle the sample create-conflict-request payload', async () => {
    // Inline copy of sample structure to avoid fs dependency
    const samplePayload = {
      requests: [
        {
          id: 'req-001',
          title: 'Increase feature X capacity',
          description: 'Need P0 for team engineering',
          priority: 'P0' as const,
          stakeholderId: 'alice',
          stakeholder: { name: 'Alice Smith', role: 'Product Manager', email: 'alice@example.com' },
          teamId: 'engineering',
          team: { name: 'Engineering Team', organization: 'Product' },
          versionId: 'V1',
          reviewWindowStart: '2025-06-01T00:00:00Z',
          reviewWindowEnd: '2025-07-01T00:00:00Z',
          createdAt: '2025-06-23T08:00:00Z',
          updatedAt: '2025-06-23T09:00:00Z',
          sourceSystem: 'priority_queue',
        },
        {
          id: 'req-002',
          title: 'Database scaling priority',
          description: 'Critical infrastructure needs P0 priority',
          priority: 'P0' as const,
          stakeholderId: 'bob',
          stakeholder: { name: 'Bob Johnson', role: 'Engineering Manager', email: 'bob@example.com' },
          teamId: 'engineering',
          team: { name: 'Engineering Team', organization: 'Product' },
          versionId: 'V1',
          reviewWindowStart: '2025-06-01T00:00:00Z',
          reviewWindowEnd: '2025-07-01T00:00:00Z',
          createdAt: '2025-06-23T08:30:00Z',
          updatedAt: '2025-06-23T09:00:00Z',
          sourceSystem: 'priority_queue',
        },
      ],
      versionId: 'V1',
      windowThresholdDays: 30,
    };

    const service = new ConflictDetectionService();
    const result = service.detectConflicts(samplePayload as any);

    expect(result.success).toBe(true);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].id).toBeDefined();
    expect(result.conflicts[0].summary).toContain('Conflict');
  });
});
