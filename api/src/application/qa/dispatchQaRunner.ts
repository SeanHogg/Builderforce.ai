/**
 * dispatchQaRunner — launch the managed Agentic Tester container for one queued
 * exploration. This is the platform-native drain that replaces the GitHub
 * Action: the scheduled sweep (or a manual run) calls this, which mints a
 * short-lived tenant-scoped token and proxies `POST /run` to QaRunnerContainerDO.
 *
 * Degrades cleanly: when the QA_RUNNER_CONTAINER binding isn't provisioned (no
 * Containers-enabled deploy yet) it returns false and the exploration stays
 * queued for an external runner — the sweep never throws on a missing binding.
 */

import { signJwt } from '../../infrastructure/auth/JwtService';
import { TenantRole } from '../../domain/shared/types';
import type { Env } from '../../env';

/**
 * Mint a short-lived (1h), tenant-scoped JWT the QA runner uses to call the API.
 * The `claw:` subject prefix skips end-user terms enforcement (machine identity);
 * no `jti`/`sv` so it isn't tied to a user session. DEVELOPER role so the runner
 * can read credential secrets + post findings.
 */
export function mintQaAgentToken(env: Env, tenantId: number): Promise<string> {
  return signJwt(
    { sub: 'claw:qa-tester', tid: tenantId, role: TenantRole.DEVELOPER },
    env.JWT_SECRET,
    3600,
  );
}

export interface QaDispatchArgs {
  explorationId: string;
  tenantId: number;
  projectId?: number | null;
}

export async function dispatchQaRunner(env: Env, args: QaDispatchArgs): Promise<boolean> {
  const ns = env.QA_RUNNER_CONTAINER;
  if (!ns) return false; // binding not provisioned — leave the row queued.

  const agentToken = await mintQaAgentToken(env, args.tenantId);
  // The container reaches the public API over the internet (enableInternet).
  const apiBaseUrl = env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai';

  const stub = ns.get(ns.idFromName(`qa-exec:${args.explorationId}`));
  const res = await stub.fetch('https://qa-runner/run', {
    method: 'POST',
    body: JSON.stringify({
      explorationId: args.explorationId,
      agentToken,
      apiBaseUrl,
      ...(args.projectId != null ? { projectId: args.projectId } : {}),
    }),
  });
  return res.ok;
}

/**
 * A non-exploration job for the SAME runner container (no new queue, no new
 * container). The container's `/run` reads `kind` and hands the body to that job's
 * handler (`api/qa-container/server.mjs` → `JOBS`). Each job carries its own
 * narrowly-scoped credentials in `payload`; none gets the tenant-wide QA token.
 */
export interface QaRunnerJob {
  kind: 'replay_export';
  /** Unique per job; names the container instance (`<kind>:<jobId>`). */
  jobId: string;
  payload: Record<string, unknown>;
}

/** Whether the runner container is provisioned on this deploy at all. */
export function qaRunnerProvisioned(env: Env): boolean {
  return Boolean(env.QA_RUNNER_CONTAINER);
}

/** Launch one runner job. False when the binding is absent or the container refused it. */
export async function dispatchQaRunnerJob(env: Env, job: QaRunnerJob): Promise<boolean> {
  const ns = env.QA_RUNNER_CONTAINER;
  if (!ns) return false;
  const stub = ns.get(ns.idFromName(`${job.kind}:${job.jobId}`));
  const res = await stub.fetch('https://qa-runner/run', {
    method: 'POST',
    body: JSON.stringify({ ...job.payload, kind: job.kind }),
  });
  return res.ok;
}
