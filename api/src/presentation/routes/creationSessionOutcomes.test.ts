import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `POST /:id/outcomes` — the project-attribution rule.
 *
 * Production logged a steady `400 Project is not linked to this session`: the
 * canvas posts outcomes about the project CARD a creator placed on the board, and
 * the route accepted a project only through a `creation_session_project_links`
 * row that placing a card never writes. A project is now accepted when it is
 * linked OR carried by a card on the board, and one the board does not hold is
 * dropped from the event — never a refusal of the whole outcome.
 */

const TENANT = 91;
const USER = 'user-1';
const SESSION = '11111111-1111-4111-8111-111111111111';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', null);
    c.set('userId', USER);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

vi.mock('../../application/creation/sessionAccess', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveSessionAccess: async () => ({ session: { id: SESSION, tenantId: TENANT, segmentId: null }, role: 'editor' }),
}));

const recordOutcomeEvent = vi.fn();
vi.mock('../../application/outcomes/outcomeLedger', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  recordOutcomeEvent: (...args: unknown[]) => recordOutcomeEvent(...args),
}));

import { createCreationSessionRoutes } from './creationSessionRoutes';

/** Db stub: each `select()` resolves to the next queued row set (link lookup, then card lookup). */
function makeDb(results: unknown[][]) {
  const queue = [...results];
  const db = {
    select: () => {
      const rows = queue.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
      (chain as { then: unknown }).then = (resolve: (v: unknown[]) => void) => resolve(rows);
      return chain;
    },
  };
  return db as any;
}

const post = (db: any, body: Record<string, unknown>) =>
  createCreationSessionRoutes(db).request(`/${SESSION}/outcomes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ correlationId: 'c-1', action: 'website.publish', phase: 'started', ...body }),
  });

beforeEach(() => {
  recordOutcomeEvent.mockReset();
  recordOutcomeEvent.mockResolvedValue(true);
});

describe('recording a session outcome against a project', () => {
  it('attributes a project that is linked to the session', async () => {
    const res = await post(makeDb([[{ projectId: 12 }], []]), { projectId: 12 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ recorded: true, duplicate: false, projectAttributed: true });
    expect(recordOutcomeEvent.mock.calls[0]![1]).toMatchObject({ projectId: 12, sessionId: SESSION, tenantId: TENANT });
  });

  it('attributes a project carried by a card on the board even without a link row', async () => {
    const res = await post(makeDb([[], [{ id: 'card-1' }]]), { projectId: 12 });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ projectAttributed: true });
    expect(recordOutcomeEvent.mock.calls[0]![1]).toMatchObject({ projectId: 12 });
  });

  it('records the outcome unattributed instead of refusing it when the board does not hold the project', async () => {
    const res = await post(makeDb([[], []]), { projectId: 12 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ recorded: true, duplicate: false, projectAttributed: false });
    expect(recordOutcomeEvent.mock.calls[0]![1]).toMatchObject({ projectId: null });
  });

  it('does not look a project up when none was sent', async () => {
    const res = await post(makeDb([]), {});
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ projectAttributed: true });
    expect(recordOutcomeEvent.mock.calls[0]![1]).toMatchObject({ projectId: null });
  });
});
