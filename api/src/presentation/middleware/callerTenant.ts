/**
 * "Which tenant is calling?" for the endpoints that accept BOTH an agent-host API
 * key and a signed-in tenant JWT — span ingest, and the on-prem/VSIX error
 * reporter's ingest door.
 *
 * Asking it here once is what keeps the two doors agreeing: the inline copy this
 * replaced accepted only `?agentHostId=&key=` (not the bearer + `X-AgentHost-Id`
 * form every other host-authed route takes), so the same credential was admitted
 * on one endpoint and refused on another.
 */
import type { Context } from 'hono';

import { resolveAgentHostCaller, type CallerTenant } from '../../application/auth/callerTenant';
import { authMiddleware } from './authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

export type { CallerTenant };

/**
 * Resolve the caller from an agent-host API key, falling back to a tenant JWT.
 *
 * Returns `null` when neither credential resolves — the caller decides the status
 * code, because `/api/telemetry` answers 401 as text and the ingest surface as JSON.
 */
export async function resolveCallerTenant(db: Db, c: Context<HonoEnv>): Promise<CallerTenant | null> {
  const agentHost = await resolveAgentHostCaller(db, c);
  if (agentHost) return agentHost;

  try {
    await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
  } catch {
    // authMiddleware throws UnauthorizedError for a missing/invalid token. That is
    // "no credential", not a failure to report — the host-key door already declined.
    return null;
  }
  const tenantId = c.get('tenantId');
  return typeof tenantId === 'number' ? { tenantId, agentHostId: null } : null;
}
