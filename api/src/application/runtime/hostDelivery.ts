/**
 * Delivering a run to a pinned On-Prem agent host through the relay Durable Object:
 * the frame, the targets, the claim window and the withdraw. Split from
 * `dispatchCloudRun` so the cloud dispatcher holds no relay mechanics.
 */
import { and, eq } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { recordCloudToolEvent } from './cloudAgentEngine';
import { deliverWithinClaimWindow } from './hostClaimWindow';
import type { ResolvedArtifacts } from '../../domain/shared/types';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts } from '../../infrastructure/database/schema';
import { agentHostOnlineCondition } from '../../infrastructure/database/agentHostOnline';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';

/**
 * The dispatcher's binding surface: the platform `Env` plus the On-Prem host
 * relay Durable Object. Declared here rather than imported from the route module
 * so the dependency arrow stays inward.
 */
export type DispatchEnv = Env & {
  AGENT_HOST_RELAY?: DurableObjectNamespace<AgentHostRelayDO>;
};

export type DispatchMessage = {
  type: 'task.assign' | 'task.broadcast';
  executionId: number;
  taskId: number;
  payload?: string;
  /** Agent runtime engine resolved from the run-target cloud agent (default v1). */
  engine?: string;
  /** Human label of the executing cloud agent (change traceability). */
  agentLabel?: string;
  /** Repo bound to the task's project, for cloning into the ticket workspace. */
  repo?: { repoId: string; defaultBranch: string | null };
  task: {
    title: string;
    description?: string | null;
  };
  artifacts?: ResolvedArtifacts;
};

/**
 * Deliver a `task.assign` frame to a pinned host through the relay. `false` = not delivered
 * (offline, errored). A relay that REJECTS the frame as malformed answers 400; that is a
 * bug in what we built, not an offline host, so `onRejected` is told the reason instead of
 * the rejection vanishing into the same `false`.
 */
export async function dispatchToAgentHost(
  env: DispatchEnv, agentHostId: number, message: DispatchMessage,
  onRejected?: (reason: string) => void,
): Promise<boolean> {
  if (!env.AGENT_HOST_RELAY) return false;
  const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHostId)));
  const response = await stub.fetch('https://relay.internal/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (response.status === 400) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    onRejected?.(typeof body?.error === 'string' ? body.error : 'frame_rejected');
  }
  return response.ok;
}

/** Best-effort `execution.cancel` to a host whose claim window expired, so a late ack cannot
 *  run the same execution on the machine while the cloud executor also runs it. */
export async function withdrawFromAgentHost(env: DispatchEnv, agentHostId: number, executionId: number): Promise<void> {
  if (!env.AGENT_HOST_RELAY) return;
  const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHostId)));
  await stub.fetch('https://relay.internal/execution-cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionId }),
  });
}

export async function getDispatchTargets(db: Db, tenantId: number, assignedAgentHostId?: number | null): Promise<number[]> {
  if (assignedAgentHostId != null) {
    const [row] = await db
      .select({ id: agentHosts.id })
      .from(agentHosts)
      .where(
        and(
          eq(agentHosts.id, assignedAgentHostId),
          eq(agentHosts.tenantId, tenantId),
        ),
      );
    return row ? [row.id] : [];
  }

  const rows = await db
    .select({ id: agentHosts.id })
    .from(agentHosts)
    .where(
      and(
        eq(agentHosts.tenantId, tenantId),
        agentHostOnlineCondition(),
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * Offer a run to its pinned host(s) inside the claim window. True when a host acked in time.
 *
 * A relay that REJECTS the frame (400) does not fail the run: it falls back to the cloud
 * executor, exactly as for an offline host - the run was valid, our frame was not. What it
 * must not do is vanish, so the rejection is written to the run's timeline.
 */
export async function deliverToPinnedHosts(
  env: Env, db: Db, waitUntil: (p: Promise<unknown>) => void,
  run: { tenantId: number; executionId: number; cloudAgentRef?: string; targets: number[]; message: DispatchMessage },
): Promise<boolean> {
  const { tenantId, executionId, cloudAgentRef, targets, message } = run;
  const acks = await Promise.all(targets.map((targetId) => deliverWithinClaimWindow(
    () => dispatchToAgentHost(env as DispatchEnv, targetId, message, (reason) => {
      waitUntil(recordCloudToolEvent(db, {
        tenantId, cloudAgentRef, executionId,
        toolName: 'runtime.host_frame_rejected', category: 'error',
        detail: { reason, agentHostId: targetId, frameType: message.type },
        result: `The agent host relay rejected the dispatch frame (${reason}); the run falls back to the cloud.`,
      }).catch((error) => reportCaughtError(error, { source: 'application/runtime/hostDelivery.ts', operation: 'deliverToPinnedHosts', context: { logMessage: '[runtime-dispatch] frame-rejection telemetry failed', details: { tenantId, executionId, error } } })));
    }),
    { onTimeout: () => withdrawFromAgentHost(env as DispatchEnv, targetId, executionId), waitUntil },
  )));
  return acks.some(Boolean);
}
