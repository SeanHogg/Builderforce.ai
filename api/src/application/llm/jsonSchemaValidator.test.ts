import { describe, expect, it } from 'vitest';
import { validateJsonSchema } from './jsonSchemaValidator';

// The shape of these tests mirrors the real failure pattern from the
// hired.video career_360 support ticket. If they pass we know the gateway's
// strict-mode retry actually catches what the consumer's Zod would catch.

describe('validateJsonSchema', () => {
  it('returns no errors when value matches schema', () => {
    const schema = {
      type: 'object',
      required: ['roadmap'],
      properties: {
        roadmap: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'horizon'],
            properties: {
              id:      { type: 'string' },
              horizon: { type: 'string', enum: ['30d', '60d', '90d', '180d'] },
            },
          },
        },
      },
    };
    const value = { roadmap: [{ id: 'r1', horizon: '30d' }, { id: 'r2', horizon: '90d' }] };
    expect(validateJsonSchema(value, schema)).toEqual([]);
  });

  it('catches missing required nested field (career_360 case 1)', () => {
    const schema = {
      type: 'object',
      properties: {
        roadmap: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'horizon'],
            properties: { id: { type: 'string' }, horizon: { type: 'string' } },
          },
        },
      },
    };
    const value = { roadmap: [{ horizon: '30d' /* id missing */ }] };
    const errs = validateJsonSchema(value, schema);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.path).toBe('roadmap[0].id');
    expect(errs[0]!.message).toMatch(/required/);
  });

  it('catches enum mismatch (career_360 case 2)', () => {
    const schema = {
      type: 'object',
      properties: {
        roadmap: {
          type: 'array',
          items: {
            type: 'object',
            properties: { horizon: { type: 'string', enum: ['30d', '60d', '90d', '180d'] } },
          },
        },
      },
    };
    const value = { roadmap: [{ horizon: '45d' }] };
    const errs = validateJsonSchema(value, schema);
    expect(errs.length).toBe(1);
    expect(errs[0]!.path).toBe('roadmap[0].horizon');
    expect(errs[0]!.message).toMatch(/enum/);
  });

  it('catches type mismatch deep in nested array (career_360 case 3 — toolId is array, not string)', () => {
    const schema = {
      type: 'object',
      properties: {
        gaps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { toolId: { type: 'string' } },
          },
        },
      },
    };
    const value = {
      gaps: [
        { toolId: 'ok' },
        { toolId: 'still-ok' },
        { toolId: ['array', 'instead'] },
      ],
    };
    const errs = validateJsonSchema(value, schema);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.path).toBe('gaps[2].toolId');
    expect(errs[0]!.message).toMatch(/expected string, got array/);
  });

  it('respects maxErrors to keep the response small', () => {
    const schema = {
      type: 'array',
      items: { type: 'string' },
    };
    const value = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const errs = validateJsonSchema(value, schema, { maxErrors: 3 });
    expect(errs).toHaveLength(3);
  });

  it('catches additionalProperties: false violations', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string' } },
    };
    const value = { id: 'r1', extra: 'nope' };
    const errs = validateJsonSchema(value, schema);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.path).toBe('extra');
  });

  it('handles oneOf', () => {
    const schema = {
      oneOf: [
        { type: 'string' },
        { type: 'number' },
      ],
    };
    expect(validateJsonSchema('hi', schema)).toEqual([]);
    expect(validateJsonSchema(42,   schema)).toEqual([]);
    expect(validateJsonSchema(true, schema).length).toBe(1);
  });

  it('skips unsupported keywords without false positives', () => {
    // `format` is unsupported — should not flag a value.
    const schema = { type: 'string', format: 'email' };
    expect(validateJsonSchema('not-an-email', schema)).toEqual([]);
  });
});
