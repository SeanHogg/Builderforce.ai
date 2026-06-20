import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import { vscodeConnections } from '../../infrastructure/database/schema';

/**
 * VS Code coder-agent connection tracking. Authenticated with a tenant JWT (exchanged
 * from the editor's tenant API key via /api/auth/tenant-api-key-token), so connect()
 * records the human-in-the-loop link for the signed-in user + tenant.
 */
export function createVscodeRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // POST /api/vscode/connect — register or heartbeat this VS Code connection.
  router.post('/connect', async (c) => {
    const userId = c.get('userId') as string;
    const tenantId = c.get('tenantId') as number;
    const body = await c.req
      .json<{ machineName?: string; extensionVersion?: string }>()
      .catch(() => ({} as { machineName?: string; extensionVersion?: string }));
    const machineName = (body.machineName ?? '').slice(0, 255) || 'vscode';
    const extensionVersion = (body.extensionVersion ?? '').slice(0, 32) || null;

    const [existing] = await db
      .select({ id: vscodeConnections.id })
      .from(vscodeConnections)
      .where(
        and(
          eq(vscodeConnections.tenantId, tenantId),
          eq(vscodeConnections.userId, userId),
          eq(vscodeConnections.machineName, machineName),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(vscodeConnections)
        .set({ status: 'active', extensionVersion, lastSeenAt: sql`now()` })
        .where(eq(vscodeConnections.id, existing.id));
    } else {
      await db.insert(vscodeConnections).values({ tenantId, userId, machineName, extensionVersion });
    }

    return c.json({ ok: true });
  });

  // GET /api/vscode/connections — list this tenant's VS Code connections (for the
  // workforce/observability surface). Cached read is unnecessary: small, rarely polled.
  router.get('/connections', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select()
      .from(vscodeConnections)
      .where(eq(vscodeConnections.tenantId, tenantId))
      .orderBy(desc(vscodeConnections.lastSeenAt))
      .limit(100);
    return c.json({ connections: rows });
  });

  return router;
}
