import { describe, expect, it, vi } from 'vitest';
import { runImport, type Importer, type ImportContext } from './importer';
import { getImporter, listImporters } from './importers';
import { IMPORT_DATASETS } from '../insights/boardImport';
import { parseBoardImport } from '../insights/boardImporters';
import { parseDefinitionImport } from '../workflow/definitionImporter';
import { parseOpenApiImport } from '../connectors/openapiConnectorImporter';

const CTX = { db: {}, env: {}, tenantId: 1, segmentId: null, userId: null } as unknown as ImportContext;

describe('runImport — the ONE parse → preview | commit sequence', () => {
  const make = (commit?: boolean) => {
    const preview = vi.fn(async () => ({ status: 'previewed' as const, body: 'p' }));
    const commitFn = vi.fn(async () => ({ status: 'committed' as const, body: 'c' }));
    const importer: Importer<string> = {
      kind: 'k', label: 'k', input: 'document', minRole: 'viewer' as never,
      parse: (b) => (typeof b.v === 'string' ? { ok: true, input: b.v } : { ok: false, error: 'v is required' }),
      preview,
      ...(commit ? { commit: commitFn } : {}),
    };
    return { importer, preview, commitFn };
  };

  it('refuses a payload its importer cannot parse, touching neither preview nor commit', async () => {
    const { importer, preview, commitFn } = make(true);
    expect(await runImport(importer, CTX, {}, { dryRun: false })).toEqual({ status: 'refused', body: { error: 'v is required' } });
    expect(preview).not.toHaveBeenCalled();
    expect(commitFn).not.toHaveBeenCalled();
  });

  it('previews on a dry run and commits otherwise', async () => {
    const { importer, preview, commitFn } = make(true);
    expect((await runImport(importer, CTX, { v: 'x' }, { dryRun: true })).status).toBe('previewed');
    expect((await runImport(importer, CTX, { v: 'x' }, { dryRun: false })).status).toBe('committed');
    expect(preview).toHaveBeenCalledWith(CTX, 'x');
    expect(commitFn).toHaveBeenCalledWith(CTX, 'x');
  });

  it('only ever previews a DRAFT importer (no commit), dry run or not', async () => {
    const { importer, preview } = make(false);
    expect((await runImport(importer, CTX, { v: 'x' }, { dryRun: false })).status).toBe('previewed');
    expect(preview).toHaveBeenCalledTimes(1);
  });
});

describe('the importer registry', () => {
  it('registers every board record kind, the workflow YAML import and the OpenAPI draft — kinds unique', () => {
    const kinds = listImporters().map((i) => i.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const key of Object.keys(IMPORT_DATASETS)) expect(getImporter(key)?.input).toBe('rows');
    expect(getImporter('workflow-definition')).toMatchObject({ input: 'document' });
    expect(getImporter('connector-openapi')).toMatchObject({ input: 'document', minRole: 'manager' });
    expect(getImporter('connector-openapi')?.commit).toBeUndefined();
  });

  it('keeps the board kinds manager-gated, as the /import route always was', () => {
    for (const key of Object.keys(IMPORT_DATASETS)) expect(getImporter(key)?.minRole).toBe('manager');
  });
});

describe('importer payload parsing (shape only — validity is each registry’s call)', () => {
  it('board rows: an array of objects, a non-negative integer offset', () => {
    expect(parseBoardImport({ rows: [{ a: 1 }], rowOffset: 500 })).toEqual({ ok: true, input: { rows: [{ a: 1 }], rowOffset: 500 } });
    expect(parseBoardImport({})).toEqual({ ok: true, input: { rows: [], rowOffset: 0 } });
    expect(parseBoardImport({ rows: 'a,b' }).ok).toBe(false);
    expect(parseBoardImport({ rows: [1] }).ok).toBe(false);
    expect(parseBoardImport({ rows: [], rowOffset: -1 }).ok).toBe(false);
  });

  it('workflow definition: parses + validates the YAML, defaulting the name', () => {
    expect(parseDefinitionImport({})).toEqual({ ok: false, error: 'yaml is required' });
    expect(parseDefinitionImport({ yaml: 'nodes: []' })).toEqual({ ok: false, error: 'Workflow has no nodes.' });
    const ok = parseDefinitionImport({ yaml: 'nodes:\n  - id: a\n    kind: agent\n' });
    expect(ok.ok && ok.input.name).toBe('Imported workflow');
    expect(ok.ok && ok.input.definition.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('OpenAPI: needs a key and either a spec object or a spec URL; the key is lower-cased', () => {
    expect(parseOpenApiImport({ spec: {} })).toEqual({ ok: false, error: 'key is required' });
    expect(parseOpenApiImport({ key: 'X' })).toEqual({ ok: false, error: 'Provide either specUrl or spec' });
    expect(parseOpenApiImport({ key: 'X', spec: [] })).toEqual({ ok: false, error: 'spec must be a JSON object' });
    expect(parseOpenApiImport({ key: 'Stripe', specUrl: 'https://x/openapi.json' }))
      .toEqual({ ok: true, input: { key: 'stripe', specUrl: 'https://x/openapi.json' } });
  });
});
