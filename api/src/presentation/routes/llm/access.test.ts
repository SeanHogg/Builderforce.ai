import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { errorHandler } from '../../middleware/errorHandler';
import { ServiceUnavailableError } from '../../../domain/shared/errors';
import { DATABASE_UNAVAILABLE_CODE } from '../../../infrastructure/database/neonAvailability';
import { respondToAccessError, TenantAccessError } from './access';

/** The Worker bindings the error handler's CORS step reads (`c.env.CORS_ORIGINS`). */
const TEST_ENV = { CORS_ORIGINS: '*' } as unknown as HonoEnv['Bindings'];

/** A gateway-shaped route: `requireTenantAccess` is replaced by whatever `fail` throws. */
function appThrowing(fail: () => never) {
  const app = new Hono<HonoEnv>();
  app.onError(errorHandler);
  app.get('/', (c) => {
    try { fail(); } catch (err) { return respondToAccessError(c, err); }
    return c.text('ok');
  });
  return app;
}

describe('respondToAccessError', () => {
  it('regression: a database outage is a 503 database_unavailable, never a fake 401', async () => {
    const res = await appThrowing(() => {
      throw new ServiceUnavailableError('down', { code: DATABASE_UNAVAILABLE_CODE });
    }).request('/', undefined, TEST_ENV);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: DATABASE_UNAVAILABLE_CODE });
  });

  it('regression: a plain Error wrapping the outage (drizzle-style cause) is still a 503', async () => {
    const res = await appThrowing(() => {
      throw new Error('Failed query: select 1', { cause: new ServiceUnavailableError('down', { code: DATABASE_UNAVAILABLE_CODE }) });
    }).request('/', undefined, TEST_ENV);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: DATABASE_UNAVAILABLE_CODE });
  });

  it('a plain Error (bad/missing/expired credential) still answers 401', async () => {
    const res = await appThrowing(() => { throw new Error('Token expired'); }).request('/');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Token expired' });
  });

  it('a TenantAccessError keeps its own status and code', async () => {
    const res = await appThrowing(() => { throw new TenantAccessError(403, 'origin_not_authorized', 'nope'); }).request('/');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'nope', code: 'origin_not_authorized' });
  });
});
