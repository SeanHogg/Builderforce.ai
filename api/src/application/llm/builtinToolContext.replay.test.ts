import { describe, it, expect, vi } from 'vitest';
import { statusOf } from '../../domain/shared/errors';
import { TenantRole } from '../../domain/shared/types';
import { replayRoute, ReplayRouteError } from './builtinToolContext';

/**
 * A replayed route's status must reach the caller AS ITSELF.
 *
 * Measured on VS Code chat #113: `builtin_kanban_coordinate` replayed
 * `POST /api/kanban/tasks/2522/coordinate`, the route answered
 * `403 {"error":"manager role required"}`, and `/v1/mcp/call` relayed
 * `HTTP 502`. `replayRoute` threw a bare `Error`, so `statusOf` fell to 500 and the
 * handler turned that into a gateway failure. A model reading 502 retries the same
 * call; a model reading 403 + remedy fixes the cause.
 *
 * The MESSAGE text is deliberately unchanged, so the string the model reads (and the
 * assertions elsewhere that match on it) are the same as before.
 */

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock('../../index', () => ({
  resolveApp: () => ({ request: mocks.request }),
}));
vi.mock('../../infrastructure/auth/JwtService', () => ({
  signJwt: vi.fn(async () => 'signed.jwt.token'),
  signOpaqueJwt: vi.fn(async () => 'signed.opaque.token'),
}));

function ctx() {
  return {
    db: {} as never,
    tenantId: 42,
    projects: {} as never,
    tasks: {} as never,
    env: { JWT_SECRET: 'secret' } as never,
    role: TenantRole.OWNER,
  };
}

describe('replayRoute failure', () => {
  it('throws a ReplayRouteError carrying the route\'s own status and body', async () => {
    mocks.request.mockResolvedValue(
      new Response(JSON.stringify({ error: 'manager role required' }), { status: 403 }),
    );

    const err = await replayRoute(ctx(), 'POST', '/api/kanban/tasks/2522/coordinate', { note: 'x' })
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(ReplayRouteError);
    const replayError = err as ReplayRouteError;
    expect(replayError.status).toBe(403);
    expect((replayError.body as { error: string }).error).toBe('manager role required');
    // `/v1/mcp/call` answers `statusOf(err)` — 403, not the 502 it used to relay.
    expect(statusOf(replayError)).toBe(403);
  });

  it('keeps the message text verbatim so the model reads the route\'s own words', async () => {
    mocks.request.mockResolvedValue(
      new Response(JSON.stringify({ error: 'manager role required' }), { status: 403 }),
    );

    await expect(replayRoute(ctx(), 'POST', '/api/kanban/tasks/2522/coordinate'))
      .rejects.toThrow('POST /api/kanban/tasks/2522/coordinate → 403 {"error":"manager role required"}');
  });

  it('still reports 500 for a genuine server failure, as before', async () => {
    mocks.request.mockResolvedValue(new Response('boom', { status: 500 }));

    const err = await replayRoute(ctx(), 'GET', '/api/kanban/tasks/1')
      .then(() => null, (e: unknown) => e);

    expect(statusOf(err)).toBe(500);
  });

  it('returns the parsed body on success', async () => {
    mocks.request.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(replayRoute(ctx(), 'GET', '/api/kanban/tasks/1')).resolves.toEqual({ ok: true });
  });
});
