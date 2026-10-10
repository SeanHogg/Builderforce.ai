import { describe, expect, it } from 'vitest';
import {
  CEREBRAS_STRICT_KEYWORDS,
  applySchemaDialect,
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

  it('rewrites for nvidia (propertyNames) and anthropic (closed objects)', () => {
    expect(vendorNeedsSchemaStrip('nvidia')).toBe(true);
    expect(vendorNeedsSchemaStrip('anthropic')).toBe(true);
  });

  it('passes through for vendors with permissive validators', () => {
    expect(vendorNeedsSchemaStrip('googleai')).toBe(false);
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
  });

  it('nvidia strips only propertyNames (NIM grammar: Unimplemented keys: ["propertyNames"])', () => {
    expect([...schemaStripKeywordsForVendor('nvidia')]).toEqual(['propertyNames']);
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

// ---------------------------------------------------------------------------
// Dialect rewrites beyond stripping — production 2026-10-10:
//   Anthropic 400 `output_config.format.schema: For 'object' type,
//     'additionalProperties' must be false`
//   NVIDIA NIM 400 `Grammar error: Unimplemented keys: ["propertyNames"]`
// ---------------------------------------------------------------------------

describe('applySchemaDialect — closeObjects', () => {
  const CLOSE = { stripKeywords: [], closeObjects: true } as const;

  it('closes every object node: root, properties, items, anyOf/oneOf/allOf, $defs, definitions', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'object', properties: { x: { type: 'string' } } },
        list: { type: 'array', items: { type: 'object', properties: { y: { type: 'number' } } } },
        either: { anyOf: [{ type: 'object', properties: {} }, { type: 'string' }] },
        one: { oneOf: [{ type: ['object', 'null'], properties: {} }] },
        all: { allOf: [{ properties: { z: { type: 'boolean' } } }] },
        ref: { $ref: '#/$defs/Thing' },
      },
      $defs: { Thing: { type: 'object', properties: { t: { type: 'string' } } } },
      definitions: { Legacy: { type: 'object' } },
    };
    const out = applySchemaDialect(schema, CLOSE) as any;
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.a.additionalProperties).toBe(false);
    expect(out.properties.list.items.additionalProperties).toBe(false);
    expect(out.properties.either.anyOf[0].additionalProperties).toBe(false);
    expect(out.properties.either.anyOf[1]).toEqual({ type: 'string' });
    expect(out.properties.one.oneOf[0].additionalProperties).toBe(false);
    expect(out.properties.all.allOf[0].additionalProperties).toBe(false);
    expect(out.$defs.Thing.additionalProperties).toBe(false);
    expect(out.definitions.Legacy.additionalProperties).toBe(false);
    expect(out.properties.ref).toEqual({ $ref: '#/$defs/Thing' });
  });

  it('overrides a caller-supplied `true` or schema-valued additionalProperties (z.record)', () => {
    const out = applySchemaDialect({
      type: 'object',
      properties: { open: { type: 'object', additionalProperties: true }, rec: { type: 'object', additionalProperties: { type: 'string' } } },
    }, CLOSE) as any;
    expect(out.properties.open.additionalProperties).toBe(false);
    expect(out.properties.rec.additionalProperties).toBe(false);
  });

  it('does not touch non-object nodes and never mutates the input', () => {
    const schema = { type: 'object', properties: { s: { type: 'string' } } };
    const snapshot = JSON.parse(JSON.stringify(schema));
    const out = applySchemaDialect(schema, CLOSE) as any;
    expect(out.properties.s).toEqual({ type: 'string' });
    expect(schema).toEqual(snapshot);
  });

  it('strips per keyword without mistaking a PROPERTY named like a keyword', () => {
    const out = applySchemaDialect({
      type: 'object',
      properties: { pattern: { type: 'string', pattern: '^a' }, propertyNames: { type: 'string' } },
      propertyNames: { pattern: '^[a-z]+$' },
    }, { stripKeywords: ['pattern', 'propertyNames'] }) as any;
    expect(Object.keys(out.properties)).toEqual(['pattern', 'propertyNames']);
    expect(out.properties.pattern).toEqual({ type: 'string' });
    expect(out.propertyNames).toBeUndefined();
  });
});

describe('sanitizeExtraBodyForVendor — nvidia propertyNames', () => {
  it('drops propertyNames at every depth for nvidia and keeps the value shape', () => {
    const body = {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'x',
          schema: {
            type: 'object',
            properties: {
              scores: { type: 'object', propertyNames: { enum: ['a', 'b'] }, additionalProperties: { type: 'number' } },
            },
            $defs: { M: { type: 'object', propertyNames: { type: 'string' } } },
          },
        },
      },
    };
    const out = sanitizeExtraBodyForVendor('nvidia', body) as any;
    const schema = out.response_format.json_schema.schema;
    expect(JSON.stringify(schema)).not.toContain('propertyNames');
    expect(schema.properties.scores.additionalProperties).toEqual({ type: 'number' });
    // NIM keeps every other draft-07 keyword — only the observed rejection is stripped.
    expect(sanitizeExtraBodyForVendor('nvidia', { response_format: { type: 'json_schema', json_schema: { schema: { type: 'string', maxLength: 3 } } } }))
      .toMatchObject({ response_format: { json_schema: { schema: { type: 'string', maxLength: 3 } } } });
  });

  it('is applied by the nvidia module itself (the factory wires a declared dialect)', async () => {
    const { nvidiaModule } = await import('./vendors/nvidia');
    let sent: any = null;
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    try {
      await nvidiaModule.call({
        apiKey: 'nv', model: 'nvidia/nemotron-3-super-120b-a12b', messages: [{ role: 'user', content: 'hi' }],
        extraBody: { response_format: { type: 'json_schema', json_schema: { name: 'x', schema: { type: 'object', propertyNames: { enum: ['k'] } } } } },
      });
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
    expect(JSON.stringify(sent.response_format)).not.toContain('propertyNames');
  });
});
