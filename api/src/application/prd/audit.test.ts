import { describe, expect, it } from 'vitest';
import { buildSpecAuditRecord } from './audit';

describe('buildSpecAuditRecord', () => {
  it('builds a normalized payload with all fields', () => {
    const out = buildSpecAuditRecord({
      specId:      'spec-uuid',
      tenantId:    5,
      segmentId:   'seg-uuid',
      specVersion: 2,
      sectionId:   'requirements',
      agentRole:   'prd-author',
      action:      'edited_section',
      swimlane:    'planning',
      taskId:      42,
      detail:      { before: 'x', after: 'y' },
    });
    expect(out).toEqual({
      tenantId:    5,
      segmentId:   'seg-uuid',
      specId:      'spec-uuid',
      specVersion: 2,
      sectionId:   'requirements',
      agentRole:   'prd-author',
      action:      'edited_section',
      swimlane:    'planning',
      taskId:      42,
      detail:      JSON.stringify({ before: 'x', after: 'y' }),
    });
  });

  it('normalizes blank optional fields to null', () => {
    const out = buildSpecAuditRecord({
      specId:    'spec-uuid',
      tenantId:  1,
      sectionId: '   ',
      agentRole: '',
      action:    'noop',
      swimlane:  '  ',
    });
    expect(out.sectionId).toBeNull();
    expect(out.agentRole).toBeNull();
    expect(out.swimlane).toBeNull();
    expect(out.segmentId).toBeNull();
    expect(out.specVersion).toBeNull();
    expect(out.taskId).toBeNull();
    expect(out.detail).toBeNull();
  });

  it('passes string detail through trimmed', () => {
    const out = buildSpecAuditRecord({
      specId: 's', tenantId: 1, action: 'a', detail: '  hello  ',
    });
    expect(out.detail).toBe('hello');
  });

  it('throws when action is empty', () => {
    expect(() =>
      buildSpecAuditRecord({ specId: 's', tenantId: 1, action: '   ' }),
    ).toThrow();
  });

  it('drops non-finite specVersion and taskId', () => {
    const out = buildSpecAuditRecord({
      specId: 's', tenantId: 1, action: 'a',
      specVersion: NaN, taskId: Infinity,
    });
    expect(out.specVersion).toBeNull();
    expect(out.taskId).toBeNull();
  });
});
