/**
 * "Which tenant is calling?" — the agent-host half.
 *
 * Span ingest has needed this since the runtime started forwarding telemetry, and
 * the on-prem/VSIX error reporter needs the same answer: a self-hosted runtime
 * holds only its host key, while the VS Code extension holds a JWT it already
 * exchanges for. Two doors, one question.
 *
 * The KEY door lives here because resolving it touches infrastructure; the JWT
 * door is `presentation/middleware/callerTenant.ts`, which composes the two.
 * Splitting them is what keeps a middleware from reaching past application into
 * the database, and it is why this file exists rather than one bigger one.
 */
import type { Context } from 'hono';

import { resolveHostAuth } from '../../infrastructure/auth/agentHostAuth';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

export interface CallerTenant {
  tenantId: number;
  /** The agent host that authenticated, or null when a tenant JWT did. */
  agentHostId: number | null;
}

/**
 * Resolve the caller as an agent host, from any of the key conventions in use
 * (`Authorization: Bearer` + `X-AgentHost-Id`, or `?agentHostId=&key=`).
 *
 * `null` means "not an agent host" — the caller decides whether to try the JWT
 * door next and which status code a total failure gets.
 */
export async function resolveAgentHostCaller(
  db: Db,
  c: Context<HonoEnv>,
): Promise<CallerTenant | null> {
  const agentHost = await resolveHostAuth(db, c);
  return agentHost ? { tenantId: agentHost.tenantId, agentHostId: agentHost.id } : null;
}
