import { describe, it, expect } from 'vitest';
import { buildDocCompliance, normaliseTags, resolveAccess, canEditAccess, parseAnalysis } from './knowledgeRoutes';
import { TenantRole } from '../../domain/shared/types';

describe('parseAnalysis', () => {
  it('parses a clean JSON object', () => {
    const r = parseAnalysis(
      JSON.stringify({
        summary: 'Good overall',
        findings: [{ category: 'inefficiency', severity: 'high', issue: 'Manual step', recommendation: 'Automate it' }],
        improvedFlow: '1. Do X',
      }),
    );
    expect(r.summary).toBe('Good overall');
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.category).toBe('inefficiency');
    expect(r.improvedFlow).toBe('1. Do X');
  });

  it('tolerates a ```json fence and leading prose', () => {
    const raw = 'Here you go:\n```json\n{"summary":"S","findings":[],"improvedFlow":"F"}\n```';
    const r = parseAnalysis(raw);
    expect(r.summary).toBe('S');
    expect(r.improvedFlow).toBe('F');
  });

  it('coerces unknown category/severity to safe defaults and drops empty findings', () => {
    const r = parseAnalysis(
      JSON.stringify({
        summary: '',
        findings: [
          { category: 'bogus', severity: 'critical', issue: 'X', recommendation: '' },
          { category: 'gap', severity: 'low' }, // no issue/recommendation → dropped
        ],
        improvedFlow: '',
      }),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.category).toBe('clarity');
    expect(r.findings[0]!.severity).toBe('medium');
  });

  it('falls back to summary-only when no valid JSON is present', () => {
    const r = parseAnalysis('The process looks fine, no JSON here.');
    expect(r.summary).toContain('looks fine');
    expect(r.findings).toEqual([]);
  });

  it('returns an empty result for empty input', () => {
    expect(parseAnalysis('')).toEqual({ summary: '', findings: [], improvedFlow: '' });
  });
});

describe('resolveAccess', () => {
  it('grants managers full access regardless of collaboration', () => {
    expect(resolveAccess({ role: TenantRole.MANAGER, isCreator: false, collabRole: null })).toBe('manager');
    expect(resolveAccess({ role: TenantRole.OWNER, isCreator: false, collabRole: null })).toBe('manager');
  });
  it('treats the creator as an editor', () => {
    expect(resolveAccess({ role: TenantRole.DEVELOPER, isCreator: true, collabRole: null })).toBe('editor');
  });
  it('honours invited editor and viewer collaborators', () => {
    expect(resolveAccess({ role: TenantRole.DEVELOPER, isCreator: false, collabRole: 'editor' })).toBe('editor');
    expect(resolveAccess({ role: TenantRole.VIEWER, isCreator: false, collabRole: 'viewer' })).toBe('viewer');
  });
  it('falls back to tenant-read (none) for an uninvited non-manager', () => {
    expect(resolveAccess({ role: TenantRole.DEVELOPER, isCreator: false, collabRole: null })).toBe('none');
  });
  it('canEditAccess is true only for manager/editor', () => {
    expect(canEditAccess('manager')).toBe(true);
    expect(canEditAccess('editor')).toBe(true);
    expect(canEditAccess('viewer')).toBe(false);
    expect(canEditAccess('none')).toBe(false);
  });
});

const members = [
  { userId: 'u1', name: 'Alice', email: 'alice@x.io' },
  { userId: 'u2', name: 'Bob', email: 'bob@x.io' },
  { userId: 'u3', name: 'Carol', email: 'carol@x.io' },
];
const NOW = Date.parse('2026-06-27T12:00:00Z');

describe('buildDocCompliance', () => {
  it('requires every active member when requiresAck is set', () => {
    const { summary, rows } = buildDocCompliance({
      members,
      acks: [{ userId: 'u1', versionNumber: 2, acknowledgedAt: '2026-06-26T00:00:00Z' }],
      training: [],
      currentVersion: 2,
      requiresAck: true,
      nowMs: NOW,
    });
    expect(summary.required).toBe(3);
    expect(summary.acknowledged).toBe(1);
    expect(summary.pending).toBe(2);
    expect(summary.percent).toBe(33);
    expect(rows.find((r) => r.userId === 'u1')!.state).toBe('acknowledged');
    expect(rows.find((r) => r.userId === 'u2')!.state).toBe('pending');
  });

  it('treats an ack of an older version as not acknowledged after republish', () => {
    const { summary } = buildDocCompliance({
      members,
      acks: [{ userId: 'u1', versionNumber: 1, acknowledgedAt: '2026-06-20T00:00:00Z' }],
      training: [],
      currentVersion: 2,
      requiresAck: true,
      nowMs: NOW,
    });
    expect(summary.acknowledged).toBe(0);
    expect(summary.pending).toBe(3);
  });

  it('flags overdue when a training due date has passed without a current ack', () => {
    const { rows, summary } = buildDocCompliance({
      members,
      acks: [],
      training: [
        { userId: 'u1', dueAt: '2026-06-01T00:00:00Z' }, // past
        { userId: 'u2', dueAt: '2026-12-01T00:00:00Z' }, // future
      ],
      currentVersion: 1,
      requiresAck: false,
      nowMs: NOW,
    });
    expect(summary.required).toBe(2); // only assigned users (requiresAck false)
    expect(rows.find((r) => r.userId === 'u1')!.state).toBe('overdue');
    expect(rows.find((r) => r.userId === 'u2')!.state).toBe('pending');
    expect(summary.overdue).toBe(1);
  });

  it('unions members and assigned users when both apply', () => {
    const { summary } = buildDocCompliance({
      members: members.slice(0, 2), // u1, u2
      acks: [{ userId: 'u3', versionNumber: 1, acknowledgedAt: '2026-06-26T00:00:00Z' }],
      training: [{ userId: 'u3', dueAt: null }], // u3 assigned but not a member
      currentVersion: 1,
      requiresAck: true,
      nowMs: NOW,
    });
    expect(summary.required).toBe(3); // u1, u2 (members) + u3 (assigned)
    expect(summary.acknowledged).toBe(1); // u3
  });

  it('is fully compliant (100%) when nothing is required', () => {
    const { summary } = buildDocCompliance({
      members,
      acks: [],
      training: [],
      currentVersion: 0,
      requiresAck: false,
      nowMs: NOW,
    });
    expect(summary.required).toBe(0);
    expect(summary.percent).toBe(100);
  });
});

describe('normaliseTags', () => {
  it('trims, lowercases, dedupes and drops empties', () => {
    expect(normaliseTags([' Onboarding ', 'onboarding', 'SECURITY', '', '  '])).toEqual([
      'onboarding',
      'security',
    ]);
  });
  it('returns [] for non-arrays', () => {
    expect(normaliseTags('nope')).toEqual([]);
    expect(normaliseTags(undefined)).toEqual([]);
  });
  it('caps at 25 tags', () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`);
    expect(normaliseTags(many).length).toBe(25);
  });
});
