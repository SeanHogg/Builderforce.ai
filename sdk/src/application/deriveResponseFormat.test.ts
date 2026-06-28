import { describe, expect, it } from 'vitest';
import {
  deriveResponseFormat,
  canUseStrictSchema,
  estimateSchemaComplexity,
  DEFAULT_SCHEMA_COMPLEXITY_CEILING,
} from './deriveResponseFormat';

const simpleSchema = {
  type: 'object',
  properties: {
    low: { type: 'number' },
    median: { type: 'number' },
    high: { type: 'number' },
  },
  required: ['low', 'median', 'high'],
  additionalProperties: false,
};

/** A deliberately huge schema: many props, each a big enum → high state count. */
function bigSchema(props: number, enumValues: number): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (let i = 0; i < props; i++) {
    properties[`f${i}`] = { type: 'string', enum: Array.from({ length: enumValues }, (_, j) => `v${j}`) };
  }
  return { type: 'object', properties };
}

describe('estimateSchemaComplexity', () => {
  it('counts nodes, enum values, and depth', () => {
    const c = estimateSchemaComplexity(simpleSchema);
    expect(c.nodes).toBe(3); // three properties
    expect(c.totalEnumValues).toBe(0);
    expect(c.score).toBe(3);
  });

  it('sums enum values across properties', () => {
    const c = estimateSchemaComplexity(bigSchema(5, 10));
    expect(c.nodes).toBe(5);
    expect(c.totalEnumValues).toBe(50);
    expect(c.score).toBe(55);
  });
});

describe('deriveResponseFormat', () => {
  it('emits strict json_schema for a simple schema', () => {
    const rf = deriveResponseFormat(simpleSchema, { name: 'SalaryEstimate' });
    expect(rf.type).toBe('json_schema');
    if (rf.type === 'json_schema') {
      expect(rf.json_schema.name).toBe('SalaryEstimate');
      expect(rf.json_schema.strict).toBe(true);
      expect(rf.json_schema.schema).toBe(simpleSchema);
    }
  });

  it('falls back to json_object when the schema exceeds the conservative default ceiling', () => {
    const schema = bigSchema(20, 10); // score 220 > 80 default
    expect(estimateSchemaComplexity(schema).score).toBeGreaterThan(DEFAULT_SCHEMA_COMPLEXITY_CEILING);
    expect(deriveResponseFormat(schema).type).toBe('json_object');
  });

  it('uses the vendor-specific ceiling when a vendor is supplied', () => {
    const schema = bigSchema(8, 8); // score 72: under default(80) AND openai(600), over googleai(60)
    expect(deriveResponseFormat(schema, { vendor: 'openai' }).type).toBe('json_schema');
    expect(deriveResponseFormat(schema, { vendor: 'googleai' }).type).toBe('json_object');
  });

  it('honours maxComplexity override', () => {
    expect(deriveResponseFormat(simpleSchema, { maxComplexity: 0 }).type).toBe('json_object');
    expect(canUseStrictSchema(simpleSchema, { maxComplexity: 1000 })).toBe(true);
  });
});
