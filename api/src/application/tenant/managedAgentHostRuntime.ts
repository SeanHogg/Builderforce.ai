/**
 * Cloudflare `AGENT_CONTAINER` adapter for managed AgentHost provisioning.
 *
 * Reuses the existing AgentContainerDO start (GET /health, same as cloud
 * dispatch) and stop (`PREVIEW_CONTROL_STOP_PATH`) seams. One Durable Object
 * per hosting request (`idFromName('managed-host:<requestId>')`) — not a third
 * runtime, and not a fake host.
 */
import { probeContainerHealth } from '../runtime/cloudDispatch';
import { PREVIEW_CONTROL_STOP_PATH } from '../runtime/previewSessions';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';

export function managedHostInstanceName(requestId: number): string {
  return `managed-host:${requestId}`;
}

export interface ManagedAgentHostRuntime {
  start(input: { requestId: number; tenantId: number; region: string }): Promise<
    { ok: true } | { ok: false; reason: string }
  >;
  stop(input: { requestId: number }): Promise<void>;
}

export function managedAgentHostContainerRuntime(
  env: Pick<Env, 'AGENT_CONTAINER'>,
): ManagedAgentHostRuntime {
  return {
    async start({ requestId }) {
      const ns = env.AGENT_CONTAINER;
      if (!ns) return { ok: false, reason: 'AGENT_CONTAINER binding is not configured' };
      try {
        const stub = ns.get(ns.idFromName(managedHostInstanceName(requestId)));
        const healthy = await probeContainerHealth(stub);
        if (!healthy) return { ok: false, reason: 'managed host container health check failed' };
        return { ok: true };
      } catch (error) {
        reportCaughtError(error, {
          source: 'application/tenant/managedAgentHostRuntime.ts',
          operation: 'start',
          context: { requestId },
        });
        return { ok: false, reason: error instanceof Error ? error.message : 'container start failed' };
      }
    },
    async stop({ requestId }) {
      const ns = env.AGENT_CONTAINER;
      if (!ns) return;
      try {
        const stub = ns.get(ns.idFromName(managedHostInstanceName(requestId)));
        await stub.fetch(new Request(`https://agent-container${PREVIEW_CONTROL_STOP_PATH}`, { method: 'POST' }));
      } catch (error) {
        reportCaughtError(error, {
          source: 'application/tenant/managedAgentHostRuntime.ts',
          operation: 'stop',
          context: { requestId },
          level: 'warning',
        });
      }
    },
  };
}
