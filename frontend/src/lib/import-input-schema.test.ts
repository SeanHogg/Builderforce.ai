import { describe, expect, it } from 'vitest';
import { defineGuidedSteps, fieldLabelKey, kindLabelKey, recordKindsFrom, requiredFields, validateCell } from './import-input-schema';

describe('recordKindsFrom', () => {
  it('projects the server registry into ordered fields plus a by-key index', () => {
    const kinds = recordKindsFrom([{
      key: 'uptime',
      columns: [
        { name: 'serviceName', type: 'string', required: false, example: 'api' },
        { name: 'periodDay', type: 'dateString', required: true },
      ],
    }]);
    const uptime = kinds.uptime!;
    expect(uptime.fields.map((f) => f.key)).toEqual(['serviceName', 'periodDay']);
    expect(uptime.availableFields.periodDay).toEqual({ key: 'periodDay', type: 'dateString', required: true, example: null });
    expect(requiredFields(uptime).map((f) => f.key)).toEqual(['periodDay']);
  });
});

describe('label keys', () => {
  it('derives the catalog key from the column and kind names', () => {
    expect(fieldLabelKey('memberName')).toBe('fieldMemberName');
    expect(kindLabelKey('headcount-events')).toBe('kindHeadcountEvents');
    expect(kindLabelKey('uptime')).toBe('kindUptime');
  });
});

describe('validateCell', () => {
  const field = (type: 'string' | 'number' | 'bool' | 'dateString' | 'timestamp', required = false) =>
    ({ key: 'x', type, required, example: null });

  it('only a required field minds an empty cell', () => {
    expect(validateCell(field('number'), '')).toBeNull();
    expect(validateCell(field('number', true), '  ')).toBe('requiredEmpty');
  });

  it('checks a non-empty cell against the column type', () => {
    expect(validateCell(field('number'), '12.5')).toBeNull();
    expect(validateCell(field('number'), 'twelve')).toBe('notNumber');
    expect(validateCell(field('bool'), 'Yes')).toBeNull();
    expect(validateCell(field('bool'), true)).toBeNull();
    expect(validateCell(field('bool'), 'maybe')).toBe('notBoolean');
    expect(validateCell(field('dateString'), '2026-07-01')).toBeNull();
    expect(validateCell(field('timestamp'), '2026-08-01T09:15:00Z')).toBeNull();
    expect(validateCell(field('dateString'), 'yesterday')).toBe('notDate');
    expect(validateCell(field('string'), 'anything')).toBeNull();
  });
});

describe('defineGuidedSteps', () => {
  it('ends on the success step', () => {
    expect(defineGuidedSteps().at(-1)).toBe('step-success');
  });
});
