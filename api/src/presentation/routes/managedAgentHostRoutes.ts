/**
 * Managed AgentHost hosting routes — /api/managed-agent-hosts
 *
 * Tenants can request a hosted BuilderForce Agents instance ($49/mo per AgentHost add-on).
 * POST accepts the request as pending and kicks off async provision against
 * AGENT_CONTAINER; DELETE cancels pending rows and deprovisions occupying ones.
 *
 * Routes:
 *   POST /api/managed-agent-hosts          — submit a managed AgentHost request
 *   GET  /api/managed-agent-hosts          — list requests for the current tenant
 *   GET  /api/managed-agent-hosts/:id      — get a single request
 *   DELETE /api/managed-agent-hosts/:id    — cancel / deprovision a request
 */

import { Hono, type MiddlewareHandler } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { background } from '../middleware/background';
import { managedAgentHostRequests } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { TenantRole } from '../../domain/shared/types';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { parseBody, z, zNonEmptyString, zOptionalString } from './requestBody';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import {
  getManagedAgentHostSubscription,
  managedAgentHostRequestBlock,
  occupyingManagedAgentHostCount,
} from '../../application/tenant/managedAgentHostSubscription';
import {
  deprovisionManagedAgentHost,
  provisionManagedAgentHost,
} from '../../application/tenant/managedAgentHostProvision';
import { managedAgentHostContainerRuntime } from '../../application/tenant/managedAgentHostRuntime';

const HostRequestBody = z.object({
  agentHostName: zNonEmptyString,
  region: zOptionalString,
  notes: zOptionalString,
});

export function createManagedAgentHostRoutes(
  db: Db,
  auth: MiddlewareHandler<HonoEnv> = authMiddleware,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', auth);

  // POST /api/managed-agent-hosts — submit a managed AgentHost hosting request
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await parseBody(c, HostRequestBody);
    const entitlement = await getManagedAgentHostSubscription(db, tenantId);
    const occupying = await occupyingManagedAgentHostCount(db, tenantId);
    const blocked = managedAgentHostRequestBlock(entitlement, occupying);
    if (blocked) return c.json({ error: blocked.error }, blocked.status);

    const [inserted] = await db
      .insert(managedAgentHostRequests)
      .values({
        tenantId,
        agentHostName: body.agentHostName,
        region: body.region ?? 'us-east',
        notes: body.notes ?? null,
        status: 'pending',
      })
      .returning();

    if (!inserted) throw new Error('managed_agent_host_requests insert returned no row');

    const deps = {
      runtime: managedAgentHostContainerRuntime(c.env),
      env: c.env,
    };
    background(c, (async () => {
      try {
        const result = await provisionManagedAgentHost(db, deps, {
          requestId: inserted.id,
          registeredBy: userId,
        });
        if ('error' in result) {
          reportCaughtError(new Error(result.error.error), {
            source: 'presentation/routes/managedAgentHostRoutes.ts',
            operation: 'provisionManagedAgentHost',
            context: { requestId: inserted.id, status: result.error.status },
          });
        }
      } catch (error) {
        reportCaughtError(error, {
          source: 'presentation/routes/managedAgentHostRoutes.ts',
          operation: 'provisionManagedAgentHost',
          context: { requestId: inserted.id },
        });
      }
    })());

    return c.json({
      request: inserted,
      message: 'Your managed AgentHost request was accepted. Provisioning has started; the host will show as active once the runtime is ready.',
    }, 201);
  });

  // GET /api/managed-agent-hosts — list all managed AgentHost requests for the tenant
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const rows = await db
      .select()
      .from(managedAgentHostRequests)
      .where(scopedToTenant(managedAgentHostRequests, tenantId))
      .orderBy(desc(managedAgentHostRequests.createdAt)).limit(LIST_ROW_CAP);

    return c.json({ requests: rows });
  });

  // GET /api/managed-agent-hosts/:id — get a single request
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [row] = await db
      .select()
      .from(managedAgentHostRequests)
      .where(scopedToTenant(managedAgentHostRequests, tenantId, eq(managedAgentHostRequests.id, id)))
      .limit(1);

    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ request: row });
  });

  // DELETE /api/managed-agent-hosts/:id — cancel pending or deprovision occupying (owner/manager only)
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));
    const result = await deprovisionManagedAgentHost(db, {
      runtime: managedAgentHostContainerRuntime(c.env),
      env: c.env,
    }, { requestId: id, tenantId });
    if ('error' in result) {
      return c.json({ error: result.error.error }, result.error.status as 404 | 409);
    }
    return c.json({ ok: true });
  });

  return router;
}
