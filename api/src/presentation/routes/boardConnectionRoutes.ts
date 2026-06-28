/**
 * Board connection routes — /api/board-connections
 *
 * CRUD for external board connections (binds a BF project to a provider +
 * integration credential), plus a manual sync trigger and a links listing.
 *
 * POST   /api/board-connections            Create a connection
 * GET    /api/board-connections            List connections (tenant)
 * GET    /api/board-connections/:id        Get one connection
 * PATCH  /api/board-connections/:id        Update connection
 * DELETE /api/board-connections/:id        Delete connection
 * POST   /api/board-connections/:id/sync   Trigger an inbound sync
 * GET    /api/board-connections/:id/links  List external ticket links
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { boardConnections, externalTicketLinks, projects } from '../../infrastructure/database/schema';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { SyncEngine, type StoredConnection } from '../../application/boardsync/SyncEngine';
import { createDrizzleStore, loadConnectionCredentials } from '../../application/boardsync/drizzleStore';
import { createBoardProvider } from '../../application/boardsync/providers';
import { isItsmProvider, syncItsmConnection } from '../../application/boardsync/itsmIngest';
import { BOARD_PROVIDERS, BOARD_PROVIDER_IDS } from '../../application/boardsync/providerCatalog';

export function createBoardConnectionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/board-connections/providers — the connectable-board catalog.
  // Static in-process constant (no DB / no external IO), so no cache layer is
  // needed; the frontend renders its provider picker from this single source.
  router.get('/providers', (c) => c.json({ providers: BOARD_PROVIDERS }));

  // POST /api/board-connections
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = (c.get('segmentId') as string | undefined) ?? null;
    const body = await c.req.json<{
      projectId: number;
      provider: string;
      credentialId?: string | null;
      externalBoardId?: string | null;
      webhookSecret?: string | null;
      webhookEnabled?: boolean;
      pollIntervalSec?: number;
    }>();

    if (!body.projectId || !body.provider) {
      return c.json({ error: 'projectId and provider are required' }, 400);
    }
    if (!BOARD_PROVIDER_IDS.includes(body.provider)) {
      return c.json({ error: `provider must be one of: ${BOARD_PROVIDER_IDS.join(', ')}` }, 400);
    }

    // Ensure the project belongs to the tenant.
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, body.projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const [row] = await db
      .insert(boardConnections)
      .values({
        tenantId,
        segmentId,
        projectId: body.projectId,
        credentialId: body.credentialId ?? null,
        provider: body.provider,
        externalBoardId: body.externalBoardId ?? null,
        webhookSecret: body.webhookSecret ?? null,
        webhookEnabled: body.webhookEnabled ?? false,
        pollIntervalSec: body.pollIntervalSec ?? 60,
      })
      .returning();

    return c.json(row, 201);
  });

  // GET /api/board-connections
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const rows =
      projectId != null
        ? await db
            .select()
            .from(boardConnections)
            .where(and(eq(boardConnections.tenantId, tenantId), eq(boardConnections.projectId, projectId)))
            .orderBy(desc(boardConnections.createdAt))
        : await db
            .select()
            .from(boardConnections)
            .where(eq(boardConnections.tenantId, tenantId))
            .orderBy(desc(boardConnections.createdAt));
    return c.json({ connections: rows });
  });

  // GET /api/board-connections/:id
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(boardConnections)
      .where(and(eq(boardConnections.id, id), eq(boardConnections.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Connection not found' }, 404);
    return c.json(row);
  });

  // PATCH /api/board-connections/:id
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: boardConnections.id })
      .from(boardConnections)
      .where(and(eq(boardConnections.id, id), eq(boardConnections.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Connection not found' }, 404);

    const body = await c.req.json<{
      credentialId?: string | null;
      externalBoardId?: string | null;
      status?: string;
      webhookSecret?: string | null;
      webhookEnabled?: boolean;
      pollIntervalSec?: number;
    }>();

    const [updated] = await db
      .update(boardConnections)
      .set({
        ...(body.credentialId !== undefined ? { credentialId: body.credentialId } : {}),
        ...(body.externalBoardId !== undefined ? { externalBoardId: body.externalBoardId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.webhookSecret !== undefined ? { webhookSecret: body.webhookSecret } : {}),
        ...(body.webhookEnabled !== undefined ? { webhookEnabled: body.webhookEnabled } : {}),
        ...(body.pollIntervalSec !== undefined ? { pollIntervalSec: body.pollIntervalSec } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(boardConnections.id, id), eq(boardConnections.tenantId, tenantId)))
      .returning();
    return c.json(updated);
  });

  // DELETE /api/board-connections/:id
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [existing] = await db
      .select({ id: boardConnections.id })
      .from(boardConnections)
      .where(and(eq(boardConnections.id, id), eq(boardConnections.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Connection not found' }, 404);
    await db.delete(boardConnections).where(and(eq(boardConnections.id, id), eq(boardConnections.tenantId, tenantId)));
    return c.body(null, 204);
  });

  // POST /api/board-connections/:id/sync
  router.post('/:id/sync', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [conn] = await db
      .select()
      .from(boardConnections)
      .where(and(eq(boardConnections.id, id), eq(boardConnections.tenantId, tenantId)));
    if (!conn) return c.json({ error: 'Connection not found' }, 404);

    const secret = c.env.INTEGRATION_ENCRYPTION_SECRET ?? c.env.JWT_SECRET;
    const loaded = await loadConnectionCredentials(db, tenantId, conn.credentialId, secret);
    if (!loaded) return c.json({ error: 'Failed to load connection credentials' }, 400);

    const store = createDrizzleStore(db);

    // ITSM connections (Freshservice/ServiceNow) feed support_tickets (the Quality
    // lens), NOT the task board — divert manual sync the same way the sweep does.
    if (isItsmProvider(conn.provider)) {
      const provider = createBoardProvider(
        conn.provider,
        { credentials: loaded.credentials, baseUrl: loaded.baseUrl, externalBoardId: conn.externalBoardId },
        fetch,
      );
      try {
        const result = await syncItsmConnection(db, c.env as Env, conn, provider, store);
        return c.json({ connectionId: id, ...result, target: 'support_tickets' });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'sync failed' }, 502);
      }
    }

    const engine = new SyncEngine(store, (sc: StoredConnection) =>
      createBoardProvider(
        sc.provider,
        { credentials: loaded.credentials, baseUrl: loaded.baseUrl, externalBoardId: conn.externalBoardId },
        fetch,
      ),
    );

    try {
      const result = await engine.syncConnection(id);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'sync failed' }, 502);
    }
  });

  // GET /api/board-connections/:id/links
  router.get('/:id/links', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [conn] = await db
      .select({ id: boardConnections.id })
      .from(boardConnections)
      .where(and(eq(boardConnections.id, id), eq(boardConnections.tenantId, tenantId)));
    if (!conn) return c.json({ error: 'Connection not found' }, 404);

    const links = await db
      .select()
      .from(externalTicketLinks)
      .where(and(eq(externalTicketLinks.connectionId, id), eq(externalTicketLinks.tenantId, tenantId)))
      .orderBy(desc(externalTicketLinks.updatedAt));
    return c.json({ links });
  });

  return router;
}
