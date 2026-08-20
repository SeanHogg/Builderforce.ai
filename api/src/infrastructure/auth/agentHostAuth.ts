/**
 * agentHostAuth — shared BuilderForce Agent (agentHost) API-key authentication.
 *
 * A registered agent authenticates with its API key either as
 * `Authorization: Bearer <key>` + `X-AgentHost-Id: <id>`, or as
 * `?agentHostId=<id>&key=<key>` query params. Both the workflow claim/result
 * endpoints and the swimlane dispatch-result endpoint need EXACTLY this check,
 * so it lives here once (DRY) rather than being re-implemented per route file.
 */
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { agentHosts } from '../database/schema';
import { verifySecret } from './HashService';
import type { Db } from '../database/connection';

export interface AuthedAgentHost {
  id: number;
  tenantId: number;
}

/** Verify an agent API key against the stored hash for agentHost `id`. */
export async function verifyAgentHostApiKey(
  db: Db,
  id: number,
  key?: string | null,
): Promise<AuthedAgentHost | null> {
  if (!key) return null;
  const [agentHost] = await db
    .select({
      id: agentHosts.id,
      tenantId: agentHosts.tenantId,
      apiKeyHash: agentHosts.apiKeyHash,
      status: agentHosts.status,
    })
    .from(agentHosts)
    .where(eq(agentHosts.id, id));
  if (!agentHost) return null;
  // A deactivated/suspended host must not authenticate. The JWT-exchange door
  // (`POST /api/auth/agentHost-token`) has always enforced this; the direct-key
  // door did not, so revoking a host left every key-authed seam open to it.
  if (agentHost.status !== 'active') return null;
  const valid = await verifySecret(key, agentHost.apiKeyHash);
  return valid ? { id: agentHost.id, tenantId: agentHost.tenantId } : null;
}

/** Resolve a agentHost from `Authorization: Bearer` + `X-AgentHost-Id`. */
async function verifyBearerAgentHost(
  db: Db,
  authHeader: string | undefined,
  agentHostIdHeader: string | undefined,
): Promise<AuthedAgentHost | null> {
  if (!authHeader?.startsWith('Bearer ') || !agentHostIdHeader) return null;
  const key = authHeader.slice(7);
  const id = Number(agentHostIdHeader);
  if (!Number.isFinite(id) || id <= 0) return null;
  return verifyAgentHostApiKey(db, id, key);
}

/** The API key on a request: `Authorization: Bearer <key>` or the legacy `?key=`. */
export function extractHostKey(c: Context): string | undefined {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return c.req.query('key') ?? undefined;
}

/**
 * Resolve an authenticated agentHost from any of the three conventions in use:
 *   - `Authorization: Bearer <key>` + `X-AgentHost-Id: <id>`
 *   - `?agentHostId=<id>&key=<key>`
 *   - `Authorization: Bearer <key>` (or `?key=`) with the id in the ROUTE path,
 *     which is how every `/api/agent-hosts/:id/*` endpoint identifies its caller.
 *
 * `idPathParam` opts into the third form by naming the path parameter that holds
 * the id. Keeping all three here is what lets one dual-auth middleware sit in
 * front of routers that address the host differently.
 */
export async function resolveHostAuth(
  db: Db,
  c: Context,
  idPathParam?: string,
): Promise<AuthedAgentHost | null> {
  const bearer = await verifyBearerAgentHost(db, c.req.header('Authorization'), c.req.header('X-AgentHost-Id'));
  if (bearer) return bearer;

  const key = extractHostKey(c);
  if (idPathParam && key) {
    const pathId = Number(c.req.param(idPathParam) ?? '');
    if (Number.isFinite(pathId) && pathId > 0) {
      const fromPath = await verifyAgentHostApiKey(db, pathId, key);
      if (fromPath) return fromPath;
    }
  }

  const idParam = Number(c.req.query('agentHostId') ?? '');
  if (!Number.isNaN(idParam) && idParam > 0 && key) return verifyAgentHostApiKey(db, idParam, key);
  return null;
}
