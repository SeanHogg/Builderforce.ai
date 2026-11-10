import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import { TenantAccessError } from '../../application/llm/gatewayAccess';

// The OIDC verifier has its own suite (hostOidc.test.ts); here we test only what
// the middleware ADDS on the X-IdP-Token path: the workspace header contract and
// the 401/403 mapping of the verifier's outcome.
const mocks = vi.hoisted(() => ({
  resolveSegmentFromHostToken: vi.fn(),
  requireTenantAccess: vi.fn(),
}));
vi.mock('../../application/auth/hostOidc', () => ({
  resolveSegmentFromHostToken: mocks.resolveSegmentFromHostToken,
}));
vi.mock('../routes/llmRoutes', async () => ({
  TenantAccessError: (await import('../../application/llm/gatewayAccess')).TenantAccessError,
  requireTenantAccess: mocks.requireTenantAccess,
}));
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => ({}) }));
vi.mock('../../infrastructure/auth/segmentResolver', () => ({ resolveSegment: vi.fn() }));

import { authenticateServiceToken, parseWorkspaceHeader } from './serviceTokenAuth';

function ctx(headers: Record<string, string>): Context<HonoEnv> {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { env: {}, req: { header: (name: string) => lower[name.toLowerCase()] } } as unknown as Context<HonoEnv>;
}

async function rejection(p: Promise<unknown>): Promise<TenantAccessError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof TenantAccessError) return err;
    throw err;
  }
  throw new Error('expected a TenantAccessError');
}

beforeEach(() => {
  mocks.resolveSegmentFromHostToken.mockReset();
  mocks.requireTenantAccess.mockReset();
});

describe('parseWorkspaceHeader', () => {
  it('accepts a positive integer tenant id', () => {
    expect(parseWorkspaceHeader('42')).toBe(42);
  });

  it.each([undefined, '', '0', '-3', '1.5', '1e3', 'abc', '7abc', '99999999999999999999'])(
    'regression: refuses %s with 400 (no silent default tenant)',
    (value) => {
      expect(() => parseWorkspaceHeader(value)).toThrowError(TenantAccessError);
      try {
        parseWorkspaceHeader(value);
      } catch (err) {
        expect((err as TenantAccessError).status).toBe(400);
      }
    },
  );
});

describe('authenticateServiceToken — host OIDC path', () => {
  it('regression: a non-integer workspace header answers 400 before any token check', async () => {
    const err = await rejection(authenticateServiceToken(
      ctx({ 'X-IdP-Token': 'tok', 'x-builderforce-workspace': '1.5' }), 'ingest:feedback', {},
    ));
    expect(err.status).toBe(400);
    expect(mocks.resolveSegmentFromHostToken).not.toHaveBeenCalled();
  });

  it('regression: a missing workspace header answers 400 (no default to tenant 1)', async () => {
    const err = await rejection(authenticateServiceToken(ctx({ 'X-IdP-Token': 'tok' }), 'ingest:feedback', {}));
    expect(err.status).toBe(400);
    expect(mocks.resolveSegmentFromHostToken).not.toHaveBeenCalled();
  });

  it('regression: an OIDC token refused segments:manage answers 403 insufficient_scope', async () => {
    mocks.resolveSegmentFromHostToken.mockResolvedValue({ ok: false, status: 403, error: 'no' });
    const err = await rejection(authenticateServiceToken(
      ctx({ 'X-IdP-Token': 'tok', 'x-builderforce-workspace': '7' }), 'segments:manage', {},
    ));
    expect(err.status).toBe(403);
    expect(err.code).toBe('insufficient_scope');
    expect(mocks.resolveSegmentFromHostToken).toHaveBeenCalledWith({}, {}, 7, 'tok', 'segments:manage');
  });

  it('maps a verification failure to 401 invalid_idp_token', async () => {
    mocks.resolveSegmentFromHostToken.mockResolvedValue({ ok: false, status: 401, error: 'Token has no expiry.' });
    const err = await rejection(authenticateServiceToken(
      ctx({ 'X-IdP-Token': 'tok', 'x-builderforce-workspace': '7' }), 'ingest:feedback', {},
    ));
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_idp_token');
  });

  it('returns a segment-bound context on success', async () => {
    mocks.resolveSegmentFromHostToken.mockResolvedValue({ ok: true, segmentId: 'seg-9', claims: {} });
    const svc = await authenticateServiceToken(
      ctx({ 'X-IdP-Token': 'tok', 'x-builderforce-workspace': '7' }), 'ingest:feedback', {},
    );
    expect(svc).toEqual({ tenantId: 7, segmentId: 'seg-9', tenantApiKeyId: null, boundToSegment: true });
    expect(mocks.requireTenantAccess).not.toHaveBeenCalled();
  });
});
