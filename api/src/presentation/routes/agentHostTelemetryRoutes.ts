/**
 * Host telemetry ingest (host-key auth):
 *   POST /api/agent-hosts/:id/tool-audit
 *   POST /api/agent-hosts/:id/usage-snapshot
 *   POST /api/agent-hosts/:id/file-change
 *
 * Each accepts ONE event (the shape every host in the field posts, answered exactly as
 * before) or a batch `{ events: [...] }` (the relay DO and newer runtimes), written as
 * one multi-row INSERT per request — see application/agentHost/hostTelemetryIngest.
 * A batch is answered `{ ok, inserted }`: one bad event does not refuse its neighbours.
 *
 * The route only authenticates and parses. Registered onto the agent-host router from
 * here rather than grown into it.
 */
import type { Context, Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  eventsOf,
  ingestFileChanges,
  insertToolAuditRows,
  insertUsageSnapshotRows,
  toolAuditRows,
  usageSnapshotRows,
  type HostIdentity,
} from '../../application/agentHost/hostTelemetryIngest';
import { FileChangeIngestBody, ToolAuditIngestBody, UsageSnapshotIngestBody } from './agentHostRoutes.schemas';
import { parseBody, parseOptionalBody } from './requestBody';

export function registerHostTelemetryRoutes<E extends HonoEnv>(
  router: Hono<E>,
  deps: {
    db: Db;
    verifyAgentHostApiKey: (c: Context<E>, id: number, key?: string) => Promise<{ tenantId: number | string } | null | undefined>;
    extractAgentHostKey: (c: Context<E>) => string | undefined;
  },
): void {
  const authenticate = async (c: Context<E>): Promise<HostIdentity | null> => {
    const agentHostId = Number(c.req.param('id'));
    const agentHost = await deps.verifyAgentHostApiKey(c, agentHostId, deps.extractAgentHostKey(c));
    return agentHost ? { tenantId: Number(agentHost.tenantId), agentHostId } : null;
  };

  router.post('/:id/tool-audit', async (c) => {
    const host = await authenticate(c);
    if (!host) return c.text('Unauthorized', 401);
    const { events, single } = eventsOf(await parseBody(c, ToolAuditIngestBody));
    const rows = toolAuditRows(host, events);
    if (single && rows.length === 0) return c.json({ error: 'toolName is required' }, 400);
    const inserted = await insertToolAuditRows(deps.db, rows);
    return c.json(single ? { ok: true } : { ok: true, inserted });
  });

  router.post('/:id/usage-snapshot', async (c) => {
    const host = await authenticate(c);
    if (!host) return c.text('Unauthorized', 401);
    const { events, single } = eventsOf(await parseBody(c, UsageSnapshotIngestBody));
    const inserted = await insertUsageSnapshotRows(deps.db, usageSnapshotRows(host, events));
    return c.json(single ? { ok: true } : { ok: true, inserted });
  });

  router.post('/:id/file-change', async (c) => {
    const host = await authenticate(c);
    if (!host) return c.text('Unauthorized', 401);
    const { events, single } = eventsOf(await parseOptionalBody(c, FileChangeIngestBody));
    const { inserted, rejected } = await ingestFileChanges(deps.db, host, events);
    if (single) {
      const why = rejected[0];
      if (why === 'invalid') return c.json({ error: 'taskId, executionId, and path are required' }, 400);
      if (why === 'execution') return c.json({ error: 'execution not found' }, 404);
      return c.json({ ok: true });
    }
    return c.json({ ok: true, inserted });
  });
}
