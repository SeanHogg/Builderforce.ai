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
    .select({ id: agentHosts.id, tenantId: agentHosts.tenantId, apiKeyHash: agentHosts.apiKeyHash })
    .from(agentHosts)
    .where(eq(agentHosts.id, id));
  if (!agentHost) return null;
  const valid = await verifySecret(key, agentHost.apiKeyHash);
  return valid ? { id: agentHost.id, tenantId: agentHost.tenantId } : null;
}

/** Resolve a agentHost from `Authorization: Bearer` + `X-AgentHost-Id`. */
export async function verifyBearerAgentHost(
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

/** Resolve an authenticated agentHost from Bearer+header OR ?agentHostId=&key=. */
export async function resolveHostAuth(db: Db, c: Context): Promise<AuthedAgentHost | null> {
  const bearer = await verifyBearerAgentHost(db, c.req.header('Authorization'), c.req.header('X-AgentHost-Id'));
  if (bearer) return bearer;
  const idParam = Number(c.req.query('agentHostId') ?? '');
  const key = c.req.query('key');
  if (!Number.isNaN(idParam) && idParam > 0 && key) return verifyAgentHostApiKey(db, idParam, key);
  return null;
}
