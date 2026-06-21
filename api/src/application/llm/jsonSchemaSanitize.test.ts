import { describe, expect, it } from 'vitest';
import {
  CEREBRAS_STRICT_KEYWORDS,
  sanitizeExtraBodyForVendor,
  schemaStripKeywordsForVendor,
  stripUnsupportedSchemaKeywords,
  vendorNeedsSchemaStrip,
} from './jsonSchemaSanitize';
// Importing the registry triggers `registerSchemaDialectResolver(...)` at
// module-init, which wires the vendor → strip-set map the sanitizer reads.
// Without this import the resolver defaults to "strip nothing" (permissive).
import './vendors/registry';

// The shape of these tests mirrors the real production failure
// (`llm-2cc6ba1b-...`, 2026-05-26): Cerebras returns 400 with
// `Invalid fields for schema with types ['string']: {'maxLength'}` whenever a
// consumer ships a Zod-generated `response_format` that includes string-length
// constraints. The same bounce fires when the call goes via OpenRouter and
// gets routed to Cerebras as the upstream — hence the vendor list covers
// both ids.

describe('vendorNeedsSchemaStrip', () => {
  it('strips for cerebras and openrouter (cerebras-backed free routing)', () => {
    expect(vendorNeedsSchemaStrip('cerebras')).toBe(true);
    expect(vendorNeedsSchemaStrip('openrouter')).toBe(true);
  });

  it('passes through for vendors with permissive validators', () => {
    expect(vendorNeedsSchemaStrip('googleai')).toBe(false);
    expect(vendorNeedsSchemaStrip('nvidia')).toBe(false);
    expect(vendorNeedsSchemaStrip('ollama')).toBe(false);
    expect(vendorNeedsSchemaStrip('cloudflare')).toBe(false);
  });

  it('passes through for an unknown / unregistered vendor id', () => {
    expect(vendorNeedsSchemaStrip('totally-not-a-vendor')).toBe(false);
  });
});

describe('schemaStripKeywordsForVendor (metadata-driven)', () => {
  it('returns the cerebras strict set for cerebras', () => {
    const set = schemaStripKeywordsForVendor('cerebras');
    for (const kw of CEREBRAS_STRICT_KEYWORDS) expect(set.has(kw)).toBe(true);
    expect(set.size).toBe(CEREBRAS_STRICT_KEYWORDS.length);
  });

  it('openrouter inherits the cerebras set (it routes :free to cerebras)', () => {
    expect([...schemaStripKeywordsForVendor('openrouter')].sort()).toEqual(
      [...CEREBRAS_STRICT_KEYWORDS].sort(),
    );
  });

  it('returns an empty set for permissive vendors', () => {
    expect(schemaStripKeywordsForVendor('googleai').size).toBe(0);
    expect(schemaStripKeywordsForVendor('nvidia').size).toBe(0);
  });
});

describe('stripUnsupportedSchemaKeywords', () => {
  it('removes string-length constraints from a flat schema', () => {
    const schema = { type: 'string', maxLength: 100, minLength: 1 };
    expect(stripUnsupportedSchemaKeywords(schema)).toEqual({ type: 'string' });
  });

  it('removes format and pattern from a flat schema', () => {
    const schema = { type: 'string', format: 'email', pattern: '^\\S+@\\S+$' };
    expect(stripUnsupportedSchemaKeywords(schema)).toEqual({ type: 'string' });
  });

  it('removes number bounds and multipleOf', () => {
    const schema = {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      exclusiveMinimum: 0,
      multipleOf: 2,
    };
    expect(stripUnsupportedSchemaKeywords(schema)).toEqual({ type: 'integer' });
  });

  it('walks nested properties (production case — name has maxLength deep inside an object)', () => {
    const schema = {
      type: 'object',
      required: ['name', 'age'],
      properties: {
        name: { type: 'string', maxLength: 50, minLength: 1 },
        age:  { type: 'integer', minimum: 0, maximum: 150 },
        tags: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 20 } },
      },
      additionalProperties: false,
    };
    expect(stripUnsupportedSchemaKeywords(schema)).toEqual({
      type: 'object',
      required: ['name', 'age'],
      properties: {
        name: { type: 'string' },
        age:  { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    });
  });

  it('preserves enum (Cerebras accepts these)', () => {
    const schema = { type: 'string', enum: ['a', 'b', 'c'], maxLength: 1 };
    expect(stripUnsupportedSchemaKeywords(schema)).toEqual({ type: 'string', enum: ['a', 'b', 'c'] });
  });

  it('preserves required + properties (validator-relevant structure)', () => {
    const schema = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', maxLength: 36 } },
    };
    expect(stripUnsupportedSchemaKeywords(schema)).toEqual({
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    });
  });

  it('walks oneOf / anyOf / allOf branches', () => {
    const schema = {
      oneOf: [
        { type: 'string', maxLength: 10 },
        { type: 'object', properties: { x: { type: 'integer', minimum: 0 } } },
      ],
    };
    expect(stripUnsupportedSchemaKeywords(schema)).toEqual({
      oneOf: [
        { type: 'string' },
        { type: 'object', properties: { x: { type: 'integer' } } },
      ],
    });
  });

  it('handles additionalProperties as a sub-schema', () => {
    const schema = {
      type: 'object',
      additionalProperties: { type: 'string', maxLength: 20 },
    };
    expect(stripUnsupportedSchemaKeywords(schema)).toEqual({
      type: 'object',
      additionalProperties: { type: 'string' },
    });
  });

  it('does not mutate the input schema', () => {
    const schema = { type: 'string', maxLength: 5 } as Record<string, unknown>;
    const out = stripUnsupportedSchemaKeywords(schema);
    expect(schema.maxLength).toBe(5);
    expect(out).not.toBe(schema);
  });
});

describe('sanitizeExtraBodyForVendor', () => {
  const buildBody = () => ({
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'roadmap',
        strict: true,
        schema: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', maxLength: 100 },
            count: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
  });

  it('strips the inner schema when the vendor is strict (cerebras)', () => {
    const body = buildBody();
    const out = sanitizeExtraBodyForVendor('cerebras', body) as Record<string, unknown>;
    expect((((out.response_format as Record<string, unknown>).json_schema as Record<string, unknown>).schema)).toEqual({
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        count: { type: 'integer' },
      },
    });
  });

  it('strips the inner schema when the vendor is openrouter (cerebras-backed routing)', () => {
    const body = buildBody();
    const out = sanitizeExtraBodyForVendor('openrouter', body) as Record<string, unknown>;
    const inner = (((out.response_format as Record<string, unknown>).json_schema as Record<string, unknown>).schema) as Record<string, unknown>;
    const props = inner.properties as Record<string, Record<string, unknown>>;
    expect(props.title).toEqual({ type: 'string' });
    expect(props.count).toEqual({ type: 'integer' });
  });

  it('returns the same reference when the vendor is permissive (googleai)', () => {
    const body = buildBody();
    const out = sanitizeExtraBodyForVendor('googleai', body);
    expect(out).toBe(body);
  });

  it('returns the same reference when there is no response_format', () => {
    const body = { tools: [{ name: 'x' }] };
    const out = sanitizeExtraBodyForVendor('cerebras', body);
    expect(out).toBe(body);
  });

  it('returns undefined when extraBody is undefined', () => {
    expect(sanitizeExtraBodyForVendor('cerebras', undefined)).toBeUndefined();
  });

  it('preserves the response_format.type and json_schema.name/strict around the inner-schema rewrite', () => {
    const body = buildBody();
    const out = sanitizeExtraBodyForVendor('cerebras', body) as Record<string, unknown>;
    const rf = out.response_format as Record<string, unknown>;
    expect(rf.type).toBe('json_schema');
    const js = rf.json_schema as Record<string, unknown>;
    expect(js.name).toBe('roadmap');
    expect(js.strict).toBe(true);
  });
});
