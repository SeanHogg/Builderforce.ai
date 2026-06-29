/**
 * Migration routes — /api/migrations
 *
 * Drives the "stage before it lands" import wizard over the boardsync provider
 * framework. A run is created, the provider's discover() enumerates external
 * projects/types/users, the operator maps + combines them, items are staged,
 * and only commit() promotes anything into real projects/tasks/members.
 *
 * POST   /api/migrations              Start a run (discover)            (MANAGER+)
 * GET    /api/migrations              List runs (history)               (MANAGER+)
 * GET    /api/migrations/:id          Run detail (staging snapshot)     (MANAGER+)
 * PATCH  /api/migrations/:id/mappings Set project/type/user/item maps   (MANAGER+)
 * POST   /api/migrations/:id/stage    Pull items into staging           (MANAGER+)
 * POST   /api/migrations/:id/commit   Promote staged data (import)      (MANAGER+)
 * DELETE /api/migrations/:id          Discard a run                     (MANAGER+)
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { MigrationService, type ImportMode, type ProviderForBoard } from '../../application/migration/MigrationService';
import { createMigrationStore } from '../../application/migration/migrationStore';
import { loadConnectionCredentials } from '../../application/boardsync/drizzleStore';
import { createBoardProvider } from '../../application/boardsync/providers';
import { DISCOVERY_PROVIDER_IDS } from '../../application/boardsync/providerCatalog';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';

const MODES: readonly ImportMode[] = ['migrate', 'sync', 'both'];

export function createMigrationRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const manager = requireRole(TenantRole.MANAGER);
  const service = new MigrationService(createMigrationStore(db));

  const verKey = (tenantId: number) => `migrations:${tenantId}`;
  const bump = (c: { env: Env }, tenantId: number) => bumpCacheVersion(c.env, verKey(tenantId));

  /** Build a provider factory bound to a run's credential (null board = discover). */
  async function providerFactory(
    env: Env, tenantId: number, provider: string, credentialId: string | null,
  ): Promise<ProviderForBoard | null> {
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
    const loaded = await loadConnectionCredentials(db, tenantId, credentialId, secret);
    if (!loaded) return null;
    return (externalBoardId) => createBoardProvider(provider, { credentials: loaded.credentials, baseUrl: loaded.baseUrl, externalBoardId }, fetch);
  }

  // POST /api/migrations — create + discover.
  router.post('/', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = (c.get('segmentId') as string | undefined) ?? null;
    const userId = (c.get('userId') as string | undefined) ?? null;
    const body = await c.req.json<{ provider: string; credentialId: string; mode?: ImportMode }>();

    if (!body.provider || !body.credentialId) return c.json({ error: 'provider and credentialId are required' }, 400);
    if (!DISCOVERY_PROVIDER_IDS.includes(body.provider)) {
      return c.json({ error: `Migration is available for: ${DISCOVERY_PROVIDER_IDS.join(', ')}` }, 400);
    }
    const mode: ImportMode = MODES.includes(body.mode as ImportMode) ? (body.mode as ImportMode) : 'migrate';

    const factory = await providerFactory(c.env, tenantId, body.provider, body.credentialId);
    if (!factory) return c.json({ error: 'Failed to load integration credentials' }, 400);

    try {
      const detail = await service.startRun(
        { tenantId, segmentId, provider: body.provider, credentialId: body.credentialId, mode, createdBy: userId },
        factory(null),
      );
      await bump(c, tenantId);
      return c.json(detail, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Discovery failed' }, 502);
    }
  });

  // GET /api/migrations — run history (cached, version-bumped on writes).
  router.get('/', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const ver = await getCacheVersion(c.env, verKey(tenantId));
    const runs = await getOrSetCached(c.env, `migrations:list:${tenantId}:${ver}`, () => service.listRuns(tenantId));
    return c.json({ runs });
  });

  // GET /api/migrations/:id — staging snapshot (cached).
  router.get('/:id', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const ver = await getCacheVersion(c.env, verKey(tenantId));
    const detail = await getOrSetCached(c.env, `migrations:run:${tenantId}:${id}:${ver}`, () => service.getDetail(id, tenantId));
    if (!detail) return c.json({ error: 'Migration run not found' }, 404);
    return c.json(detail);
  });

  // PATCH /api/migrations/:id/mappings
  router.patch('/:id/mappings', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json();
    try {
      const detail = await service.setMappings(id, tenantId, body);
      await bump(c, tenantId);
      return c.json(detail);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to set mappings' }, 400);
    }
  });

  // POST /api/migrations/:id/stage — pull items into staging.
  router.post('/:id/stage', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const run = await service.getDetail(id, tenantId);
    if (!run) return c.json({ error: 'Migration run not found' }, 404);
    const factory = await providerFactory(c.env, tenantId, run.run.provider, run.run.credentialId);
    if (!factory) return c.json({ error: 'Failed to load integration credentials' }, 400);
    try {
      const detail = await service.stageItems(id, tenantId, factory);
      await bump(c, tenantId);
      return c.json(detail);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Staging failed' }, 502);
    }
  });

  // POST /api/migrations/:id/commit — promote staged data.
  router.post('/:id/commit', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const run = await service.getDetail(id, tenantId);
    if (!run) return c.json({ error: 'Migration run not found' }, 404);
    const factory = await providerFactory(c.env, tenantId, run.run.provider, run.run.credentialId);
    if (!factory) return c.json({ error: 'Failed to load integration credentials' }, 400);
    try {
      const result = await service.commit(id, tenantId, factory);
      await bump(c, tenantId);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Import failed' }, 502);
    }
  });

  // DELETE /api/migrations/:id — discard.
  router.delete('/:id', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    try {
      await service.discard(id, tenantId);
      await bump(c, tenantId);
      return c.body(null, 204);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to discard run' }, 400);
    }
  });

  return router;
}
