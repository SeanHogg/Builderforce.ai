/**
 * BuilderForce Agents instance routes – /api/agent-hosts
 *
 * BuilderForce Agents instances are registered machines owned by a tenant.
 * Each instance authenticates with its own API key (not a user credential).
 * One agentHost = one tenant. Users manage their mesh from the web UI.
 *
 * All routes require a tenant-scoped JWT (authMiddleware).
 */
import { Hono, type Context } from 'hono';
import { eq, and, isNull, desc, inArray, gte } from 'drizzle-orm';
import { synthesizeRunFailedEvent } from '../../application/runtime/toolAuditReadRepair';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  agentHosts,
  agentHostProjects,
  agentHostDirectories,
  agentHostDirectoryFiles,
  agentHostSyncHistory,
  chatSessions,
  cronJobs,
  projects,
  tenants,
  usageSnapshots,
  toolAuditEvents,
  approvals,
  executions,
  tenantSkillAssignments,
  agentHostSkillAssignments,
  marketplaceSkills,
  specs,
  taskSpecs,
  platformPersonas,
} from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { invalidateAgentHostKeyCache } from '../../infrastructure/auth/keyResolutionCache';
import { verifyJwt } from '../../infrastructure/auth/JwtService';
import { resolveArtifacts } from '../../application/artifact/resolveArtifacts';
import { SwimlaneCoordinator } from '../../application/swimlane/SwimlaneCoordinator';
import { DrizzleCoordinatorStore } from '../../application/swimlane/DrizzleCoordinatorStore';
import { DrizzlePrdEnsurer } from '../../application/swimlane/DrizzlePrdEnsurer';
import { AgentHostStageDispatcher } from '../../application/swimlane/agentHostStageDispatcher';
import { resolveRepoCredential, isResolveError } from '../../application/repos/resolveRepoCredential';
import { resolveDefaultRepoForTask } from '../../application/repos/resolveDefaultRepo';
import { openDispatchPullRequest } from '../../application/repos/openDispatchPullRequest';
import { openTaskPullRequest } from '../../application/repos/openTaskPullRequest';
import { neon } from '@neondatabase/serverless';
import { executeGitProxy } from '../../application/repos/gitProxy';
import { agentDispatches } from '../../infrastructure/database/schema';
import { isAgentHostOnline } from '../../domain/agentHost/onlineStatus';
import { normalizeRequestKind } from '../../domain/approval/requestKind';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';
import type { AgentHostService } from '../../application/agentHost/AgentHostService';
import { classifyContextFiles, normalizeMachineProfile, type AgentHostMachineProfileInput } from './agentHostAssignmentContext';
import { TenantRole } from '../../domain/shared/types';
import { buildPlanLimitsGuard } from '../middleware/planLimitsGuard';

// Extend HonoEnv bindings type to include the Durable Object
type AgentHostHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    AGENT_HOST_RELAY: DurableObjectNamespace<AgentHostRelayDO>;
  };
};

export function createAgentHostRoutes(db: Db, agentHostService: AgentHostService): Hono<AgentHostHonoEnv> {
  const router = new Hono<AgentHostHonoEnv>();

  const buildAssignmentContext = async (agentHostId: number, tenantId: number, projectId?: number) => {
    const [agentHostRow] = await db
      .select({
        id: agentHosts.id,
        name: agentHosts.name,
        slug: agentHosts.slug,
        tenantId: agentHosts.tenantId,
        machineName: agentHosts.machineName,
        machineIp: agentHosts.machineIp,
        rootInstallDirectory: agentHosts.rootInstallDirectory,
        workspaceDirectory: agentHosts.workspaceDirectory,
        gatewayPort: agentHosts.gatewayPort,
        relayPort: agentHosts.relayPort,
        tunnelUrl: agentHosts.tunnelUrl,
        tunnelStatus: agentHosts.tunnelStatus,
        networkMetadata: agentHosts.networkMetadata,
        lastSeenAt: agentHosts.lastSeenAt,
        connectedAt: agentHosts.connectedAt,
        updatedAt: agentHosts.updatedAt,
      })
      .from(agentHosts)
      .where(and(eq(agentHosts.id, agentHostId), eq(agentHosts.tenantId, tenantId)))
      .limit(1);

    if (!agentHostRow) return null;

    const assignedProjects = await db
      .select({
        id: projects.id,
        key: projects.key,
        name: projects.name,
        description: projects.description,
        status: projects.status,
        rootWorkingDirectory: projects.rootWorkingDirectory,
        updatedAt: projects.updatedAt,
      })
      .from(agentHostProjects)
      .innerJoin(projects, eq(projects.id, agentHostProjects.projectId))
      .where(and(eq(agentHostProjects.tenantId, tenantId), eq(agentHostProjects.agentHostId, agentHostId)))
      .orderBy(desc(projects.updatedAt));

    const primaryProject = projectId != null
      ? assignedProjects.find((project) => project.id === projectId) ?? assignedProjects[0] ?? null
      : assignedProjects[0] ?? null;

    let contextHints = {
      manifestFiles: [] as string[],
      prdFiles: [] as string[],
      taskFiles: [] as string[],
      memoryFiles: [] as string[],
    };
    let directoryPath: string | null = null;

    if (primaryProject) {
      const [latestDirectory] = await db
        .select({ id: agentHostDirectories.id, absPath: agentHostDirectories.absPath })
        .from(agentHostDirectories)
        .where(
          and(
            eq(agentHostDirectories.tenantId, tenantId),
            eq(agentHostDirectories.agentHostId, agentHostId),
            eq(agentHostDirectories.projectId, primaryProject.id),
          ),
        )
        .orderBy(desc(agentHostDirectories.updatedAt))
        .limit(1);

      if (latestDirectory) {
        directoryPath = latestDirectory.absPath;
        const files = await db
          .select({ relPath: agentHostDirectoryFiles.relPath })
          .from(agentHostDirectoryFiles)
          .where(
            and(
              eq(agentHostDirectoryFiles.tenantId, tenantId),
              eq(agentHostDirectoryFiles.agentHostId, agentHostId),
              eq(agentHostDirectoryFiles.directoryId, latestDirectory.id),
            ),
          );
        contextHints = classifyContextFiles(files.map((file) => file.relPath));
      }
    }

    let parsedNetworkMetadata: Record<string, unknown> | null = null;
    if (agentHostRow.networkMetadata) {
      try {
        parsedNetworkMetadata = JSON.parse(agentHostRow.networkMetadata) as Record<string, unknown>;
      } catch {
        parsedNetworkMetadata = null;
      }
    }

    return {
      agentHost: {
        id: agentHostRow.id,
        slug: agentHostRow.slug,
        name: agentHostRow.name,
        tenantId: agentHostRow.tenantId,
        lastSeenAt: agentHostRow.lastSeenAt,
        connectedAt: agentHostRow.connectedAt,
        updatedAt: agentHostRow.updatedAt,
        machineProfile: {
          machineName: agentHostRow.machineName,
          machineIp: agentHostRow.machineIp,
          rootInstallDirectory: agentHostRow.rootInstallDirectory,
          workspaceDirectory: agentHostRow.workspaceDirectory,
          gatewayPort: agentHostRow.gatewayPort,
          relayPort: agentHostRow.relayPort,
          tunnelUrl: agentHostRow.tunnelUrl,
          tunnelStatus: agentHostRow.tunnelStatus,
          networkMetadata: parsedNetworkMetadata,
        },
      },
      projects: assignedProjects,
      primaryProject: primaryProject
        ? {
            ...primaryProject,
            directoryPath,
            contextHints,
          }
        : null,
      syncedAt: new Date().toISOString(),
    };
  };

  const hashPath = async (value: string): Promise<string> => {
    const bytes = new TextEncoder().encode(value.trim().toLowerCase());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const verifyAgentHostApiKey = async (id: number, key?: string) => {
    if (!key) return null;
    return agentHostService.verifyApiKey(id, key);
  };

  /**
   * Extract the agentHost API key from the request.
   * Prefers the Authorization: Bearer header; falls back to the legacy ?key= query
   * parameter so existing agentHosts continue working during the migration window.
   */
  const extractAgentHostKey = (c: Context<AgentHostHonoEnv>): string | undefined =>
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ??
    c.req.query('key');

  /**
   * Extract the source agentHost ID for endpoints that identify the caller.
   * Prefers the X-AgentHost-From header; falls back to the legacy ?from= query param.
   */
  const extractFromId = (c: Context<AgentHostHonoEnv>): number => {
    const raw = c.req.header('X-AgentHost-From') ?? c.req.query('from') ?? '';
    return Number(raw);
  };

  /**
   * Verify an HMAC-SHA256 payload signature sent as X-AgentHost-Signature: sha256=<hex>.
   * Uses the Web Crypto API (available in Cloudflare Workers).
   * Returns true if the signature is absent (backward compat) or matches.
   * Returns false only when a signature is present but invalid.
   */
  const verifyAgentHostSignature = async (
    rawKey: string,
    body: string,
    sigHeader: string | undefined,
  ): Promise<boolean> => {
    if (!sigHeader) return true; // no signature sent — skip verification (backward compat)
    if (!sigHeader.startsWith('sha256=')) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(rawKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `sha256=${hex}` === sigHeader;
  };

  // GET /api/agent-hosts/fleet?from=<agentHostId>&key=<apiKey>
  // AgentHost-authenticated endpoint: returns all agentHosts in the same tenant.
  // Used by the agent_host_fleet agent tool for peer discovery without a user JWT.
  // NOTE: registered before /:id routes so "/fleet" is not captured by the param.
  router.get('/fleet', async (c) => {
    const fromId = extractFromId(c);
    const key    = extractAgentHostKey(c);

    if (Number.isNaN(fromId) || fromId <= 0) {
      return c.json({ error: 'from parameter or X-AgentHost-From header (source agentHost id) is required' }, 400);
    }

    const sourceAgentHost = await verifyAgentHostApiKey(fromId, key);
    if (!sourceAgentHost) return c.text('Unauthorized', 401);

    const agentHosts = await agentHostService.listAgentHostsForTenant(Number(sourceAgentHost.tenantId));
    const fleet = agentHosts.map((agentHost) => ({
      id:                   agentHost.id,
      name:                 agentHost.name,
      slug:                 agentHost.slug,
      online:               isAgentHostOnline(agentHost),
      connectedAt:          agentHost.connectedAt,
      lastSeenAt:           agentHost.lastSeenAt,
      capabilities:         agentHost.capabilities ?? [],
      declaredCapabilities: agentHost.declaredCapabilities ?? [],
    }));

    return c.json({ fleet });
  });

  // GET /api/agent-hosts/fleet/route?requires=<cap1,cap2>&token=<jwt>
  // P2-3: Capability routing — returns the best-matching online agentHost for the
  // given required capabilities (tenant JWT auth).
  // NOTE: registered before /:id routes so "/fleet/route" is not captured.
  router.get('/fleet/route', authMiddleware as never, async (c) => {
    const requires = (c.req.query('requires') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const tenantId = (c as unknown as { get: (k: string) => unknown }).get('tenantId') as number;

    const agentHosts = await agentHostService.listAgentHostsForTenant(tenantId);

    const score = (agentHost: (typeof agentHosts)[number]): number => {
      const caps = new Set([
        ...(agentHost.capabilities ?? []),
        ...(agentHost.declaredCapabilities ?? []),
      ]);
      const online = isAgentHostOnline(agentHost) ? 1 : 0;
      const matched = requires.filter((r) => caps.has(r)).length;
      const total = requires.length || 1;
      return online * 0.5 + (matched / total) * 0.5;
    };

    const scored = agentHosts.map((agentHost) => ({ agentHost, score: score(agentHost) })).sort((a, b) => b.score - a.score);

    if (scored.length === 0) return c.json({ error: 'No agentHosts available' }, 404);

    const best = scored[0]!.agentHost;
    return c.json({
      agentHostId: best.id,
      name:   best.name,
      score:  Math.round(score(best) * 100) / 100,
      online: isAgentHostOnline(best),
    });
  });

  // GET /api/agent-hosts – list all agentHosts for the current tenant
  // Optional query params:
  //  - status=online  (only agentHosts with connectedAt NOT NULL)
  //  - status=offline (only agentHosts with connectedAt NULL)
  router.get('/', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const status = (c.req.query('status') ?? '').toString().trim().toLowerCase();

    const filterStatus = status === 'online' || status === 'offline' ? status : null;
    const agentHosts = await agentHostService.listAgentHostsForTenant(tenantId, filterStatus);

    const rows = agentHosts.map((agentHost) => ({
      id: agentHost.id,
      name: agentHost.name,
      slug: agentHost.slug,
      status: agentHost.status,
      // Canonical liveness — connectedAt alone is unreliable (stuck-online bug).
      online: isAgentHostOnline(agentHost),
      connectedAt: agentHost.connectedAt,
      lastSeenAt: agentHost.lastSeenAt,
      createdAt: agentHost.createdAt,
    }));

    return c.json({ agentHosts: rows });
  });

  // POST /api/agent-hosts – register a new BuilderForce Agents instance
  // Returns the plaintext API key once – it is never stored in plaintext.
  router.post('/', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const body     = await c.req.json<{ name: string; machineProfile?: AgentHostMachineProfileInput }>();

    if (!body.name?.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }

    const guard = buildPlanLimitsGuard(db, c.env as Env);
    const limitErr = await guard.checkAgentHostLimit(tenantId);
    if (limitErr) return c.json(limitErr, 402);

    const slug    = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    // BuilderForce Agent key. Legacy already-issued `clk_*` keys still authenticate
    // (see llmRoutes + HashService), but new agents are minted as `bfa_*`.
    const rawKey  = generateApiKey('bfa');
    const keyHash = await hashSecret(rawKey);
    const machineProfile = normalizeMachineProfile(body.machineProfile);

    const [inserted] = await db
      .insert(agentHosts)
      .values({
        tenantId,
        name:         body.name.trim(),
        slug,
        apiKeyHash:   keyHash,
        registeredBy: userId,
        ...(machineProfile?.machineName ? { machineName: machineProfile.machineName } : {}),
        ...(machineProfile?.machineIp ? { machineIp: machineProfile.machineIp } : {}),
        ...(machineProfile?.rootInstallDirectory ? { rootInstallDirectory: machineProfile.rootInstallDirectory } : {}),
        ...(machineProfile?.workspaceDirectory ? { workspaceDirectory: machineProfile.workspaceDirectory } : {}),
        ...(machineProfile?.gatewayPort != null ? { gatewayPort: machineProfile.gatewayPort } : {}),
        ...(machineProfile?.relayPort != null ? { relayPort: machineProfile.relayPort } : {}),
        ...(machineProfile?.tunnelUrl ? { tunnelUrl: machineProfile.tunnelUrl } : {}),
        ...(machineProfile?.tunnelStatus ? { tunnelStatus: machineProfile.tunnelStatus } : {}),
        ...(machineProfile?.networkMetadata ? { networkMetadata: JSON.stringify(machineProfile.networkMetadata) } : {}),
      })
      .returning({
        id:        agentHosts.id,
        name:      agentHosts.name,
        slug:      agentHosts.slug,
        status:    agentHosts.status,
        createdAt: agentHosts.createdAt,
      });

    if (!inserted) {
      return c.json({ error: 'Failed to register agentHost' }, 500);
    }

    await db
      .update(tenants)
      .set({
        defaultAgentHostId: inserted.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenants.id, tenantId),
          isNull(tenants.defaultAgentHostId),
        ),
      );

    return c.json({
      agentHost:   inserted,
      apiKey: rawKey,
      note:   'Save this API key — it will not be shown again. Paste it into your BuilderForce Agents config.',
    }, 201);
  });

  // DELETE /api/agent-hosts/:id – deactivate / remove a agentHost
  router.delete('/:id', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id       = Number(c.req.param('id'));
    const [deleted] = await db
      .delete(agentHosts)
      .where(and(eq(agentHosts.id, id), eq(agentHosts.tenantId, tenantId)))
      .returning({ apiKeyHash: agentHosts.apiKeyHash });
    // Cache lives 365 days; explicit invalidation is what makes deletion take effect.
    // (Raw delete — not routed through the repo/service, so it invalidates here.)
    if (deleted) await invalidateAgentHostKeyCache(c.env, deleted.apiKeyHash);
    return c.body(null, 204);
  });

  // PATCH /api/agent-hosts/:id/status – lifecycle status transition (manager+)
  router.patch('/:id/status', authMiddleware as never, requireRole(TenantRole.MANAGER) as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));
    const body = await c.req.json<{ status?: 'active' | 'inactive' | 'suspended' }>();

    if (!body.status || !['active', 'inactive', 'suspended'].includes(body.status)) {
      return c.json({ error: 'status must be one of: active, inactive, suspended' }, 400);
    }

    // setStatus self-invalidates the long-TTL clk_* auth cache at the mutation,
    // so the deactivated key stops working immediately without a route-level call.
    const updated = await agentHostService.setStatus(agentHostId, tenantId, body.status, c.env);
    if (!updated) return c.json({ error: 'AgentHost not found' }, 404);

    // Non-active agentHosts should not appear as connected.
    if (body.status !== 'active') {
      await db
        .update(agentHosts)
        .set({ connectedAt: null })
        .where(and(eq(agentHosts.id, agentHostId), eq(agentHosts.tenantId, tenantId)));
    }

    return c.json({
      agentHost: {
        id: updated.id,
        tenantId: updated.tenantId,
        name: updated.name,
        slug: updated.slug,
        status: body.status,
        connectedAt: body.status === 'active' ? updated.connectedAt : null,
        lastSeenAt: updated.lastSeenAt,
        createdAt: updated.createdAt,
      },
    });
  });

  // PATCH /api/agent-hosts/:id/limits – set per-agentHost token budget (manager+)
  // Allows managers to cap individual AgentHost token spend per day.
  // Set tokenDailyLimit to null to remove the per-agentHost cap (plan-level limit applies).
  router.patch('/:id/limits', authMiddleware as never, requireRole(TenantRole.MANAGER) as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));
    const body = await c.req.json<{ tokenDailyLimit?: number | null }>();

    const limit = body.tokenDailyLimit === undefined ? undefined : body.tokenDailyLimit;
    if (limit !== null && limit !== undefined && (typeof limit !== 'number' || limit < 0 || !Number.isInteger(limit))) {
      return c.json({ error: 'tokenDailyLimit must be a non-negative integer or null' }, 400);
    }

    const [updated] = await db
      .update(agentHosts)
      .set({
        tokenDailyLimit: limit === undefined ? undefined : limit,
        updatedAt: new Date(),
      })
      .where(and(eq(agentHosts.id, agentHostId), eq(agentHosts.tenantId, tenantId)))
      .returning({
        id:              agentHosts.id,
        tokenDailyLimit: agentHosts.tokenDailyLimit,
        apiKeyHash:      agentHosts.apiKeyHash,
      });

    if (!updated) return c.json({ error: 'AgentHost not found' }, 404);

    // tokenDailyLimit is part of the cached value — invalidate so the new cap
    // takes effect on the very next request rather than waiting for TTL.
    // (Raw update — not routed through the repo/service, so it invalidates here.)
    await invalidateAgentHostKeyCache(c.env, updated.apiKeyHash);

    return c.json({ agentHostId: updated.id, tokenDailyLimit: updated.tokenDailyLimit });
  });

  // GET /api/agent-hosts/:id/projects – list projects associated with this agentHost
  router.get('/:id/projects', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const rows = await db
      .select({
        id: projects.id,
        key: projects.key,
        name: projects.name,
        description: projects.description,
        status: projects.status,
        createdAt: projects.createdAt,
      })
      .from(agentHostProjects)
      .innerJoin(projects, eq(projects.id, agentHostProjects.projectId))
      .where(
        and(
          eq(agentHostProjects.tenantId, tenantId),
          eq(agentHostProjects.agentHostId, id),
        ),
      );

    return c.json({ projects: rows });
  });

  // GET /api/agent-hosts/:id/nodes – list paired nodes for a agentHost
  // Current implementation models one primary node (the agentHost instance itself).
  router.get('/:id/nodes', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));

    const [agentHost] = await db
      .select({
        id: agentHosts.id,
        name: agentHosts.name,
        connectedAt: agentHosts.connectedAt,
        lastSeenAt: agentHosts.lastSeenAt,
      })
      .from(agentHosts)
      .where(
        and(
          eq(agentHosts.id, agentHostId),
          eq(agentHosts.tenantId, tenantId),
        ),
      );

    if (!agentHost) return c.json([], 200);

    return c.json([
      {
        id: String(agentHost.id),
        name: agentHost.name,
        capabilities: ['chat', 'tasks', 'relay'],
        connectedAt: agentHost.connectedAt,
        lastSeenAt: agentHost.lastSeenAt,
        status: isAgentHostOnline(agentHost) ? 'connected' : 'disconnected',
      },
    ]);
  });

  // DELETE /api/agent-hosts/:id/nodes/:nodeId – unpair a node
  // For now, unpairing primary node marks agentHost as inactive/disconnected.
  router.delete('/:id/nodes/:nodeId', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));
    const nodeId = Number(c.req.param('nodeId'));

    if (Number.isNaN(agentHostId) || Number.isNaN(nodeId) || agentHostId !== nodeId) {
      return c.json({ error: 'Node not found' }, 404);
    }

    // deactivate() self-invalidates the long-TTL clk_* auth cache at the mutation.
    await agentHostService.deactivate(agentHostId, tenantId, c.env);
    await db
      .update(agentHosts)
      .set({
        connectedAt: null,
      })
      .where(
        and(
          eq(agentHosts.id, agentHostId),
          eq(agentHosts.tenantId, tenantId),
        ),
      );

    return c.body(null, 204);
  });

  // PUT /api/agent-hosts/:id/projects/:projectId – associate project with agentHost
  router.put('/:id/projects/:projectId', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));
    const projectId = Number(c.req.param('projectId'));

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
    if (!project) return c.json({ error: 'Project not found in tenant' }, 404);

    await db
      .insert(agentHostProjects)
      .values({ tenantId, agentHostId, projectId, role: 'default' })
      .onConflictDoUpdate({
        target: [agentHostProjects.tenantId, agentHostProjects.agentHostId, agentHostProjects.projectId],
        set: { updatedAt: new Date() },
      });

    const assignmentContext = await buildAssignmentContext(agentHostId, tenantId, projectId);
    return c.json({ ok: true, assignmentContext });
  });

  // GET /api/agent-hosts/:id/assignment-context – agentHost-authenticated assignment and context handshake payload
  router.get('/:id/assignment-context', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key = extractAgentHostKey(c);
    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const assignmentContext = await buildAssignmentContext(agentHostId, Number(agentHost.tenantId));
    if (!assignmentContext) {
      return c.json({ error: 'AgentHost not found' }, 404);
    }

    return c.json(assignmentContext);
  });

  // DELETE /api/agent-hosts/:id/projects/:projectId – unassociate project from agentHost
  router.delete('/:id/projects/:projectId', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));
    const projectId = Number(c.req.param('projectId'));

    await db
      .delete(agentHostProjects)
      .where(
        and(
          eq(agentHostProjects.tenantId, tenantId),
          eq(agentHostProjects.agentHostId, agentHostId),
          eq(agentHostProjects.projectId, projectId),
        ),
      );

    return c.body(null, 204);
  });

  // GET /api/agent-hosts/:id/directories – list synced directory manifest entries
  router.get('/:id/directories', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));

    const rows = await db
      .select({
        id: agentHostDirectories.id,
        projectId: agentHostDirectories.projectId,
        absPath: agentHostDirectories.absPath,
        status: agentHostDirectories.status,
        errorMessage: agentHostDirectories.errorMessage,
        metadata: agentHostDirectories.metadata,
        lastSeenAt: agentHostDirectories.lastSeenAt,
        lastSyncedAt: agentHostDirectories.lastSyncedAt,
        updatedAt: agentHostDirectories.updatedAt,
      })
      .from(agentHostDirectories)
      .where(
        and(
          eq(agentHostDirectories.tenantId, tenantId),
          eq(agentHostDirectories.agentHostId, agentHostId),
        ),
      );

    return c.json({ directories: rows });
  });

  // GET /api/agent-hosts/:id/directories/:directoryId/files – list synced files
  router.get('/:id/directories/:directoryId/files', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));
    const directoryId = Number(c.req.param('directoryId'));

    const files = await db
      .select({
        relPath: agentHostDirectoryFiles.relPath,
        contentHash: agentHostDirectoryFiles.contentHash,
        sizeBytes: agentHostDirectoryFiles.sizeBytes,
        updatedAt: agentHostDirectoryFiles.updatedAt,
      })
      .from(agentHostDirectoryFiles)
      .where(
        and(
          eq(agentHostDirectoryFiles.tenantId, tenantId),
          eq(agentHostDirectoryFiles.agentHostId, agentHostId),
          eq(agentHostDirectoryFiles.directoryId, directoryId),
        ),
      );

    return c.json({ files });
  });

  // GET /api/agent-hosts/:id/directories/:directoryId/files/content?path=...
  router.get('/:id/directories/:directoryId/files/content', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));
    const directoryId = Number(c.req.param('directoryId'));
    const relPath = c.req.query('path')?.trim();
    if (!relPath) return c.json({ error: 'path is required' }, 400);

    const [file] = await db
      .select({
        relPath: agentHostDirectoryFiles.relPath,
        content: agentHostDirectoryFiles.content,
        contentHash: agentHostDirectoryFiles.contentHash,
        updatedAt: agentHostDirectoryFiles.updatedAt,
      })
      .from(agentHostDirectoryFiles)
      .where(
        and(
          eq(agentHostDirectoryFiles.tenantId, tenantId),
          eq(agentHostDirectoryFiles.agentHostId, agentHostId),
          eq(agentHostDirectoryFiles.directoryId, directoryId),
          eq(agentHostDirectoryFiles.relPath, relPath),
        ),
      );

    if (!file) return c.json({ error: 'File not found' }, 404);
    return c.json(file);
  });

  // PUT /api/agent-hosts/:id/directories/sync – startup/full/delta sync from local gateway
  // Authentication: API key via ?key= query param.
  router.put('/:id/directories/sync', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key = extractAgentHostKey(c);
    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      projectId?: number | null;
      absPath: string;
      status?: 'pending' | 'synced' | 'error';
      metadata?: Record<string, unknown>;
      errorMessage?: string | null;
      files?: Array<{
        relPath: string;
        contentHash?: string;
        sizeBytes?: number;
        content?: string;
      }>;
    }>();

    const absPath = body.absPath?.trim();
    if (!absPath) return c.json({ error: 'absPath is required' }, 400);

    if (body.projectId != null) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, body.projectId), eq(projects.tenantId, agentHost.tenantId)))
        .limit(1);

      if (!project) {
        return c.json({ error: 'project not found in tenant' }, 404);
      }

      const [projectMapping] = await db
        .select({ agentHostId: agentHostProjects.agentHostId })
        .from(agentHostProjects)
        .where(and(
          eq(agentHostProjects.tenantId, agentHost.tenantId),
          eq(agentHostProjects.agentHostId, agentHostId),
          eq(agentHostProjects.projectId, body.projectId),
        ))
        .limit(1);

      if (!projectMapping) {
        const [tenant] = await db
          .select({ defaultAgentHostId: tenants.defaultAgentHostId })
          .from(tenants)
          .where(eq(tenants.id, agentHost.tenantId))
          .limit(1);

        if (tenant?.defaultAgentHostId !== agentHostId) {
          return c.json({
            ok: true,
            skipped: true,
            reason: 'project_wip_no_project_or_default_agent_host_assignment',
          }, 202);
        }
      }
    }

    const pathHash = await hashPath(absPath);
    const [directory] = await db
      .insert(agentHostDirectories)
      .values({
        tenantId: agentHost.tenantId,
        agentHostId,
        projectId: body.projectId ?? null,
        absPath,
        pathHash,
        status: body.status ?? 'pending',
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        errorMessage: body.errorMessage ?? null,
        lastSeenAt: new Date(),
        lastSyncedAt: body.status === 'synced' ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [agentHostDirectories.tenantId, agentHostDirectories.agentHostId, agentHostDirectories.pathHash],
        set: {
          projectId: body.projectId ?? null,
          absPath,
          status: body.status ?? 'pending',
          metadata: body.metadata ? JSON.stringify(body.metadata) : null,
          errorMessage: body.errorMessage ?? null,
          lastSeenAt: new Date(),
          lastSyncedAt: body.status === 'synced' ? new Date() : agentHostDirectories.lastSyncedAt,
          updatedAt: new Date(),
        },
      })
      .returning({ id: agentHostDirectories.id });

    if (!directory) {
      return c.json({ error: 'Unable to persist directory manifest entry' }, 500);
    }

    if (body.files?.length) {
      const fileRows = body.files
        .filter((file) => file.relPath?.trim())
        .map((file) => ({
          tenantId: agentHost.tenantId,
          agentHostId,
          directoryId: directory.id,
          relPath: file.relPath,
          contentHash: file.contentHash ?? '',
          sizeBytes: file.sizeBytes ?? (file.content ? file.content.length : 0),
          content: file.content ?? null,
          updatedAt: new Date(),
        }));

      for (const row of fileRows) {
        await db
          .insert(agentHostDirectoryFiles)
          .values(row)
          .onConflictDoUpdate({
            target: [agentHostDirectoryFiles.directoryId, agentHostDirectoryFiles.relPath],
            set: {
              contentHash: row.contentHash,
              sizeBytes: row.sizeBytes,
              content: row.content,
              updatedAt: row.updatedAt,
            },
          });
      }
    }

    // Record sync history entry
    const triggeredBy = (body.metadata as Record<string, string> | undefined)?.triggeredBy ?? 'startup';
    const fileCount = body.files?.length ?? 0;
    const bytesTotal = body.files?.reduce((sum, f) => sum + (f.sizeBytes ?? (f.content?.length ?? 0)), 0) ?? 0;
    await db.insert(agentHostSyncHistory).values({
      tenantId: agentHost.tenantId,
      agentHostId,
      directoryId: directory.id,
      triggeredBy,
      fileCount,
      bytesTotal,
      status: 'success',
    });

    return c.json({ ok: true, directoryId: directory.id });
  });

  // GET /api/agent-hosts/:id/sync-history – recent sync history (JWT auth)
  router.get('/:id/sync-history', authMiddleware as never, async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const tenantId = (c as unknown as { get: (k: string) => unknown }).get('tenantId') as number;

    const rows = await db
      .select({
        id:          agentHostSyncHistory.id,
        triggeredBy: agentHostSyncHistory.triggeredBy,
        fileCount:   agentHostSyncHistory.fileCount,
        bytesTotal:  agentHostSyncHistory.bytesTotal,
        status:      agentHostSyncHistory.status,
        errorMsg:    agentHostSyncHistory.errorMsg,
        createdAt:   agentHostSyncHistory.createdAt,
      })
      .from(agentHostSyncHistory)
      .where(and(
        eq(agentHostSyncHistory.agentHostId, agentHostId),
        eq(agentHostSyncHistory.tenantId, tenantId),
      ))
      .orderBy(desc(agentHostSyncHistory.createdAt))
      .limit(20);

    return c.json({ history: rows });
  });

  // GET /api/agent-hosts/:id/executions – history of executions run by this agentHost
  router.get('/:id/executions', authMiddleware as never, async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const tenantId = c.get('tenantId') as number;
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

    // Ensure the agentHost belongs to this tenant
    const agentHost = await agentHostService.getAgentHostForTenant(agentHostId, tenantId);
    if (!agentHost) return c.json({ error: 'AgentHost not found' }, 404);

    const rows = await db
      .select({
        id:          executions.id,
        taskId:      executions.taskId,
        agentId:     executions.agentId,
        agentHostId:      executions.agentHostId,
        tenantId:    executions.tenantId,
        submittedBy: executions.submittedBy,
        sessionId:   executions.sessionId,
        status:      executions.status,
        payload:     executions.payload,
        result:      executions.result,
        errorMessage: executions.errorMessage,
        startedAt:   executions.startedAt,
        completedAt: executions.completedAt,
        createdAt:   executions.createdAt,
        updatedAt:   executions.updatedAt,
      })
      .from(executions)
      .where(and(eq(executions.agentHostId, agentHostId), eq(executions.tenantId, tenantId)))
      .orderBy(desc(executions.createdAt))
      .limit(limit);

    return c.json({ agentHostId, executions: rows });
  });

  // GET /api/agent-hosts/:id/skills – merged skill assignments (tenant + agentHost)
  // Accepts agentHost API key (Bearer or ?key=) OR tenant JWT.
  router.get('/:id/skills', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    let tenantId: number;

    const agentHostFromKey = await verifyAgentHostApiKey(agentHostId, extractAgentHostKey(c));
    if (agentHostFromKey) {
      tenantId = agentHostFromKey.tenantId;
    } else {
      await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
    }

    // Ensure agentHost belongs to this tenant
    const agentHost = await agentHostService.getAgentHostForTenant(agentHostId, tenantId);
    if (!agentHost) return c.json({ error: 'AgentHost not found' }, 404);

    const tenantSkills = await db
      .select({
        skillSlug:  tenantSkillAssignments.skillSlug,
        assignedBy: tenantSkillAssignments.assignedBy,
        assignedAt: tenantSkillAssignments.assignedAt,
        skillName:  marketplaceSkills.name,
        skillDesc:  marketplaceSkills.description,
        skillIcon:  marketplaceSkills.iconUrl,
        skillVer:   marketplaceSkills.version,
      })
      .from(tenantSkillAssignments)
      .leftJoin(marketplaceSkills, eq(tenantSkillAssignments.skillSlug, marketplaceSkills.slug))
      .where(eq(tenantSkillAssignments.tenantId, tenantId));

    const agentHostSkills = await db
      .select({
        skillSlug:  agentHostSkillAssignments.skillSlug,
        assignedBy: agentHostSkillAssignments.assignedBy,
        assignedAt: agentHostSkillAssignments.assignedAt,
        skillName:  marketplaceSkills.name,
        skillDesc:  marketplaceSkills.description,
        skillIcon:  marketplaceSkills.iconUrl,
        skillVer:   marketplaceSkills.version,
      })
      .from(agentHostSkillAssignments)
      .leftJoin(marketplaceSkills, eq(agentHostSkillAssignments.skillSlug, marketplaceSkills.slug))
      .where(eq(agentHostSkillAssignments.agentHostId, agentHostId));

    const merged = new Map<string, Record<string, unknown>>();
    tenantSkills.forEach((row) => merged.set(row.skillSlug, { ...row, source: 'tenant' }));
    agentHostSkills.forEach((row) => merged.set(row.skillSlug, { ...row, source: 'host' }));

    const skills = Array.from(merged.values()).map((row) => ({
      skill_id: row.skillSlug,
      name: row.skillName ?? row.skillSlug,
      description: row.skillDesc ?? null,
      metadata: {
        iconUrl: row.skillIcon ?? null,
        version: row.skillVer ?? null,
        source: row.source,
      },
    }));

    return c.json({ agentHostId, skills });
  });

  // GET /api/agent-hosts/:id/sessions – list chat sessions for this agentHost
  router.get('/:id/sessions', authMiddleware as never, async (c) => {
    const agentHostId  = Number(c.req.param('id'));
    const tenantId = c.get('tenantId') as number;
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);

    const rows = await db
      .select({
        id:         chatSessions.id,
        sessionKey: chatSessions.sessionKey,
        startedAt:  chatSessions.startedAt,
        endedAt:    chatSessions.endedAt,
        msgCount:   chatSessions.msgCount,
        lastMsgAt:  chatSessions.lastMsgAt,
      })
      .from(chatSessions)
      .where(and(
        eq(chatSessions.agentHostId, agentHostId),
        eq(chatSessions.tenantId, tenantId),
      ))
      .orderBy(desc(chatSessions.lastMsgAt))
      .limit(limit);

    return c.json({ sessions: rows });
  });

  // GET /api/agent-hosts/:id/cron – list cron jobs for this agentHost
  // Accepts agentHost API key (Bearer or ?key=) OR tenant JWT.
  router.get('/:id/cron', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    let tenantId: number;

    const agentHostFromKey = await verifyAgentHostApiKey(agentHostId, extractAgentHostKey(c));
    if (agentHostFromKey) {
      tenantId = agentHostFromKey.tenantId;
    } else {
      await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
    }

    const projectIdParam = c.req.query('projectId');
    // projectAgentId: a numeric id → that attached agent's schedules; 'none' →
    // project-wide schedules only (NULL); absent → no agent filter (all).
    const projectAgentIdParam = c.req.query('projectAgentId');

    const conditions = [eq(cronJobs.tenantId, tenantId), eq(cronJobs.agentHostId, agentHostId)];
    if (projectIdParam) conditions.push(eq(cronJobs.projectId, Number(projectIdParam)));
    if (projectAgentIdParam === 'none') conditions.push(isNull(cronJobs.projectAgentId));
    else if (projectAgentIdParam) conditions.push(eq(cronJobs.projectAgentId, Number(projectAgentIdParam)));

    const rows = await db
      .select()
      .from(cronJobs)
      .where(and(...conditions))
      .orderBy(desc(cronJobs.createdAt));
    return c.json({ jobs: rows });
  });

  // POST /api/agent-hosts/:id/cron – create a cron job
  router.post('/:id/cron', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId   = Number(c.req.param('id'));
    const body = await c.req.json<{
      id?: string;
      name: string;
      schedule: string;
      taskId?: number | null;
      projectId?: number | null;
      projectAgentId?: number | null;
      enabled?: boolean;
    }>();
    if (!body.name?.trim() || !body.schedule?.trim()) {
      return c.json({ error: 'name and schedule are required' }, 400);
    }
    const insertData = {
      tenantId,
      agentHostId,
      name: body.name.trim(),
      schedule: body.schedule.trim(),
      taskId: body.taskId ?? null,
      projectId: body.projectId ?? null,
      projectAgentId: body.projectAgentId ?? null,
      enabled: body.enabled ?? true,
      ...(body.id ? { id: body.id } : {}),
    };

    const [inserted] = await db.insert(cronJobs).values(insertData).returning();
    return c.json(inserted, 201);
  });

  // PATCH /api/agent-hosts/:id/cron/:jobId – update a cron job
  // Accepts agentHost API key (Bearer or ?key=) OR tenant JWT so the cron poller
  // can patch lastRunAt / lastStatus after each job fires.
  router.patch('/:id/cron/:jobId', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    let tenantId: number;

    const agentHostFromKey = await verifyAgentHostApiKey(agentHostId, extractAgentHostKey(c));
    if (agentHostFromKey) {
      tenantId = agentHostFromKey.tenantId;
    } else {
      await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
    }
    const jobId    = c.req.param('jobId');
    const body = await c.req.json<{
      name?: string;
      schedule?: string;
      taskId?: number | null;
      projectId?: number | null;
      enabled?: boolean;
      lastRunAt?: string;
      nextRunAt?: string;
      lastStatus?: string;
    }>();

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name != null)       updates.name = body.name.trim();
    if (body.schedule != null)   updates.schedule = body.schedule.trim();
    if (body.taskId !== undefined)   updates.taskId = body.taskId;
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.lastRunAt != null)  updates.lastRunAt = new Date(body.lastRunAt);
    if (body.nextRunAt != null)  updates.nextRunAt = new Date(body.nextRunAt);
    if (body.lastStatus != null) updates.lastStatus = body.lastStatus;

    const [updated] = await db
      .update(cronJobs)
      .set(updates)
      .where(and(eq(cronJobs.id, jobId), eq(cronJobs.tenantId, tenantId), eq(cronJobs.agentHostId, agentHostId)))
      .returning();
    if (!updated) return c.json({ error: 'Not found' }, 404);
    return c.json(updated);
  });

  // DELETE /api/agent-hosts/:id/cron/:jobId – delete a cron job
  router.delete('/:id/cron/:jobId', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId   = Number(c.req.param('id'));
    const jobId    = c.req.param('jobId');
    await db.delete(cronJobs).where(and(eq(cronJobs.id, jobId), eq(cronJobs.tenantId, tenantId), eq(cronJobs.agentHostId, agentHostId)));
    return c.body(null, 204);
  });

  // GET /api/agent-hosts/:id/channels – list connected channels for this agentHost (stub)
  router.get('/:id/channels', authMiddleware as never, async (c) => {
    return c.json({ channels: [] });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/agent-hosts/:id/capabilities – update declared capabilities (SPA)
  // P2-3: Allows portal users to configure desired capabilities per agentHost.
  // -------------------------------------------------------------------------
  router.patch('/:id/capabilities', authMiddleware as never, async (c) => {
    const tenantId = (c as unknown as { get: (k: string) => unknown }).get('tenantId') as number;
    const agentHostId = Number(c.req.param('id'));

    const body = await c.req.json<{ declaredCapabilities: string[] }>();
    if (!Array.isArray(body.declaredCapabilities)) {
      return c.json({ error: 'declaredCapabilities must be an array' }, 400);
    }

    const caps = body.declaredCapabilities.filter((v) => typeof v === 'string');
    await db
      .update(agentHosts)
      .set({ declaredCapabilities: JSON.stringify(caps) })
      .where(and(eq(agentHosts.id, agentHostId), eq(agentHosts.tenantId, tenantId)));

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/agent-hosts/:id/heartbeat – agentHost keepalive, updates lastSeenAt
  // Called periodically by AgentHostLinkRelayService via HTTP alongside the WS.
  // Authentication: API key via ?key= query param (same as upstream WS).
  // -------------------------------------------------------------------------
  router.patch('/:id/heartbeat', async (c) => {
    const id  = Number(c.req.param('id'));
    const key = extractAgentHostKey(c);

    const agentHost = await verifyAgentHostApiKey(id, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    // Accept optional capabilities array from request body
    let capabilitiesJson: string | undefined;
    let machineProfile: AgentHostMachineProfileInput | null = null;
    try {
      const body = await c.req.json<{ capabilities?: string[]; machineProfile?: AgentHostMachineProfileInput }>();
      if (Array.isArray(body.capabilities)) {
        const caps = body.capabilities.filter((v) => typeof v === 'string');
        capabilitiesJson = JSON.stringify(caps);
      }
      machineProfile = normalizeMachineProfile(body.machineProfile);
    } catch { /* body may be empty — fine */ }

    await db
      .update(agentHosts)
      .set({
        lastSeenAt:   new Date(),
        ...(capabilitiesJson !== undefined ? { capabilities: capabilitiesJson } : {}),
        ...(machineProfile?.machineName ? { machineName: machineProfile.machineName } : {}),
        ...(machineProfile?.machineIp ? { machineIp: machineProfile.machineIp } : {}),
        ...(machineProfile?.rootInstallDirectory ? { rootInstallDirectory: machineProfile.rootInstallDirectory } : {}),
        ...(machineProfile?.workspaceDirectory ? { workspaceDirectory: machineProfile.workspaceDirectory } : {}),
        ...(machineProfile?.gatewayPort != null ? { gatewayPort: machineProfile.gatewayPort } : {}),
        ...(machineProfile?.relayPort != null ? { relayPort: machineProfile.relayPort } : {}),
        ...(machineProfile?.tunnelUrl ? { tunnelUrl: machineProfile.tunnelUrl } : {}),
        ...(machineProfile?.tunnelStatus ? { tunnelStatus: machineProfile.tunnelStatus } : {}),
        ...(machineProfile?.networkMetadata ? { networkMetadata: JSON.stringify(machineProfile.networkMetadata) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(agentHosts.id, id));

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/status – connection status (no auth required for polling)
  // -------------------------------------------------------------------------
  router.get('/:id/status', async (c) => {
    const id = Number(c.req.param('id'));
    const [row] = await db
      .select({ connectedAt: agentHosts.connectedAt, lastSeenAt: agentHosts.lastSeenAt })
      .from(agentHosts)
      .where(eq(agentHosts.id, id));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ connected: isAgentHostOnline(row), connectedAt: row.connectedAt });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/ws – browser client connects to agentHost relay
  // Requires tenant JWT (passed via ?token= since WS upgrades can't set headers
  // in all browsers)
  // -------------------------------------------------------------------------
  router.get('/:id/ws', async (c) => {
    const id  = Number(c.req.param('id'));
    const env = c.env;

    if (!env.AGENT_HOST_RELAY) return c.text('AGENT_HOST_RELAY binding not configured', 503);

    // The browser connects via WebSocket and cannot reliably set Authorization headers,
    // so we accept the JWT via ?token= as used by the UI.
    const token = c.req.header('Authorization')?.startsWith('Bearer ')
      ? c.req.header('Authorization')?.slice(7)
      : c.req.query('token');
    if (!token) return c.text('Unauthorized', 401);

    // Verify tenant JWT and ensure it matches the agentHost's tenant.
    let payload;
    try {
      payload = await verifyJwt(token, c.env.JWT_SECRET);
    } catch {
      return c.text('Unauthorized', 401);
    }

    const [agentHost] = await db
      .select({ id: agentHosts.id, tenantId: agentHosts.tenantId })
      .from(agentHosts)
      .where(eq(agentHosts.id, id));
    if (!agentHost) return c.text('Not found', 404);
    if (payload.tid !== agentHost.tenantId) return c.text('Unauthorized', 401);

    const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(id)));
    const url  = new URL(c.req.url);
    url.searchParams.set('role', 'client');
    return stub.fetch(new Request(url.toString(), c.req.raw));
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/upstream – BuilderForce Agents instance connects (API key auth)
  // Accepts Authorization: Bearer <key> header (preferred) or legacy ?key= param.
  // -------------------------------------------------------------------------
  router.get('/:id/upstream', async (c) => {
    const id  = Number(c.req.param('id'));
    const env = c.env;
    const key = extractAgentHostKey(c);

    if (!env.AGENT_HOST_RELAY) return c.text('AGENT_HOST_RELAY binding not configured', 503);
    if (!key) return c.text('Unauthorized', 401);

    const agentHost = await verifyAgentHostApiKey(id, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    // Mark as connected
    await db
      .update(agentHosts)
      .set({ connectedAt: new Date(), lastSeenAt: new Date() })
      .where(eq(agentHosts.id, id));

    const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(id)));
    const url  = new URL(c.req.url);
    url.searchParams.set('role', 'upstream');
    // Strip the legacy ?key= from the DO URL and pass auth via header so the
    // API key is never logged in relay access logs.
    url.searchParams.delete('key');
    const doHeaders = new Headers(c.req.raw.headers);
    doHeaders.set('Authorization', `Bearer ${key}`);
    const response = await stub.fetch(new Request(url.toString(), { ...c.req.raw, headers: doHeaders }));

    // When the WS closes, mark as disconnected (best-effort)
    response.webSocket?.addEventListener('close', async () => {
      await db
        .update(agentHosts)
        .set({ connectedAt: null })
        .where(eq(agentHosts.id, id));
    });

    return response;
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-hosts/:id/forward?from=<sourceAgentHostId>&key=<sourceAgentHostApiKey>
  // AgentHost-to-agentHost task delegation: source agentHost dispatches a payload to target
  // agentHost via the AgentHostRelayDO dispatch mechanism.
  // The source agentHost authenticates with its OWN API key (not the target's key).
  // Both agentHosts must belong to the same tenant.
  // Accepts optional correlationId for remote task result tracking (P0-1).
  // -------------------------------------------------------------------------
  router.post('/:id/forward', async (c) => {
    const targetId = Number(c.req.param('id'));
    const fromId   = extractFromId(c);
    const key      = extractAgentHostKey(c);
    const env      = c.env;

    if (!env.AGENT_HOST_RELAY) return c.text('AGENT_HOST_RELAY binding not configured', 503);

    if (Number.isNaN(fromId) || fromId <= 0) {
      return c.json({ error: 'from parameter or X-AgentHost-From header (source agentHost id) is required' }, 400);
    }

    // Authenticate the calling (source) agentHost
    const sourceAgentHost = await verifyAgentHostApiKey(fromId, key);
    if (!sourceAgentHost) return c.text('Unauthorized', 401);

    // Ensure target is in same tenant
    const [targetAgentHost] = await db
      .select({ id: agentHosts.id, connectedAt: agentHosts.connectedAt })
      .from(agentHosts)
      .where(and(
        eq(agentHosts.id, targetId),
        eq(agentHosts.tenantId, sourceAgentHost.tenantId),
      ));

    if (!targetAgentHost) return c.json({ error: 'Target agentHost not found in tenant' }, 404);

    // Read body as text so we can verify the HMAC signature before parsing.
    // X-AgentHost-Signature: sha256=<hex> — signed by the source agentHost using its raw API key.
    // If absent (older agentHosts), we skip verification for backward compat.
    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }

    const sigOk = await verifyAgentHostSignature(key ?? '', rawBody, c.req.header('X-AgentHost-Signature'));
    if (!sigOk) return c.json({ error: 'signature_mismatch' }, 401);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    // Preserve correlationId from the request body for result tracking (P0-1)
    const correlationId = typeof payload.correlationId === 'string'
      ? payload.correlationId
      : undefined;

    // Inject fromAgentHostId so the target knows where to send the remote.result
    const enrichedPayload = { ...payload, fromAgentHostId: fromId };

    // Forward to target agentHost via AgentHostRelayDO /dispatch endpoint
    const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(targetId)));
    const result = await stub.fetch(new Request('https://internal/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enrichedPayload),
    }));

    if (!result.ok) {
      const body = await result.json<{ ok: boolean; delivered: boolean; error?: string }>();
      const status = result.status === 409 ? 409 : 502;
      return c.json({ ok: false, delivered: false, correlationId, error: body.error ?? 'dispatch_failed' }, status);
    }

    return c.json({ ok: true, delivered: true, correlationId });
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-hosts/:id/relay-result?key=<agentHostApiKey>
  // P0-1: Target agentHost posts a remote.result frame; this endpoint forwards it
  // to the source agentHost's relay WebSocket so its pending promise can resolve.
  // Authentication: the TARGET agentHost's API key (the one that executed the task).
  // -------------------------------------------------------------------------
  router.post('/:id/relay-result', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);
    const env    = c.env;

    if (!env.AGENT_HOST_RELAY) return c.text('AGENT_HOST_RELAY binding not configured', 503);

    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    // Dispatch the remote.result into the SOURCE agentHost's relay (identified by agentHostId param)
    const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHostId)));
    const result = await stub.fetch(new Request('https://internal/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));

    return result;
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-hosts/:id/dispatch-result   (agentHost API key auth)
  // The headless-cloud result writeback: a deployed agentHost reports a swimlane
  // dispatch's terminal status here, and the SwimlaneCoordinator advances the
  // ticket (or routes it to needs_attention) — the agentHost analogue of the
  // browser's tenant-JWT /api/agent-runtime/:dispatchId/result. dispatchId is the
  // correlation id; tenant scope comes from the authenticated host (a host can
  // only report results for its own tenant's dispatches).
  // -------------------------------------------------------------------------
  router.post('/:id/dispatch-result', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key = extractAgentHostKey(c);
    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      dispatchId: string;
      status: 'completed' | 'failed' | 'cancelled';
      output?: string;
      error?: string;
    }>();
    if (!body.dispatchId) return c.json({ error: 'dispatchId is required' }, 400);
    if (!['completed', 'failed', 'cancelled'].includes(body.status)) {
      return c.json({ error: 'status must be completed | failed | cancelled' }, 400);
    }

    const coordinator = new SwimlaneCoordinator(
      new DrizzleCoordinatorStore(db),
      new AgentHostStageDispatcher(c.env.AGENT_HOST_RELAY),
      undefined,
      new DrizzlePrdEnsurer(db, c.env),
    );
    try {
      await coordinator.reportDispatchResult(body.dispatchId, agentHost.tenantId, {
        status: body.status,
        output: body.output ?? null,
        error: body.error ?? null,
      });
    } catch {
      return c.json({ error: 'Dispatch not found' }, 404);
    }
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/dispatch/:dispatchId   (agentHost API key auth)
  // A deployed agentHost fetches the full detail for a dispatch it received over
  // the relay (the relay frame carries only the dispatchId — secrets never ride
  // the relay). Returns the task input + the repo coordinates and the host-authed
  // git-proxy path the runtime clones/pushes through (so the git token stays
  // server-side, mirroring the browser security boundary).
  // -------------------------------------------------------------------------
  router.get('/:id/dispatch/:dispatchId', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key = extractAgentHostKey(c);
    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const dispatchId = c.req.param('dispatchId');
    const [d] = await db
      .select({
        id: agentDispatches.id,
        role: agentDispatches.role,
        model: agentDispatches.model,
        input: agentDispatches.input,
        taskId: agentDispatches.taskId,
        ticketRunId: agentDispatches.ticketRunId,
      })
      .from(agentDispatches)
      .where(and(eq(agentDispatches.id, dispatchId), eq(agentDispatches.tenantId, agentHost.tenantId)))
      .limit(1);
    if (!d) return c.json({ error: 'Dispatch not found' }, 404);

    const repo = await resolveDefaultRepoForTask(db, agentHost.tenantId, d.taskId);
    return c.json({
      dispatch: {
        dispatchId: d.id,
        role: d.role,
        model: d.model,
        input: d.input,
        taskId: d.taskId,
        ticketRunId: d.ticketRunId,
        repo: repo
          ? { ...repo, gitProxyPath: `/api/agent-hosts/${agentHostId}/git-proxy/${repo.repoId}` }
          : null,
      },
    });
  });

  // -------------------------------------------------------------------------
  // /api/agent-hosts/:id/git-proxy/:repoId/...   (agentHost API key auth)
  // The headless analogue of /api/git-proxy: a deployed agentHost runs git
  // smart-HTTP against these, and the credential is injected SERVER-SIDE. The
  // token never reaches the agentHost — identical boundary to the browser proxy,
  // reusing the same upstream-streaming executor (executeGitProxy).
  // -------------------------------------------------------------------------
  const hostGitProxy = async (
    c: Context<AgentHostHonoEnv>,
    repoId: string,
    subPath: string,
    method: 'GET' | 'POST',
  ): Promise<Response> => {
    const agentHostId = Number(c.req.param('id'));
    const key = extractAgentHostKey(c);
    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const env = c.env as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
    const resolved = await resolveRepoCredential(db, secret, agentHost.tenantId, repoId);
    if (isResolveError(resolved)) return c.json({ error: resolved.error }, resolved.status);

    const result = await executeGitProxy({
      repo: resolved.repo,
      token: resolved.token,
      subPath,
      method,
      query: method === 'GET' ? new URL(c.req.url).searchParams.toString() : undefined,
      contentType: c.req.header('Content-Type'),
      body: method === 'POST' ? await c.req.arrayBuffer() : undefined,
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return result.response;
  };

  router.get('/:id/git-proxy/:repoId/info/refs', (c) => hostGitProxy(c, c.req.param('repoId'), 'info/refs', 'GET'));
  router.post('/:id/git-proxy/:repoId/git-upload-pack', (c) => hostGitProxy(c, c.req.param('repoId'), 'git-upload-pack', 'POST'));
  router.post('/:id/git-proxy/:repoId/git-receive-pack', (c) => hostGitProxy(c, c.req.param('repoId'), 'git-receive-pack', 'POST'));

  // -------------------------------------------------------------------------
  // POST /api/agent-hosts/:id/dispatch/:dispatchId/pull-request   (host key auth)
  // Headless analogue of the browser's PR-open: after a deployed agentHost pushes
  // its branch through the host git-proxy, it opens the PR here. Shared logic with
  // the tenant-JWT route via openDispatchPullRequest (token stays server-side).
  // -------------------------------------------------------------------------
  router.post('/:id/dispatch/:dispatchId/pull-request', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key = extractAgentHostKey(c);
    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const dispatchId = c.req.param('dispatchId');
    const body = await c.req.json<{ branch: string; base?: string; title?: string; body?: string }>();
    const env = c.env as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';

    const result = await openDispatchPullRequest(db, secret, agentHost.tenantId, dispatchId, body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, url: result.url, number: result.number });
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-hosts/:id/file-change   (host key auth)
  // Persist one per-agent file change from the ticket workspace for traceability.
  // -------------------------------------------------------------------------
  router.post('/:id/file-change', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const agentHost = await verifyAgentHostApiKey(agentHostId, extractAgentHostKey(c));
    if (!agentHost) return c.text('Unauthorized', 401);

    type FileChangeBody = { taskId?: number; executionId?: number; path?: string; change?: string; agent?: string };
    const body = await c.req.json<FileChangeBody>().catch((): FileChangeBody => ({}));
    const taskId = Number(body.taskId);
    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!Number.isFinite(taskId) || !path) return c.json({ error: 'taskId and path are required' }, 400);
    const change = ['created', 'modified', 'deleted'].includes(body.change ?? '') ? body.change! : 'modified';
    const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim() : 'agent';

    const sql = neon(c.env.NEON_DATABASE_URL);
    await sql`
      INSERT INTO task_file_changes (tenant_id, task_id, execution_id, path, change, agent)
      VALUES (${agentHost.tenantId}, ${taskId}, ${Number.isFinite(Number(body.executionId)) ? Number(body.executionId) : null}, ${path}, ${change}, ${agent})
    `;
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-hosts/:id/tasks/:taskId/pull-request   (host key auth)
  // Ticket finalize: after the host pushes the shared task-workspace branch, it
  // opens the PR here. Same server-side credential flow as the dispatch PR route.
  // -------------------------------------------------------------------------
  router.post('/:id/tasks/:taskId/pull-request', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const agentHost = await verifyAgentHostApiKey(agentHostId, extractAgentHostKey(c));
    if (!agentHost) return c.text('Unauthorized', 401);

    const taskId = Number(c.req.param('taskId'));
    if (!Number.isFinite(taskId)) return c.json({ error: 'invalid taskId' }, 400);
    const body = await c.req.json<{ branch: string; base?: string; title?: string; body?: string }>();
    const env = c.env as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';

    const result = await openTaskPullRequest(db, secret, agentHost.tenantId, taskId, body, c.env);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, url: result.url, number: result.number, merged: result.merged, mergeError: result.mergeError });
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-hosts/:id/usage-snapshot?key=<agentHostApiKey>
  // P2-2: AgentHost posts context window / token usage snapshot for persistence.
  // -------------------------------------------------------------------------
  router.post('/:id/usage-snapshot', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);

    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      sessionKey?:       string;
      inputTokens?:      number;
      outputTokens?:     number;
      contextTokens?:    number;
      contextWindowMax?: number;
      compactionCount?:  number;
      ts?:               string;
    }>();

    await db.insert(usageSnapshots).values({
      tenantId:         agentHost.tenantId,
      agentHostId,
      sessionKey:       body.sessionKey ?? 'default',
      inputTokens:      body.inputTokens ?? 0,
      outputTokens:     body.outputTokens ?? 0,
      contextTokens:    body.contextTokens ?? 0,
      contextWindowMax: body.contextWindowMax ?? 0,
      compactionCount:  body.compactionCount ?? 0,
      ts:               body.ts ? new Date(body.ts) : new Date(),
    });

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/usage?limit=<n>
  // Tenant JWT auth: returns recent usage snapshots for this agentHost (newest first).
  // Consumed by the portal usageApi.list() to render the usage tab.
  // -------------------------------------------------------------------------
  router.get('/:id/usage', authMiddleware as never, async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const tenantId = c.get('tenantId') as number;
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

    // Ensure the agentHost belongs to this tenant
    const agentHost = await agentHostService.getAgentHostForTenant(agentHostId, tenantId);
    if (!agentHost) return c.json({ error: 'AgentHost not found' }, 404);

    const snapshots = await db
      .select({
        id:               usageSnapshots.id,
        agentHostId:      usageSnapshots.agentHostId,
        sessionKey:       usageSnapshots.sessionKey,
        inputTokens:      usageSnapshots.inputTokens,
        outputTokens:     usageSnapshots.outputTokens,
        contextTokens:    usageSnapshots.contextTokens,
        contextWindowMax: usageSnapshots.contextWindowMax,
        compactionCount:  usageSnapshots.compactionCount,
        ts:               usageSnapshots.ts,
      })
      .from(usageSnapshots)
      .where(and(eq(usageSnapshots.agentHostId, agentHostId), eq(usageSnapshots.tenantId, tenantId)))
      .orderBy(desc(usageSnapshots.ts))
      .limit(limit);

    return c.json({ snapshots });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/tool-audit?runId=&sessionKey=&limit=
  // Returns tool audit events for a agentHost, filterable by runId or sessionKey.
  // -------------------------------------------------------------------------
  router.get('/:id/tool-audit', authMiddleware as never, async (c) => {
    const agentHostId   = Number(c.req.param('id'));
    const tenantId = (c as unknown as { get: (k: string) => unknown }).get('tenantId') as number;
    const runId    = c.req.query('runId');
    const sessKey  = c.req.query('sessionKey');
    const limit    = Math.min(Number(c.req.query('limit') ?? 200), 500);
    // Optional per-execution scope: a V2/host run stamps `execution_id` on every
    // tool-audit row, so scoping to it isolates ONE run's Logs/Timeline instead of
    // showing every event the host ever emitted (parity with the cloud read).
    const execRaw = Number(c.req.query('executionId'));
    const executionId = Number.isFinite(execRaw) && execRaw > 0 ? execRaw : null;

    const conditions = [
      eq(toolAuditEvents.agentHostId,    agentHostId),
      eq(toolAuditEvents.tenantId,  tenantId),
      ...(runId       ? [eq(toolAuditEvents.runId,       runId)]       : []),
      ...(sessKey     ? [eq(toolAuditEvents.sessionKey,  sessKey)]     : []),
      ...(executionId ? [eq(toolAuditEvents.executionId, executionId)] : []),
    ];

    const rows = await db
      .select({
        id:          toolAuditEvents.id,
        runId:       toolAuditEvents.runId,
        sessionKey:  toolAuditEvents.sessionKey,
        toolCallId:  toolAuditEvents.toolCallId,
        toolName:    toolAuditEvents.toolName,
        category:    toolAuditEvents.category,
        args:        toolAuditEvents.args,
        result:      toolAuditEvents.result,
        durationMs:  toolAuditEvents.durationMs,
        executionId: toolAuditEvents.executionId,
        ts:          toolAuditEvents.ts,
      })
      .from(toolAuditEvents)
      .where(and(...conditions))
      .orderBy(toolAuditEvents.ts)
      .limit(limit);

    // Read-path repair (shared with the cloud tool-audit read): surface a terminal
    // `run.failed` for an execution that failed without emitting the telemetry event,
    // so a DISCONNECTED host's Log/Timeline tab shows the failure. Events are oldest-
    // first here, so the terminal failure appends.
    if (executionId != null) {
      const synthetic = await synthesizeRunFailedEvent(db, tenantId, executionId, rows);
      if (synthetic) rows.push(synthetic);
    }

    return c.json({ events: rows });
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-hosts/:id/tool-audit?key=<agentHostApiKey>
  // P2-4: AgentHost posts a tool call audit event for persistence.
  // -------------------------------------------------------------------------
  router.post('/:id/tool-audit', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);

    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      runId?:       string;
      executionId?: number;
      sessionKey?:  string;
      toolCallId?:  string;
      toolName?:    string;
      category?:    string;
      args?:        unknown;
      result?:      string;
      durationMs?:  number;
      ts?:          string;
    }>();

    if (!body.toolName) return c.json({ error: 'toolName is required' }, 400);

    await db.insert(toolAuditEvents).values({
      tenantId:    agentHost.tenantId,
      agentHostId,
      // Stamp the execution so the event is queryable per-run (the cloud Logs/
      // Timeline scope by execution_id), giving V2/host runs parity with V1.
      executionId: Number.isFinite(Number(body.executionId)) ? Number(body.executionId) : null,
      runId:       body.runId ?? null,
      sessionKey:  body.sessionKey ?? null,
      toolCallId:  body.toolCallId ?? null,
      toolName:    body.toolName,
      category:    body.category ?? null,
      args:        body.args != null ? JSON.stringify(body.args) : null,
      result:      body.result ?? null,
      durationMs:  body.durationMs ?? null,
      ts:          body.ts ? new Date(body.ts) : new Date(),
    });

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/agent-hosts/:id/approval-request?key=<agentHostApiKey>
  // P3-3: AgentHost creates a pending approval for a destructive/high-risk action.
  // -------------------------------------------------------------------------
  router.post('/:id/approval-request', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);
    const env    = c.env;

    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      kind?:        string;
      actionType?:  string;
      description?: string;
      metadata?:    unknown;
      expiresAt?:   string;
      requestedBy?: string;
    }>();

    if (!body.actionType || !body.description) {
      return c.json({ error: 'actionType and description are required' }, 400);
    }

    const kind = normalizeRequestKind(body.kind);

    const approvalId = crypto.randomUUID();
    await db.insert(approvals).values({
      id:          approvalId,
      tenantId:    agentHost.tenantId,
      agentHostId,
      requestedBy: body.requestedBy ?? String(agentHostId),
      kind,
      actionType:  body.actionType,
      description: body.description,
      metadata:    body.metadata != null ? JSON.stringify(body.metadata) : null,
      expiresAt:   body.expiresAt ? new Date(body.expiresAt) : null,
    });

    // Notify connected browser clients via the relay
    if (env.AGENT_HOST_RELAY) {
      const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHostId)));
      stub.fetch(new Request('https://internal/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approval.request',
          approvalId,
          kind,
          actionType:  body.actionType,
          description: body.description,
          expiresAt:   body.expiresAt,
        }),
      })).catch(() => { /* best-effort */ });
    }

    return c.json({ ok: true, approvalId }, 201);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/agent-hosts/:id/executions/:eid/state
  // AgentHost callback: update execution lifecycle state after task.assign dispatch.
  // Reports running → completed / failed back to the executions table so the
  // portal reflects live task status without requiring a tenant JWT.
  // -------------------------------------------------------------------------
  router.patch('/:id/executions/:eid/state', async (c) => {
    const agentHostId      = Number(c.req.param('id'));
    const executionId = Number(c.req.param('eid'));
    const key         = extractAgentHostKey(c);

    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      status:        'running' | 'completed' | 'failed' | 'cancelled';
      result?:       string;
      errorMessage?: string;
    }>();

    const valid = ['running', 'completed', 'failed', 'cancelled'];
    if (!valid.includes(body.status)) {
      return c.json({ error: `status must be one of: ${valid.join(', ')}` }, 400);
    }

    const now = new Date();
    await db
      .update(executions)
      .set({
        status: body.status as 'running' | 'completed' | 'failed' | 'cancelled',
        ...(body.result       !== undefined ? { result: body.result }             : {}),
        ...(body.errorMessage !== undefined ? { errorMessage: body.errorMessage } : {}),
        ...(body.status === 'running'   ? { startedAt: now }   : {}),
        ...(body.status === 'completed' || body.status === 'failed' || body.status === 'cancelled'
          ? { completedAt: now }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(executions.id, executionId), eq(executions.agentHostId, agentHostId)));

    const [row] = await db
      .select()
      .from(executions)
      .where(and(eq(executions.id, executionId), eq(executions.agentHostId, agentHostId)));
    if (!row) return c.json({ error: 'Execution not found' }, 404);
    return c.json(row);
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/spec
  // AgentHost-auth: returns the active (approved or in_progress) spec for this
  // agentHost's primary project. Used by BuilderForce Agents to pull planning context.
  // -------------------------------------------------------------------------
  router.get('/:id/spec', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);
    const agentHost   = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const [assignment] = await db
      .select({ projectId: agentHostProjects.projectId })
      .from(agentHostProjects)
      .where(and(eq(agentHostProjects.agentHostId, agentHostId), eq(agentHostProjects.tenantId, Number(agentHost.tenantId))))
      .limit(1);

    if (!assignment) return c.json({ spec: null });

    const [spec] = await db
      .select()
      .from(specs)
      .where(
        and(
          eq(specs.projectId, assignment.projectId),
          eq(specs.tenantId, Number(agentHost.tenantId)),
          inArray(specs.status, ['ready', 'in_progress']),
        ),
      )
      .orderBy(desc(specs.updatedAt))
      .limit(1);

    return c.json({ spec: spec ?? null });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/tasks/:taskId/specs
  // AgentHost-auth: returns the PRD(s) linked to a specific task (primary first),
  // so the executing agent reads the TASK's PRDs, not just the project default.
  // -------------------------------------------------------------------------
  router.get('/:id/tasks/:taskId/specs', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const taskId = Number(c.req.param('taskId'));
    const key = extractAgentHostKey(c);
    const agentHost = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const rows = await db
      .select({
        id: specs.id, goal: specs.goal, status: specs.status, prd: specs.prd,
        archSpec: specs.archSpec, taskList: specs.taskList, projectId: specs.projectId,
        isPrimary: taskSpecs.isPrimary, createdAt: specs.createdAt, updatedAt: specs.updatedAt,
      })
      .from(taskSpecs)
      .innerJoin(specs, eq(specs.id, taskSpecs.specId))
      .where(and(eq(taskSpecs.taskId, taskId), eq(specs.tenantId, Number(agentHost.tenantId))))
      .orderBy(desc(taskSpecs.isPrimary), desc(specs.updatedAt));

    return c.json({ specs: rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/platform-personas
  // AgentHost-auth: returns all active admin-managed platform personas.
  // -------------------------------------------------------------------------
  router.get('/:id/platform-personas', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);
    const agentHost   = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const rows = await db
      .select()
      .from(platformPersonas)
      .where(eq(platformPersonas.active, true))
      .orderBy(platformPersonas.name);

    return c.json({ personas: rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/quota
  // AgentHost-auth: returns token usage totals for this agentHost over the last 30 days.
  // -------------------------------------------------------------------------
  router.get('/:id/quota', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);
    const agentHost   = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        inputTokens:  usageSnapshots.inputTokens,
        outputTokens: usageSnapshots.outputTokens,
      })
      .from(usageSnapshots)
      .where(and(eq(usageSnapshots.agentHostId, agentHostId), gte(usageSnapshots.ts, since)));

    const totalInput  = rows.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutput = rows.reduce((s, r) => s + r.outputTokens, 0);
    return c.json({
      period:            '30d',
      since:             since.toISOString(),
      totalInputTokens:  totalInput,
      totalOutputTokens: totalOutput,
      totalTokens:       totalInput + totalOutput,
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/agent-hosts/:id/project-context
  // AgentHost-auth: push local project governance/architecture context to the
  // project record in Builderforce so the portal and other agentHosts can read it.
  // -------------------------------------------------------------------------
  router.patch('/:id/project-context', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);
    const agentHost   = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const body = await c.req.json<{ projectId?: number; governance?: string }>();

    let projectId = body.projectId;
    if (!projectId) {
      const [assignment] = await db
        .select({ projectId: agentHostProjects.projectId })
        .from(agentHostProjects)
        .where(and(eq(agentHostProjects.agentHostId, agentHostId), eq(agentHostProjects.tenantId, Number(agentHost.tenantId))))
        .limit(1);
      projectId = assignment?.projectId;
    }

    if (!projectId) return c.json({ error: 'No project assigned to this agentHost' }, 404);
    if (!body.governance) return c.json({ error: 'governance field is required' }, 400);

    await db
      .update(projects)
      .set({ governance: body.governance, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, Number(agentHost.tenantId))));

    return c.json({ ok: true, projectId });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/artifacts/resolve
  // AgentHost-auth: resolve effective artifact set for this agentHost's context.
  // Query params: taskId?, projectId?
  // -------------------------------------------------------------------------
  router.get('/:id/artifacts/resolve', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);
    const agentHost   = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const taskIdP    = c.req.query('taskId');
    const projectIdP = c.req.query('projectId');

    // Default to agentHost's primary project if no projectId given
    let projectId = projectIdP ? Number(projectIdP) : undefined;
    if (!projectId) {
      const [assignment] = await db
        .select({ projectId: agentHostProjects.projectId })
        .from(agentHostProjects)
        .where(and(eq(agentHostProjects.agentHostId, agentHostId), eq(agentHostProjects.tenantId, Number(agentHost.tenantId))))
        .limit(1);
      projectId = assignment?.projectId;
    }

    const resolved = await resolveArtifacts(db, {
      tenantId:  Number(agentHost.tenantId),
      taskId:    taskIdP ? Number(taskIdP) : undefined,
      agentHostId,
      projectId,
    });
    return c.json(resolved);
  });

  // -------------------------------------------------------------------------
  // PUT /api/agent-hosts/:id/personas
  // AgentHost-auth: register this agentHost's local custom role definitions so the
  // portal can display what agent personas are available.
  // -------------------------------------------------------------------------
  router.put('/:id/personas', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const key    = extractAgentHostKey(c);
    const agentHost   = await verifyAgentHostApiKey(agentHostId, key);
    if (!agentHost) return c.text('Unauthorized', 401);

    const body = await c.req.json<{ personas: unknown[] }>();
    if (!Array.isArray(body.personas)) {
      return c.json({ error: 'personas must be an array' }, 400);
    }

    await db
      .update(agentHosts)
      .set({ localPersonas: JSON.stringify(body.personas), updatedAt: new Date() })
      .where(eq(agentHosts.id, agentHostId));

    return c.json({ ok: true, count: body.personas.length });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent-hosts/:id/context-bundle (P4-2)
  // Returns the last-synced .builderforce/ files for the specified agentHost so peer
  // agentHosts can hydrate remote context before dispatching tasks.
  // Auth: agentHost API key (Authorization: Bearer <key>) or tenant JWT.
  // -------------------------------------------------------------------------
  router.get('/:id/context-bundle', async (c) => {
    const agentHostId = Number(c.req.param('id'));

    // Allow agentHost-auth or tenant JWT
    let tenantId: number | null = null;
    const key = extractAgentHostKey(c);
    const agentHostAuth = await verifyAgentHostApiKey(agentHostId, key);
    if (agentHostAuth) {
      tenantId = Number(agentHostAuth.tenantId);
    } else {
      // Fall through to tenant JWT check
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (typeof tid === 'number') tenantId = tid;
    }
    if (!tenantId) return c.text('Unauthorized', 401);

    // Look up the agentHost and verify tenant ownership
    const [agentHost] = await db
      .select({ id: agentHosts.id, tenantId: agentHosts.tenantId, updatedAt: agentHosts.updatedAt })
      .from(agentHosts)
      .where(and(eq(agentHosts.id, agentHostId), eq(agentHosts.tenantId, tenantId)));
    if (!agentHost) return c.json({ error: 'AgentHost not found' }, 404);

    // Find the latest directory sync for this agentHost
    const [latestDir] = await db
      .select({ id: agentHostDirectories.id, lastSyncedAt: agentHostDirectories.lastSyncedAt })
      .from(agentHostDirectories)
      .where(and(eq(agentHostDirectories.agentHostId, agentHostId), eq(agentHostDirectories.tenantId, tenantId)))
      .orderBy(desc(agentHostDirectories.updatedAt))
      .limit(1);

    if (!latestDir) {
      return c.json({ agentHostId, files: [], syncedAt: null });
    }

    // Fetch all files from the latest directory sync
    const files = await db
      .select({
        relPath:     agentHostDirectoryFiles.relPath,
        content:     agentHostDirectoryFiles.content,
        contentHash: agentHostDirectoryFiles.contentHash,
      })
      .from(agentHostDirectoryFiles)
      .where(
        and(
          eq(agentHostDirectoryFiles.directoryId, latestDir.id),
          eq(agentHostDirectoryFiles.tenantId, tenantId),
          eq(agentHostDirectoryFiles.agentHostId, agentHostId),
        ),
      );

    const bundle = files.map((f) => ({
      path:    f.relPath,
      content: f.content ?? '',
      sha256:  f.contentHash,
    }));

    return c.json({
      agentHostId,
      files: bundle,
      syncedAt: latestDir.lastSyncedAt?.toISOString() ?? null,
    });
  });

  return router;
}
