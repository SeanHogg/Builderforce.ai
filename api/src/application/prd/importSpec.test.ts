import { describe, expect, it, vi } from 'vitest';
import {
  importSpecFromBoard,
  pickBoardConnection,
  publicSpecImportResult,
  specFieldsFromTicket,
  SpecImportError,
  type BoardConnectionRow,
  type ImportSpecDeps,
} from './importSpec';
import { PermanentBoardProviderError, type BoardProvider, type NormalizedTicket } from '../boardsync/providers';
import type { Db } from '../../infrastructure/database/connection';
import {
  boardConnections,
  externalTicketLinks,
  specs,
  tasks,
} from '../../infrastructure/database/schema';

const SECRET = 'secret-token-xyz-never-leak';

const GH: NormalizedTicket = {
  externalId: '42',
  externalUrl: 'https://github.com/o/r/issues/42',
  externalVersion: '2024-01-01T00:00:00Z',
  title: '  Ship import  ',
  body: 'Do the thing',
  state: 'open',
  source: 'github',
  contentHash: 'abc',
  fields: {},
};

function conn(partial: Partial<BoardConnectionRow> & { id: string; provider: string }): BoardConnectionRow {
  return {
    tenantId: 7,
    projectId: 11,
    status: 'active',
    credentialId: 'cred-1',
    externalBoardId: 'o/r',
    ...partial,
  };
}

describe('pickBoardConnection', () => {
  const gh = conn({ id: 'c-gh', provider: 'github', credentialId: 'cred-1', externalBoardId: 'o/r' });
  const jira = conn({ id: 'c-jira', provider: 'jira', credentialId: 'cred-2', externalBoardId: 'PROJ' });

  it('returns the only connection', () => {
    expect(pickBoardConnection([gh], {})).toEqual(gh);
  });

  it('selects by provider when several exist', () => {
    expect(pickBoardConnection([gh, jira], { provider: 'jira' })).toEqual(jira);
  });

  it('selects by connectionId', () => {
    expect(pickBoardConnection([gh, jira], { connectionId: 'c-gh' })).toEqual(gh);
  });

  it('throws 400 when several connections and no discriminator', () => {
    try {
      pickBoardConnection([gh, jira], {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SpecImportError);
      expect((err as SpecImportError).status).toBe(400);
      expect((err as SpecImportError).message).toMatch(/provider or connectionId/);
    }
  });

  it('throws 404 when the named connection is missing', () => {
    try {
      pickBoardConnection([gh], { connectionId: 'nope' });
      expect.unreachable();
    } catch (err) {
      expect((err as SpecImportError).status).toBe(404);
    }
  });

  it('throws 404 when no supported connection exists', () => {
    const monday = conn({ id: 'c-m', provider: 'monday', credentialId: null, externalBoardId: null });
    try {
      pickBoardConnection([monday], {});
      expect.unreachable();
    } catch (err) {
      expect((err as SpecImportError).status).toBe(404);
      expect((err as SpecImportError).message).toMatch(/board connection/);
    }
  });

  it('throws 400 when the named connection is an unsupported provider', () => {
    const monday = conn({ id: 'c-m', provider: 'monday', credentialId: null, externalBoardId: null });
    try {
      pickBoardConnection([monday], { connectionId: 'c-m' });
      expect.unreachable();
    } catch (err) {
      expect((err as SpecImportError).status).toBe(400);
      expect((err as SpecImportError).message).toMatch(/not supported/);
    }
  });
});

describe('specFieldsFromTicket', () => {
  it('maps title→goal, body→prd, origin onto source_*', () => {
    expect(specFieldsFromTicket(GH)).toEqual({
      goal: 'Ship import',
      prd: 'Do the thing',
      sourceProvider: 'github',
      sourceExternalId: '42',
      sourceUrl: 'https://github.com/o/r/issues/42',
    });
  });

  it('falls back to externalId when the title is blank', () => {
    expect(specFieldsFromTicket({ ...GH, title: '   ' }).goal).toBe('42');
  });
});

describe('publicSpecImportResult', () => {
  it('drops token-shaped extra keys', () => {
    expect(publicSpecImportResult({
      id: 'spec-1',
      goal: 'Ship import',
      accessToken: SECRET,
      apiKey: SECRET,
      credentials: { accessToken: SECRET },
    }, { created: true, linkedTaskId: null })).toEqual({
      id: 'spec-1',
      goal: 'Ship import',
      created: true,
      linkedTaskId: null,
    });
  });
});

describe('importSpecFromBoard', () => {
  function makeDb(opts: {
    connections?: BoardConnectionRow[];
    existing?: Array<Record<string, unknown>>;
    inserted?: Record<string, unknown>;
    updated?: Record<string, unknown>;
    task?: { id: number } | null;
    matchingLink?: { taskId: number } | null;
    insertError?: Error;
  } = {}) {
    const connections = opts.connections ?? [
      conn({ id: 'c-gh', provider: 'github', credentialId: 'cred-1', externalBoardId: 'o/r' }),
    ];
    const existing = opts.existing ?? [];
    const inserted = opts.inserted ?? {
      id: 'spec-new',
      tenantId: 7,
      projectId: 11,
      goal: 'Ship import',
      status: 'draft',
      kind: 'feature',
      prd: 'Do the thing',
      sourceProvider: 'github',
      sourceExternalId: '42',
      sourceUrl: GH.externalUrl,
    };
    const updated = opts.updated ?? { ...inserted, id: 'spec-old' };
    const captured: { insertValues: unknown[] } = { insertValues: [] };

    function rowsFor(table: unknown): unknown[] {
      if (table === boardConnections) return connections;
      if (table === specs) return existing;
      if (table === externalTicketLinks) return opts.matchingLink ? [opts.matchingLink] : [];
      if (table === tasks) return opts.task ? [opts.task] : [];
      return [];
    }

    const db = {
      select: () => ({
        from: (table: unknown) => {
          const rows = rowsFor(table);
          const chain: {
            where: () => unknown;
            innerJoin: () => unknown;
            limit: () => Promise<unknown[]>;
            then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise<unknown>;
          } = {
            where: () => chain,
            innerJoin: () => chain,
            limit: async () => rows,
            then: (res, rej) => Promise.resolve(rows).then(res, rej),
          };
          return chain;
        },
      }),
      insert: () => ({
        values: (v: unknown) => {
          captured.insertValues.push(v);
          if (opts.insertError) {
            return { returning: async () => { throw opts.insertError; } };
          }
          return { returning: async () => [inserted] };
        },
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [updated],
          }),
        }),
      }),
    };
    return { db: db as unknown as Db, connections, inserted, updated, captured };
  }

  const env = { JWT_SECRET: 'jwt' } as never;

  function deps(overrides: Partial<ImportSpecDeps> = {}): ImportSpecDeps {
    return {
      projectExists: async () => true,
      loadCredentials: async () => ({ credentials: { accessToken: SECRET }, baseUrl: null }),
      createProvider: () => ({ id: 'github', fetchTicket: async () => GH }) as unknown as BoardProvider,
      fetchFn: async () => new Response(null, { status: 500 }),
      linkSpecToTask: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('inserts a spec on first import', async () => {
    const { db, inserted, captured } = makeDb({});
    const fetchTicket = vi.fn(async () => GH);
    const result = await importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '42',
    }, deps({
      createProvider: () => ({ id: 'github', fetchTicket }) as unknown as BoardProvider,
    }));
    expect(result.created).toBe(true);
    expect(result.spec.id).toBe(inserted.id);
    expect(fetchTicket).toHaveBeenCalledWith('42');
    const row = captured.insertValues[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      tenantId: 7,
      projectId: 11,
      goal: 'Ship import',
      status: 'draft',
      kind: 'feature',
      sourceProvider: 'github',
      sourceExternalId: '42',
    });
    expect(row).not.toHaveProperty('accessToken');
    expect(row).not.toHaveProperty('apiKey');
    expect(row).not.toHaveProperty('credentials');
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('updates the existing spec on re-import (idempotent)', async () => {
    const existing = [{
      id: 'spec-old',
      tenantId: 7,
      projectId: 11,
      goal: 'old',
      prd: 'old body',
      sourceProvider: 'github',
      sourceExternalId: '42',
    }];
    const { db } = makeDb({ existing, updated: { ...existing[0], goal: 'Ship import' } });
    const result = await importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '#42',
    }, deps());
    expect(result.created).toBe(false);
    expect(result.spec.id).toBe('spec-old');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('maps a missing ticket to SpecImportError 404', async () => {
    const { db } = makeDb({});
    await expect(importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '99',
    }, deps({
      createProvider: () => ({
        id: 'github',
        fetchTicket: async () => {
          throw new PermanentBoardProviderError('GitHub issue "99" was not found', 'not_found');
        },
      }) as unknown as BoardProvider,
    }))).rejects.toMatchObject({ name: 'SpecImportError', status: 404 });
  });

  it('rejects a missing project', async () => {
    const { db } = makeDb({});
    await expect(importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '1',
    }, deps({ projectExists: async () => false }))).rejects.toMatchObject({ name: 'SpecImportError', status: 404 });
  });

  it('rejects when the project has no board connection', async () => {
    const { db } = makeDb({ connections: [] });
    await expect(importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '42',
    }, deps())).rejects.toMatchObject({ name: 'SpecImportError', status: 404, message: expect.stringMatching(/board connection/) });
  });

  it('rejects an unknown provider when that connection is named', async () => {
    const monday = conn({ id: 'c-m', provider: 'monday', credentialId: 'cred-m', externalBoardId: null });
    const { db } = makeDb({ connections: [monday] });
    await expect(importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '42',
      provider: 'monday',
    }, deps())).rejects.toMatchObject({ name: 'SpecImportError', status: 400, message: expect.stringMatching(/not supported/) });
  });

  it('links an existing matching board-synced task and never creates one', async () => {
    const linkSpecToTask = vi.fn(async () => {});
    const { db, captured } = makeDb({ matchingLink: { taskId: 99 }, task: { id: 99 } });
    const result = await importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '42',
    }, deps({ linkSpecToTask }));
    expect(result.linkedTaskId).toBe(99);
    expect(linkSpecToTask).toHaveBeenCalledWith(db, expect.objectContaining({
      taskId: 99,
      specId: 'spec-new',
      tenantId: 7,
      isPrimary: true,
    }));
    expect(captured.insertValues).toHaveLength(1);
    expect((captured.insertValues[0] as { kind: string }).kind).toBe('feature');
  });

  it('links an explicitly requested task when it exists in the tenant', async () => {
    const linkSpecToTask = vi.fn(async () => {});
    const { db } = makeDb({ task: { id: 5 } });
    const result = await importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '42',
      taskId: 5,
    }, deps({ linkSpecToTask }));
    expect(result.linkedTaskId).toBe(5);
    expect(linkSpecToTask).toHaveBeenCalled();
  });
});
