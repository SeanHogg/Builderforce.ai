import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, agentRegistrations } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import { TenantRole } from '../../domain/shared/types';
import { authMiddleware, isManager, requireRole } from '../middleware/authMiddleware';
import {
  AGENT_PROTOCOLS,
  SUPPORTED_AGENT_FRAMEWORKS,
  effectiveCapabilities,
  normalizeCapabilities,
  normalizeEndpoint,
  normalizeFramework,
  normalizeHealthStatus,
  normalizeJsonObject,
  normalizeProtocol,
} from '../../application/agent/agentRegistration';

type RegistrationInput = {
  name?: unknown;
  framework?: unknown;
  protocol?: unknown;
  endpoint?: unknown;
  agentHostId?: unknown;
  externalAgentId?: unknown;
  credentialRef?: unknown;
  declaredCapabilities?: unknown;
  discoveredCapabilities?: unknown;
  agentCard?: unknown;
  metadata?: unknown;
};

function cleanOptionalString(value: unknown, field: string, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function parseHostId(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('agentHostId must be a positive integer');
  }
  return value;
}

function serialize(row: typeof agentRegistrations.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    framework: row.framework,
    protocol: row.protocol,
    endpoint: row.endpoint,
    agentHostId: row.agentHostId,
    externalAgentId: row.externalAgentId,
    status: row.status,
    healthStatus: row.healthStatus,
    declaredCapabilities: row.declaredCapabilities,
    discoveredCapabilities: row.discoveredCapabilities,
    capabilities: effectiveCapabilities(row.declaredCapabilities, row.discoveredCapabilities),
    agentCard: row.agentCard,
    metadata: row.metadata,
    credentialConfigured: row.credentialRef != null,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    legacyAgentId: row.legacyAgentId,
  };
}

export function createAgentRegistrationRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/frameworks', (c) => c.json({ frameworks: SUPPORTED_AGENT_FRAMEWORKS, protocols: AGENT_PROTOCOLS }));

  router.get('/', async (c) => {
    const rows = await db.select().from(agentRegistrations).where(and(
      eq(agentRegistrations.tenantId, c.get('tenantId')),
      eq(agentRegistrations.segmentId, c.get('segmentId')),
    )).orderBy(asc(agentRegistrations.name));
    return c.json({ agents: rows.map(serialize) });
  });

  router.post('/', requireRole(TenantRole.MANAGER) as never, async (c) => {
    let body: RegistrationInput;
    try {
      body = await c.req.json<RegistrationInput>();
      const name = cleanOptionalString(body.name, 'name', 255);
      if (!name) throw new Error('name is required');
      const framework = normalizeFramework(body.framework);
      const protocol = normalizeProtocol(body.protocol);
      const endpoint = normalizeEndpoint(body.endpoint);
      const agentHostId = parseHostId(body.agentHostId);
      if (!endpoint && !agentHostId) throw new Error('endpoint or agentHostId is required');
      if (protocol === 'acp' && !agentHostId) throw new Error('ACP agents must be bound to an agentHostId');

      if (agentHostId) {
        const [host] = await db.select({ id: agentHosts.id }).from(agentHosts).where(and(
          eq(agentHosts.id, agentHostId),
          eq(agentHosts.tenantId, c.get('tenantId')),
          eq(agentHosts.segmentId, c.get('segmentId')),
        )).limit(1);
        if (!host) return c.json({ error: 'AgentHost not found' }, 404);
      }

      const [created] = await db.insert(agentRegistrations).values({
        tenantId: c.get('tenantId'),
        segmentId: c.get('segmentId'),
        name,
        framework,
        protocol,
        endpoint,
        agentHostId,
        externalAgentId: cleanOptionalString(body.externalAgentId, 'externalAgentId', 255),
        credentialRef: cleanOptionalString(body.credentialRef, 'credentialRef', 255),
        declaredCapabilities: normalizeCapabilities(body.declaredCapabilities, 'declaredCapabilities'),
        discoveredCapabilities: normalizeCapabilities(body.discoveredCapabilities, 'discoveredCapabilities'),
        agentCard: normalizeJsonObject(body.agentCard, 'agentCard', 65_536),
        metadata: normalizeJsonObject(body.metadata, 'metadata', 32_768) ?? {},
        registeredBy: c.get('userId'),
      }).returning();
      if (!created) return c.json({ error: 'Failed to register agent' }, 500);
      return c.json({ agent: serialize(created) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid registration' }, 400);
    }
  });

  router.get('/:id', async (c) => {
    const [row] = await db.select().from(agentRegistrations).where(and(
      eq(agentRegistrations.id, c.req.param('id')),
      eq(agentRegistrations.tenantId, c.get('tenantId')),
      eq(agentRegistrations.segmentId, c.get('segmentId')),
    )).limit(1);
    if (!row) return c.json({ error: 'Agent registration not found' }, 404);
    return c.json({ agent: serialize(row) });
  });

  router.patch('/:id', requireRole(TenantRole.MANAGER) as never, async (c) => {
    try {
      const body = await c.req.json<RegistrationInput & { status?: unknown }>();
      const update: Partial<typeof agentRegistrations.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) {
        const name = cleanOptionalString(body.name, 'name', 255);
        if (!name) throw new Error('name is required');
        update.name = name;
      }
      if (body.framework !== undefined) update.framework = normalizeFramework(body.framework);
      if (body.protocol !== undefined) update.protocol = normalizeProtocol(body.protocol);
      if (body.endpoint !== undefined) update.endpoint = normalizeEndpoint(body.endpoint);
      if (body.externalAgentId !== undefined) update.externalAgentId = cleanOptionalString(body.externalAgentId, 'externalAgentId', 255);
      if (body.credentialRef !== undefined) update.credentialRef = cleanOptionalString(body.credentialRef, 'credentialRef', 255);
      if (body.declaredCapabilities !== undefined) update.declaredCapabilities = normalizeCapabilities(body.declaredCapabilities, 'declaredCapabilities');
      if (body.metadata !== undefined) update.metadata = normalizeJsonObject(body.metadata, 'metadata', 32_768) ?? {};
      if (body.status !== undefined) {
        if (body.status !== 'active' && body.status !== 'inactive') throw new Error('status must be active or inactive');
        update.status = body.status;
      }
      const [row] = await db.update(agentRegistrations).set(update).where(and(
        eq(agentRegistrations.id, c.req.param('id')),
        eq(agentRegistrations.tenantId, c.get('tenantId')),
        eq(agentRegistrations.segmentId, c.get('segmentId')),
      )).returning();
      if (!row) return c.json({ error: 'Agent registration not found' }, 404);
      return c.json({ agent: serialize(row) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid registration' }, 400);
    }
  });

  // Runtime capability report. A manager may report manually; a machine token may
  // only report for a registration bound to that exact AgentHost.
  router.post('/:id/capabilities', async (c) => {
    const machine = c.get('machineActor');
    const [existing] = await db.select().from(agentRegistrations).where(and(
      eq(agentRegistrations.id, c.req.param('id')),
      eq(agentRegistrations.tenantId, c.get('tenantId')),
      eq(agentRegistrations.segmentId, c.get('segmentId')),
    )).limit(1);
    if (!existing) return c.json({ error: 'Agent registration not found' }, 404);
    if (!isManager(c) && (!machine || machine.kind !== 'agent_host' || machine.agentHostId !== existing.agentHostId)) {
      return c.json({ error: 'Only a manager or the bound AgentHost may report capabilities' }, 403);
    }
    try {
      const body = await c.req.json<{ capabilities?: unknown; agentCard?: unknown; healthStatus?: unknown; externalAgentId?: unknown }>();
      const [row] = await db.update(agentRegistrations).set({
        discoveredCapabilities: normalizeCapabilities(body.capabilities, 'capabilities'),
        ...(body.agentCard !== undefined ? { agentCard: normalizeJsonObject(body.agentCard, 'agentCard', 65_536) } : {}),
        ...(body.healthStatus !== undefined ? { healthStatus: normalizeHealthStatus(body.healthStatus) } : { healthStatus: 'online' }),
        ...(body.externalAgentId !== undefined ? { externalAgentId: cleanOptionalString(body.externalAgentId, 'externalAgentId', 255) } : {}),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(agentRegistrations.id, existing.id)).returning();
      return c.json({ agent: serialize(row!) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid capability report' }, 400);
    }
  });

  router.delete('/:id', requireRole(TenantRole.MANAGER) as never, async (c) => {
    const [row] = await db.update(agentRegistrations).set({ status: 'inactive', updatedAt: new Date() }).where(and(
      eq(agentRegistrations.id, c.req.param('id')),
      eq(agentRegistrations.tenantId, c.get('tenantId')),
      eq(agentRegistrations.segmentId, c.get('segmentId')),
    )).returning();
    if (!row) return c.json({ error: 'Agent registration not found' }, 404);
    return c.json({ agent: serialize(row) });
  });

  return router;
}
