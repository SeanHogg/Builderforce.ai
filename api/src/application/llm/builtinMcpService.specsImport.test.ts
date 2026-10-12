import { describe, it, expect, vi, beforeEach } from 'vitest';

const SECRET = 'secret-token-xyz-never-leak';

const { importSpecFromBoard, SpecImportError, publicSpecImportResult } = vi.hoisted(() => {
  class SpecImportError extends Error {
    status: 400 | 404 | 502;
    constructor(message: string, status: 400 | 404 | 502) {
      super(message);
      this.name = 'SpecImportError';
      this.status = status;
    }
  }
  function publicSpecImportResult(
    spec: Record<string, unknown>,
    extra: { created: boolean; linkedTaskId: number | null },
  ): Record<string, unknown> {
    const fields = [
      'id', 'projectId', 'goal', 'status', 'kind', 'prd',
      'sourceProvider', 'sourceExternalId', 'sourceUrl',
      'createdAt', 'updatedAt',
    ] as const;
    const out: Record<string, unknown> = {};
    for (const f of fields) if (spec[f] !== undefined) out[f] = spec[f];
    out.created = extra.created;
    out.linkedTaskId = extra.linkedTaskId;
    return out;
  }
  return {
    importSpecFromBoard: vi.fn(),
    SpecImportError,
    publicSpecImportResult,
  };
});

vi.mock('../project/ProjectService', () => ({ ProjectService: function () { return {}; } }));
vi.mock('../task/TaskService', () => ({ TaskService: function () { return {}; } }));
vi.mock('../../infrastructure/repositories/ProjectRepository', () => ({ ProjectRepository: function () { /* stub */ } }));
vi.mock('../../infrastructure/repositories/TaskRepository', () => ({ TaskRepository: function () { /* stub */ } }));
vi.mock('../prd/importSpec', () => ({
  importSpecFromBoard,
  SpecImportError,
  publicSpecImportResult,
}));

import { callBuiltinTool, listBuiltinTools } from './builtinMcpService';

const db = {} as never;
const TENANT = 7;

const SPEC = {
  id: 'spec-new',
  projectId: 11,
  goal: 'Ship import',
  status: 'draft',
  kind: 'feature',
  prd: 'Do the thing',
  sourceProvider: 'github',
  sourceExternalId: '42',
  sourceUrl: 'https://github.com/o/r/issues/42',
  accessToken: SECRET,
};

describe('MCP specs.import', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is advertised as a mutating builtin tool', () => {
    const entry = listBuiltinTools().find((t) => t.tool === 'specs.import');
    expect(entry).toBeTruthy();
    expect(entry?.mutates).toBe(true);
    expect(entry?.name).toBe('builtin_specs_import');
    expect(entry?.parameters).toMatchObject({ required: ['projectId', 'externalId'] });
  });

  it('imports a ticket and strips token-shaped keys', async () => {
    importSpecFromBoard.mockResolvedValue({ spec: SPEC, created: true, linkedTaskId: null });
    const res = await callBuiltinTool(db, {
      tenantId: TENANT,
      tool: 'specs.import',
      arguments: { projectId: 11, externalId: '42', provider: 'github' },
    }) as Record<string, unknown>;
    expect(importSpecFromBoard).toHaveBeenCalledWith(db, {}, expect.objectContaining({
      tenantId: TENANT,
      projectId: 11,
      externalId: '42',
      provider: 'github',
    }));
    expect(res).toMatchObject({
      id: 'spec-new',
      goal: 'Ship import',
      sourceProvider: 'github',
      created: true,
      linkedTaskId: null,
    });
    expect(res).not.toHaveProperty('accessToken');
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it('is idempotent on re-import', async () => {
    importSpecFromBoard.mockResolvedValue({ spec: SPEC, created: false, linkedTaskId: 99 });
    const res = await callBuiltinTool(db, {
      tenantId: TENANT,
      tool: 'specs.import',
      arguments: { projectId: 11, externalId: '42' },
    }) as Record<string, unknown>;
    expect(res.created).toBe(false);
    expect(res.linkedTaskId).toBe(99);
  });

  it('surfaces unknown-provider as an Error', async () => {
    importSpecFromBoard.mockRejectedValue(new SpecImportError(
      'Provider "monday" is not supported for spec import (github, jira, linear)',
      400,
    ));
    await expect(callBuiltinTool(db, {
      tenantId: TENANT,
      tool: 'specs.import',
      arguments: { projectId: 11, externalId: '42', provider: 'monday' },
    })).rejects.toThrow(/not supported/);
  });

  it('surfaces no-connection as an Error', async () => {
    importSpecFromBoard.mockRejectedValue(new SpecImportError('No board connection on this project', 404));
    await expect(callBuiltinTool(db, {
      tenantId: TENANT,
      tool: 'specs.import',
      arguments: { projectId: 11, externalId: '42' },
    })).rejects.toThrow(/board connection/);
  });
});
