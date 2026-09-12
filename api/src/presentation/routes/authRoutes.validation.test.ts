/**
 * The sign-in and sign-up bodies are validated by `authRoutes.schemas.ts`: a body
 * of the wrong SHAPE is the global `400 { code: 'invalid_request', issues }`, not
 * a TypeError answered as a 500 — while a well-formed body still reaches the
 * handler, and the handler's own messages ("email and password are required"),
 * which the auth screens display, still answer for what they always did.
 *
 * The db is a stub select chain: login finds no user (→ 401), sign-up finds the
 * address taken (→ 409). Both statuses are the handler's, which is the proof the
 * body got past parsing.
 */
import { describe, expect, it, vi } from 'vitest';
import { createAuthRoutes } from './authRoutes';
import { errorHandler } from '../middleware/errorHandler';

/** `db.select(...).from(...).where(...).limit(...)` resolving to `rows`. */
function stubDb(rows: unknown[]) {
  const chain = { from: () => chain, where: () => chain, limit: async () => rows };
  return { select: vi.fn(() => chain) };
}

const authService = { register: vi.fn(), login: vi.fn() };

/** `onError` is the app's own handler — `parseBody` REJECTS, and the 400 is its answer. */
function app(db: ReturnType<typeof stubDb>) {
  const router = createAuthRoutes(authService as never, {} as never, db as never);
  router.onError(errorHandler as never);
  return router;
}

function post(router: ReturnType<typeof app>, path: string, body: unknown) {
  return router.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    {} as never,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );
}

interface InvalidRequest {
  error: string;
  code: string;
  issues: Array<{ path: string; message: string }>;
}

describe('POST /web/login body validation', () => {
  it('400s a wrong-typed field as invalid_request, naming the field', async () => {
    const db = stubDb([]);
    const res = await post(app(db), '/web/login', { email: 42, password: 'hunter22' });
    expect(res.status).toBe(400);
    const body = await res.json() as InvalidRequest;
    expect(body.code).toBe('invalid_request');
    expect(body.issues.map((i) => i.path)).toContain('email');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('400s a body that is not JSON as invalid_request', async () => {
    const res = await post(app(stubDb([])), '/web/login', 'email=a@b.co&password=x');
    expect(res.status).toBe(400);
    const body = await res.json() as InvalidRequest;
    expect(body.code).toBe('invalid_request');
    expect(body.issues).toEqual([{ path: '', message: 'Request body must be valid JSON' }]);
  });

  it('keeps the handler\'s own message for a missing field', async () => {
    const res = await post(app(stubDb([])), '/web/login', { email: 'a@b.co' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'email and password are required' });
  });

  it('lets a well-formed body through to the handler (null sessionName included)', async () => {
    const db = stubDb([]);
    const res = await post(app(db), '/web/login', { email: 'a@b.co', password: 'hunter22', sessionName: null });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid email or password' });
    expect(db.select).toHaveBeenCalled();
  });
});

describe('POST /web/register body validation', () => {
  const valid = {
    email: 'new@b.co',
    password: 'longenough',
    agreeToTerms: true,
    ageAttested: true,
    accountType: 'standard',
  };

  it('400s a wrong-typed field as invalid_request, naming the field', async () => {
    const db = stubDb([]);
    const res = await post(app(db), '/web/register', { ...valid, password: ['longenough'] });
    expect(res.status).toBe(400);
    const body = await res.json() as InvalidRequest;
    expect(body.code).toBe('invalid_request');
    expect(body.issues.map((i) => i.path)).toContain('password');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('400s a body that is not JSON as invalid_request', async () => {
    const res = await post(app(stubDb([])), '/web/register', '{"email":');
    expect(res.status).toBe(400);
    expect((await res.json() as InvalidRequest).code).toBe('invalid_request');
  });

  it('keeps the handler\'s own messages for a missing field and an unticked attestation', async () => {
    const missing = await post(app(stubDb([])), '/web/register', { password: 'longenough' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'email and password are required' });

    // `agreeToTerms` is read as `=== true`, so the string "true" is still the
    // terms refusal, not a schema error.
    const unticked = await post(app(stubDb([])), '/web/register', { ...valid, agreeToTerms: 'true' });
    expect(unticked.status).toBe(400);
    expect(await unticked.json()).toEqual({ error: 'You must accept the Terms of Use and Privacy Policy' });
  });

  it('lets a well-formed body through to the handler', async () => {
    const db = stubDb([{ id: 'existing-user' }]);
    const res = await post(app(db), '/web/register', { ...valid, name: 'extra keys are ignored', anonId: null });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Email already registered' });
  });
});

describe('POST /register (API-key flow) body validation', () => {
  it('400s a missing required field as invalid_request before the service runs', async () => {
    const res = await post(app(stubDb([])), '/register', { email: 'a@b.co' });
    expect(res.status).toBe(400);
    const body = await res.json() as InvalidRequest;
    expect(body.code).toBe('invalid_request');
    expect(body.issues.map((i) => i.path)).toContain('tenantId');
    expect(authService.register).not.toHaveBeenCalled();
  });
});
