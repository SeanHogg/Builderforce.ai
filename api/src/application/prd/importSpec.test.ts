import { describe, expect, it, vi } from 'vitest';
import {
  importSpecFromBoard,
  pickBoardConnection,
  specFieldsFromTicket,
  SpecImportError,
} from './importSpec';
import { PermanentBoardProviderError, type BoardProvider, type NormalizedTicket } from '../boardsync/providers';
import type { Db } from '../../infrastructure/database/connection';

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

describe('pickBoardConnection', () => {
  const gh = { id: 'c-gh', provider: 'github', credentialId: 'cred-1', externalBoardId: 'o/r' };
  const jira = { id: 'c-jira', provider: 'jira', credentialId: 'cred-2', externalBoardId: 'PROJ' };

  it('returns the only connection', () => {
    expect(pickBoardConnection([gh], {})).toEqual(gh);
  });

  it('selects by provider when several exist', () => {
    expect(pickBoardConnection([gh, jira], { provider: 'Jira' })).toEqual(jira);
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
      expect((err as SpecImportError).message).toMatch(/specify provider/);
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

  it('throws 400 for an unsupported provider', () => {
    const monday = { id: 'c-m', provider: 'monday', credentialId: null, externalBoardId: null };
    try {
      pickBoardConnection([monday], {});
      expect.unreachable();
    } catch (err) {
      expect((err as SpecImportError).status).toBe(400);
      expect((err as SpecImportError).message).toMatch(/github, jira, and linear/);
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

describe('importSpecFromBoard', () => {
  function makeDb(opts: {
    connections?: Array<{ id: string; provider: string; credentialId: string | null; externalBoardId: string | null }>;
    existing?: Array<Record<string, unknown>>;
    inserted?: Record<string, unknown>;
    updated?: Record<string, unknown>;
    task?: { id: number } | null;
  }) {
    const connections = opts.connections ?? [
      { id: 'c-gh', provider: 'github', credentialId: 'cred-1', externalBoardId: 'o/r' },
    ];
    const existing = opts.existing ?? [];
    const inserted = opts.inserted ?? {
      id: 'spec-new',
      tenantId: 7,
      projectId: 11,
      goal: 'Ship import',
      prd: 'Do the thing',
      sourceProvider: 'github',
      sourceExternalId: '42',
      sourceUrl: GH.externalUrl,
    };
    const updated = opts.updated ?? { ...inserted, id: 'spec-old' };
    let fromCount = 0;
    const db = {
      select: () => ({
        from: () => {
          fromCount += 1;
          if (fromCount === 1) {
            return { where: async () => connections };
          }
          return {
            where: () => ({
              limit: async () => existing,
            }),
            innerJoin: () => ({
              where: async () => (opts.task ? [opts.task] : []),
            }),
          };
        },
      }),
      insert: () => ({
        values: () => ({
          returning: async () => [inserted],
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [updated],
          }),
        }),
      }),
    };
    return { db: db as unknown as Db, connections, inserted, updated };
  }

  const env = { JWT_SECRET: 'jwt' };

  it('inserts a spec on first import', async () => {
    const { db, inserted } = makeDb({});
    const fetchTicket = vi.fn(async () => GH);
    const result = await importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '42',
    }, {
      loadProject: async () => ({ id: 11 }) as never,
      loadCredentials: async () => ({ credentials: { accessToken: 't' }, baseUrl: null }),
      createProvider: () => ({ id: 'github', fetchTicket }) as unknown as BoardProvider,
    });
    expect(result.created).toBe(true);
    expect(result.spec.id).toBe(inserted.id);
    expect(fetchTicket).toHaveBeenCalledWith('42');
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
    }, {
      loadProject: async () => ({ id: 11 }) as never,
      loadCredentials: async () => ({ credentials: { accessToken: 't' }, baseUrl: null }),
      createProvider: () => ({
        id: 'github',
        fetchTicket: async () => GH,
      }) as unknown as BoardProvider,
    });
    expect(result.created).toBe(false);
    expect(result.spec.id).toBe('spec-old');
  });

  it('maps a missing ticket to SpecImportError 404', async () => {
    const { db } = makeDb({});
    await expect(importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '99',
    }, {
      loadProject: async () => ({ id: 11 }) as never,
      loadCredentials: async () => ({ credentials: { accessToken: 't' }, baseUrl: null }),
      createProvider: () => ({
        id: 'github',
        fetchTicket: async () => {
          throw new PermanentBoardProviderError('GitHub issue "99" was not found', 'not_found');
        },
      }) as unknown as BoardProvider,
    })).rejects.toMatchObject({ name: 'SpecImportError', status: 404 });
  });

  it('rejects a missing project', async () => {
    const { db } = makeDb({});
    await expect(importSpecFromBoard(db, env, {
      tenantId: 7,
      projectId: 11,
      externalId: '1',
    }, {
      loadProject: async () => null,
    })).rejects.toMatchObject({ name: 'SpecImportError', status: 404 });
  });
});
