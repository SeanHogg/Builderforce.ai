/**
 * dispatchStageSandbox — launch the disposable Stage Sandbox container for one
 * queued run. Sibling of application/qa/dispatchQaRunner.ts, same shape: mint a
 * short-lived run-scoped token, proxy `POST /run` to the container's DO, and
 * degrade cleanly (return false, never throw) when the STAGE_SANDBOX_CONTAINER
 * binding isn't provisioned — every non-Containers deploy and local dev must
 * behave exactly as it did before this feature existed.
 */

import { signJwt } from '../../infrastructure/auth/JwtService';
import type { Env } from '../../env';

/**
 * Mint a short-lived (1h), tenant-scoped JWT the container uses to claim its
 * own run and report back — nothing else. The `claw:` subject prefix skips
 * end-user terms enforcement (machine identity); no `jti`/`sv` so it isn't tied
 * to a user session.
 */
export function mintStageSandboxToken(env: Env, tenantId: number): Promise<string> {
  return signJwt({ sub: 'claw:stage-sandbox', tid: tenantId }, env.JWT_SECRET, 3600);
}

export interface StageSandboxDispatchArgs {
  runId: string;
  tenantId: number;
  projectId?: number | null;
}

export async function dispatchStageSandbox(env: Env, args: StageSandboxDispatchArgs): Promise<boolean> {
  const ns = env.STAGE_SANDBOX_CONTAINER;
  if (!ns) return false; // binding not provisioned — the run row is marked 'error' by the caller.

  const agentToken = await mintStageSandboxToken(env, args.tenantId);
  const apiBaseUrl = env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai';

  const stub = ns.get(ns.idFromName(`stage-sandbox:${args.runId}`));
  const res = await stub.fetch('https://stage-sandbox/run', {
    method: 'POST',
    body: JSON.stringify({ runId: args.runId, agentToken, apiBaseUrl }),
  });
  return res.ok;
}
