/**
 * frontDoor — which credential a router answers to, as a value.
 *
 * Several per-project surfaces (Evermind, facts) are served twice: to people and
 * VS Code under `/api/projects/*` with a tenant JWT, and to on-prem agents under
 * `/api/agent/projects/*` with their agent-host key. Only the auth differs, so each
 * surface is ONE router factory taking a door, never a second hand-copied router
 * whose handlers each re-check the key.
 */
import type { MiddlewareHandler } from 'hono';
import { authMiddleware } from './authMiddleware';
import { hostKeyAuth } from './hostOrTenantAuth';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

export interface FrontDoor {
  /** Authenticates the request and publishes `tenantId` (+ identity) onto it. */
  auth: MiddlewareHandler<HonoEnv>;
  /**
   * True for the agent-host key door. A host acts for a machine, not a person, so
   * surfaces use this to skip person attribution and to expose only their host subset.
   */
  agentHost: boolean;
}

/** People and VS Code: a tenant JWT. */
export const tenantDoor: FrontDoor = { auth: authMiddleware, agentHost: false };

/** On-prem agents: an agent-host API key (Bearer + X-AgentHost-Id, or ?agentHostId=&key=). */
export function agentHostDoor(db: Db): FrontDoor {
  return { auth: hostKeyAuth(db), agentHost: true };
}
