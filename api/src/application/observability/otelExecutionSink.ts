/**
 * The execution-event sink that feeds a tenant's OpenTelemetry collector.
 *
 * It subscribes to the SAME hub the relay and board sinks use, rather than adding
 * an export call to each of the dozen places that record a run event. That is the
 * whole reason the hub exists: a new destination is one more sink, and it cannot
 * miss an event some writer forgot to tell it about.
 *
 * Every frame is exported as it happens rather than batched at run end, because a
 * collector is most useful while the run is still going — an operator watching a
 * long run in their own dashboard is the case this closes.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { ExecutionEventSink, ExecutionSubscriberEvent } from '../runtime/executionEvents';
import { exportAgentSpans } from './otelExporter';
import type { AgentSpan } from './otelSpans';
import type { Env } from '../../env';

/** Map one execution frame onto a span, or null for a frame not worth a span. */
export function spanForEvent(event: ExecutionSubscriberEvent): AgentSpan | null {
  const at = Date.parse(event.ts);
  const startTimeMs = Number.isFinite(at) ? at : Date.now();
  switch (event.type) {
    case 'status_change':
    case 'done':
      return {
        executionId: event.executionId,
        name: `agent.run.${event.status}`,
        startTimeMs,
        // A run that ended in `failed` is an error to the collector; nothing else here
        // is a judgement, so nothing else claims to be one.
        ...(event.status === 'failed' ? { ok: false } : event.status === 'completed' ? { ok: true } : {}),
        attributes: { 'builderforce.execution_id': event.executionId, 'builderforce.status': event.status },
      };
    case 'tool_event':
      return {
        executionId: event.executionId,
        name: `agent.tool.${event.toolName}`,
        startTimeMs: startTimeMs - (event.durationMs ?? 0),
        endTimeMs: startTimeMs,
        attributes: {
          'builderforce.execution_id': event.executionId,
          'builderforce.tool': event.toolName,
          'builderforce.category': event.category,
          'builderforce.agent': event.cloudAgentRef,
          'builderforce.result': event.result?.slice(0, 200),
        },
      };
    // A message is the run talking and a file change is a detail of a tool call; both
    // would triple the span volume without telling an operator anything the two kinds
    // above do not. Deliberately not exported.
    default:
      return null;
  }
}

/** Resolve which workspace a run belongs to. Cached — runs emit many events. */
async function tenantForExecution(env: Env, db: Db, executionId: number): Promise<number | null> {
  return getOrSetCached(
    env,
    `otel:exec-tenant:${executionId}`,
    async () => {
      const [row] = await db
        .select({ tenantId: executions.tenantId })
        .from(executions)
        .where(eq(executions.id, executionId))
        .limit(1);
      return row?.tenantId ?? null;
    },
    { kvTtlSeconds: 3600, l1TtlMs: 300_000 },
  );
}

/** The sink. Fire-and-forget: an export must never delay or fail a run. */
export function makeOtelExecutionSink(env: Env, db: Db): ExecutionEventSink {
  return (event) => {
    const span = spanForEvent(event);
    if (!span) return;
    void (async () => {
      const tenantId = await tenantForExecution(env, db, event.executionId);
      if (tenantId == null) return;
      await exportAgentSpans(env, db, tenantId, [span]);
    })().catch(() => {
      /* exportAgentSpans already records its own failures on the exporter row */
    });
  };
}
