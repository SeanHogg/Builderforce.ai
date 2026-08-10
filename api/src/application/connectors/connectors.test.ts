/**
 * Connector platform tests.
 *
 * Three things are asserted here because each has a failure mode that is SILENT
 * in production:
 *   1. every built-in manifest passes the same validator tenant input does — a
 *      typo'd path placeholder surfaces as a customer's "it says my Slack is
 *      misconfigured", not as a build error;
 *   2. request assembly puts each param where the manifest said — a body value
 *      sent as a query param comes back as a plain upstream 400 with no clue why;
 *   3. the advertised tool name round-trips — the exact defect documented in
 *      `llm/toolNaming.ts`, where a model describes a call it cannot make and the
 *      run "succeeds".
 */

import { describe, it, expect } from 'vitest';
import {
  parseConnectorManifest,
  validateConnectorManifest,
  authFieldsFor,
  fillTemplate,
  actionInputSchema,
  type ConnectorManifest,
} from './connectorManifest';
import { BUILTIN_CONNECTOR_LIST, RESERVED_CONNECTOR_KEYS, validateBuiltinCatalog } from './defaults';
import { buildConnectorRequest, setDeep, getDeep, toFormBody, redactSecrets } from './connectorRuntime';
import { connectorToolName, encodeConnectorTool, decodeConnectorTool } from './connectorTools';
import { manifestFromOpenApi } from './openapiImport';

const minimal = (over: Partial<ConnectorManifest> = {}) => ({
  key: 'acme',
  name: 'Acme',
  description: 'test',
  category: 'other',
  icon: '🔌',
  baseUrl: 'https://api.acme.test',
  auth: { kind: 'bearer' },
  actions: [
    { key: 'ping', label: 'Ping', description: 'ping', method: 'GET', path: '/ping', mutates: false, params: {} },
  ],
  ...over,
});

describe('built-in connector catalog', () => {
  it('every built-in manifest passes the tenant-input validator', () => {
    expect(validateBuiltinCatalog()).toEqual([]);
  });

  it('ships a meaningful catalog with unique keys', () => {
    expect(BUILTIN_CONNECTOR_LIST.length).toBeGreaterThanOrEqual(20);
    expect(new Set(BUILTIN_CONNECTOR_LIST.map((m) => m.key)).size).toBe(BUILTIN_CONNECTOR_LIST.length);
    expect(RESERVED_CONNECTOR_KEYS.size).toBe(BUILTIN_CONNECTOR_LIST.length);
  });

  it('declares mutates on every action so the confirm gate is never inferred', () => {
    for (const m of BUILTIN_CONNECTOR_LIST) {
      for (const a of m.actions) expect(typeof a.mutates, `${m.key}.${a.key}`).toBe('boolean');
    }
  });

  it('gives every action a description — the model selects tools by it alone', () => {
    for (const m of BUILTIN_CONNECTOR_LIST) {
      for (const a of m.actions) expect(a.description.length, `${m.key}.${a.key}`).toBeGreaterThan(3);
    }
  });
});

describe('parseConnectorManifest', () => {
  it('accepts a minimal valid manifest', () => {
    expect(parseConnectorManifest(minimal()).key).toBe('acme');
  });

  it('rejects a path placeholder with no matching path param', () => {
    const r = validateConnectorManifest(minimal({
      actions: [{ key: 'get', label: 'g', description: 'g', method: 'GET', path: '/things/{id}', mutates: false, params: {} }],
    } as Partial<ConnectorManifest>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('{id}');
  });

  it('rejects an action that does not declare mutates', () => {
    const r = validateConnectorManifest(minimal({
      actions: [{ key: 'go', label: 'g', description: 'g', method: 'POST', path: '/go', params: {} }],
    } as unknown as Partial<ConnectorManifest>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('mutates');
  });

  it('rejects a non-https base URL and an internal target', () => {
    expect(validateConnectorManifest(minimal({ baseUrl: 'http://api.acme.test' })).ok).toBe(false);
    expect(validateConnectorManifest(minimal({ baseUrl: 'https://169.254.169.254/latest' })).ok).toBe(false);
    expect(validateConnectorManifest(minimal({ baseUrl: 'https://localhost/api' })).ok).toBe(false);
  });

  it('rejects a {{auth.x}} in the base URL that no auth field supplies', () => {
    const r = validateConnectorManifest(minimal({ baseUrl: 'https://{{auth.subdomain}}.acme.test' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('subdomain');
  });

  it('accepts a templated base URL when the field IS declared', () => {
    const r = validateConnectorManifest(minimal({
      baseUrl: 'https://{{auth.subdomain}}.acme.test',
      auth: { kind: 'bearer', fields: [
        { key: 'subdomain', label: 'Subdomain', secret: false, required: true },
        { key: 'token', label: 'Token', secret: true, required: true },
      ] },
    }));
    expect(r.ok).toBe(true);
  });

  it('reports EVERY problem at once, not just the first', () => {
    const r = validateConnectorManifest({ key: 'BAD KEY', baseUrl: 'ftp://x', actions: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(2);
  });

  it('defaults auth fields per kind when the manifest names none', () => {
    expect(authFieldsFor(parseConnectorManifest(minimal())).map((f) => f.key)).toEqual(['token']);
    expect(authFieldsFor(parseConnectorManifest(minimal({ auth: { kind: 'basic' } }))).map((f) => f.key))
      .toEqual(['username', 'password']);
  });
});

describe('request assembly', () => {
  const manifest = parseConnectorManifest(minimal({
    baseUrl: 'https://{{auth.sub}}.acme.test/v1',
    auth: { kind: 'basic', fields: [
      { key: 'sub', label: 'Sub', secret: false, required: true },
      { key: 'username', label: 'User', secret: false, required: true },
      { key: 'password', label: 'Pass', secret: true, required: true },
    ] },
    actions: [{
      key: 'create', label: 'Create', description: 'create', method: 'POST', path: '/things/{id}/notes',
      mutates: true, required: ['id', 'text'],
      params: {
        id: { type: 'string', in: 'path' },
        verbose: { type: 'string', in: 'query', name: 'v' },
        text: { type: 'string', in: 'body', bodyPath: 'note.body.text' },
        trace: { type: 'string', in: 'header', name: 'X-Trace' },
      },
    }],
  }));

  it('routes each param to its declared location and fills templates', () => {
    const { url, init } = buildConnectorRequest({
      manifest, action: manifest.actions[0]!,
      input: { id: 'a b', verbose: '1', text: 'hello', trace: 't-1' },
      auth: { sub: 'acme', username: 'u', password: 'p' },
    });
    expect(url).toBe('https://acme.acme.test/v1/things/a%20b/notes?v=1');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Trace']).toBe('t-1');
    // basic auth = base64("u:p")
    expect(headers.Authorization).toBe(`Basic ${btoa('u:p')}`);
    expect(JSON.parse(String(init.body))).toEqual({ note: { body: { text: 'hello' } } });
  });

  it('never follows redirects — a 302 must not carry the credential onward', () => {
    const { init } = buildConnectorRequest({
      manifest, action: manifest.actions[0]!, input: { id: '1', text: 'x' }, auth: { sub: 'a', username: 'u', password: 'p' },
    });
    expect(init.redirect).toBe('manual');
  });

  it('spreads an object query param instead of stringifying it', () => {
    const m = parseConnectorManifest(minimal({
      actions: [{
        key: 'list', label: 'L', description: 'l', method: 'GET', path: '/list', mutates: false,
        params: { query: { type: 'object', in: 'query' } },
      }],
    }));
    const { url } = buildConnectorRequest({ manifest: m, action: m.actions[0]!, input: { query: { limit: 10, sort: 'desc' } }, auth: { token: 't' } });
    expect(url).toBe('https://api.acme.test/list?limit=10&sort=desc');
  });

  it("bodyPath '$' makes the value the WHOLE body", () => {
    const m = parseConnectorManifest(minimal({
      actions: [{
        key: 'post', label: 'P', description: 'p', method: 'POST', path: '/p', mutates: true,
        params: { body: { type: 'object', in: 'body', bodyPath: '$' } },
      }],
    }));
    const { init } = buildConnectorRequest({ manifest: m, action: m.actions[0]!, input: { body: { a: 1 } }, auth: { token: 't' } });
    expect(JSON.parse(String(init.body))).toEqual({ a: 1 });
  });

  it('form-encodes when the action asks for it (Stripe and friends)', () => {
    const m = parseConnectorManifest(minimal({
      actions: [{
        key: 'pay', label: 'P', description: 'p', method: 'POST', path: '/pay', mutates: true, bodyFormat: 'form',
        params: { email: { type: 'string', in: 'body' } },
      }],
    }));
    const { init } = buildConnectorRequest({ manifest: m, action: m.actions[0]!, input: { email: 'a@b.c' }, auth: { token: 't' } });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.body).toBe('email=a%40b.c');
  });

  it('fills a {{auth.x}} template inside a param DEFAULT (Trello key + token)', () => {
    const m = parseConnectorManifest(minimal({
      auth: { kind: 'api_key', in: 'query', name: 'token', fields: [
        { key: 'key', label: 'Key', secret: false, required: true },
        { key: 'apiKey', label: 'Token', secret: true, required: true },
      ] },
      actions: [{
        key: 'boards', label: 'B', description: 'b', method: 'GET', path: '/boards', mutates: false,
        params: { key: { type: 'string', in: 'query', default: '{{auth.key}}' } },
      }],
    }));
    const { url } = buildConnectorRequest({ manifest: m, action: m.actions[0]!, input: {}, auth: { key: 'K', apiKey: 'T' } });
    expect(url).toContain('key=K');
    expect(url).toContain('token=T');
  });

  it('honours a per-connection base URL override (self-hosted GitLab)', () => {
    const { url } = buildConnectorRequest({
      manifest, action: manifest.actions[0]!, input: { id: '7', text: 'x' },
      auth: { sub: 'ignored', username: 'u', password: 'p' },
      baseUrlOverride: 'https://git.internal-corp.example.com/api/v4',
    });
    expect(url.startsWith('https://git.internal-corp.example.com/api/v4/things/7/notes')).toBe(true);
  });
});

describe('body + response helpers', () => {
  it('setDeep creates arrays for numeric segments', () => {
    const o: Record<string, unknown> = {};
    setDeep(o, 'personalizations.0.to.0.email', 'a@b.c');
    expect(o).toEqual({ personalizations: [{ to: [{ email: 'a@b.c' }] }] });
  });

  it('getDeep walks objects and arrays', () => {
    expect(getDeep({ a: { b: [{ c: 5 }] } }, 'a.b.0.c')).toBe(5);
    expect(getDeep({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('toFormBody uses bracket notation for nesting', () => {
    expect(toFormBody({ a: 1, b: { c: 2 }, d: ['x'] })).toBe('a=1&b%5Bc%5D=2&d%5B0%5D=x');
  });

  it('redactSecrets strips credential values from upstream error text', () => {
    expect(redactSecrets('401: bad token sk_live_abcdef', ['sk_live_abcdef'])).toBe('401: bad token «redacted»');
    // Too short to redact safely — a 3-char secret would blank ordinary words.
    expect(redactSecrets('value abc here', ['abc'])).toBe('value abc here');
  });

  it('fillTemplate leaves unknown keys empty rather than emitting the placeholder', () => {
    expect(fillTemplate('https://{{auth.sub}}.x.test', {})).toBe('https://.x.test');
  });
});

describe('tool advertisement', () => {
  it('produces a flat, model-safe name', () => {
    expect(connectorToolName('google-sheets', 'append_row')).toBe('conn_google_sheets_append_row');
  });

  it('round-trips the connector + action through the relayed tool value', () => {
    const encoded = encodeConnectorTool('google-sheets', 'append_row');
    expect(decodeConnectorTool(encoded)).toEqual({ connectorKey: 'google-sheets', actionKey: 'append_row' });
  });

  it('rejects a malformed tool value instead of guessing', () => {
    expect(decodeConnectorTool('nonsense')).toBeNull();
    expect(decodeConnectorTool('::x')).toBeNull();
  });

  it('advertises an input schema with the declared required list', () => {
    const m = parseConnectorManifest(minimal({
      actions: [{
        key: 'send', label: 'S', description: 's', method: 'POST', path: '/s', mutates: true, required: ['to'],
        params: { to: { type: 'string', in: 'body', description: 'Recipient' } },
      }],
    }));
    expect(actionInputSchema(m.actions[0]!)).toEqual({
      type: 'object',
      properties: { to: { type: 'string', description: 'Recipient' } },
      required: ['to'],
    });
  });
});

describe('OpenAPI import', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Widget API', description: 'Widgets' },
    servers: [{ url: 'https://api.widgets.test/v1' }],
    components: {
      securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Widget-Key' } },
      schemas: { NewWidget: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, size: { type: 'integer' } } } },
    },
    paths: {
      '/widgets': {
        get: {
          operationId: 'listWidgets', summary: 'List widgets',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        },
        post: {
          operationId: 'createWidget', summary: 'Create widget',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewWidget' } } } },
        },
      },
      '/widgets/{id}': {
        get: { operationId: 'getWidget', summary: 'Get widget', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] },
      },
    },
  };

  it('maps operations, params, refs and auth', () => {
    const { manifest } = manifestFromOpenApi(spec, { key: 'widgets' });
    expect(manifest.baseUrl).toBe('https://api.widgets.test/v1');
    expect(manifest.auth).toMatchObject({ kind: 'api_key', in: 'header', name: 'X-Widget-Key' });

    const list = manifest.actions.find((a) => a.key === 'list_widgets')!;
    expect(list.method).toBe('GET');
    expect(list.mutates).toBe(false);
    expect(list.params.limit).toMatchObject({ in: 'query', type: 'integer' });

    // The $ref into components/schemas must be resolved into flat body params.
    const create = manifest.actions.find((a) => a.key === 'create_widget')!;
    expect(create.mutates).toBe(true);
    expect(create.params.name).toMatchObject({ in: 'body' });
    expect(create.required).toContain('name');

    const get = manifest.actions.find((a) => a.key === 'get_widget')!;
    expect(get.params.id).toMatchObject({ in: 'path' });
    expect(get.required).toContain('id');
  });

  it('supports Swagger 2.0 host/basePath and body parameters', () => {
    const { manifest } = manifestFromOpenApi({
      swagger: '2.0', info: { title: 'Legacy' }, host: 'legacy.test', basePath: '/api', schemes: ['https'],
      paths: {
        '/things': {
          post: {
            operationId: 'addThing',
            parameters: [{ name: 'body', in: 'body', schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } }],
          },
        },
      },
    }, { key: 'legacy' });
    expect(manifest.baseUrl).toBe('https://legacy.test/api');
    expect(manifest.actions[0]!.params.title).toMatchObject({ in: 'body' });
    expect(manifest.actions[0]!.required).toContain('title');
  });

  it('derives a key from method+path when operationId is absent', () => {
    const { manifest } = manifestFromOpenApi({
      openapi: '3.0.0', info: { title: 'X' }, servers: [{ url: 'https://x.test' }],
      paths: { '/a/{id}': { get: {} } },
    }, { key: 'x' });
    expect(manifest.actions[0]!.key).toMatch(/^[a-z0-9][a-z0-9_]*$/);
  });

  it('validates its own output through the tenant-input parser', () => {
    const { manifest } = manifestFromOpenApi(spec, { key: 'widgets' });
    expect(validateConnectorManifest(JSON.parse(JSON.stringify(manifest))).ok).toBe(true);
  });

  it('throws a readable error on a document with no paths', () => {
    expect(() => manifestFromOpenApi({ openapi: '3.0.0', info: {} }, { key: 'k' })).toThrow(/no paths/i);
  });
});
