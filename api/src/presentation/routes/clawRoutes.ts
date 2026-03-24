/**
 * CoderClaw instance routes – /api/claws
 *
 * CoderClaw instances are registered machines owned by a tenant.
 * Each instance authenticates with its own API key (not a user credential).
 * One claw = one tenant. Users manage their mesh from the web UI.
 *
 * All routes require a tenant-scoped JWT (authMiddleware).
 */
import { Hono, type Context } from 'hono';
import { eq, and, isNull, desc, inArray, gte } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  coderclawInstances,
  clawProjects,
  clawDirectories,
  clawDirectoryFiles,
  clawSyncHistory,
  chatSessions,
  cronJobs,
  projects,
  tenants,
  usageSnapshots,
  toolAuditEvents,
  approvals,
  executions,
  tenantSkillAssignments,
  clawSkillAssignments,
  marketplaceSkills,
  specs,
  platformPersonas,
} from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { verifyJwt } from '../../infrastructure/auth/JwtService';
import { resolveArtifacts } from '../../application/artifact/resolveArtifacts';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ClawRelayDO } from '../../infrastructure/relay/ClawRelayDO';
import type { ClawService } from '../../application/claw/ClawService';
import { classifyContextFiles, normalizeMachineProfile, type ClawMachineProfileInput } from './clawAssignmentContext';
import { TenantRole } from '../../domain/shared/types';
import { buildPlanLimitsGuard } from '../middleware/planLimitsGuard';

// Extend HonoEnv bindings type to include the Durable Object
type ClawHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    CLAW_RELAY: DurableObjectNamespace<ClawRelayDO>;
  };
};

export function createClawRoutes(db: Db, clawService: ClawService): Hono<ClawHonoEnv> {
  const router = new Hono<ClawHonoEnv>();

  const buildAssignmentContext = async (clawId: number, tenantId: number, projectId?: number) => {
    const [clawRow] = await db
      .select({
        id: coderclawInstances.id,
        name: coderclawInstances.name,
        slug: coderclawInstances.slug,
        tenantId: coderclawInstances.tenantId,
        machineName: coderclawInstances.machineName,
        machineIp: coderclawInstances.machineIp,
        rootInstallDirectory: coderclawInstances.rootInstallDirectory,
        workspaceDirectory: coderclawInstances.workspaceDirectory,
        gatewayPort: coderclawInstances.gatewayPort,
        relayPort: coderclawInstances.relayPort,
        tunnelUrl: coderclawInstances.tunnelUrl,
        tunnelStatus: coderclawInstances.tunnelStatus,
        networkMetadata: coderclawInstances.networkMetadata,
        lastSeenAt: coderclawInstances.lastSeenAt,
        connectedAt: coderclawInstances.connectedAt,
        updatedAt: coderclawInstances.updatedAt,
      })
      .from(coderclawInstances)
      .where(and(eq(coderclawInstances.id, clawId), eq(coderclawInstances.tenantId, tenantId)))
      .limit(1);

    if (!clawRow) return null;

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
      .from(clawProjects)
      .innerJoin(projects, eq(projects.id, clawProjects.projectId))
      .where(and(eq(clawProjects.tenantId, tenantId), eq(clawProjects.clawId, clawId)))
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
        .select({ id: clawDirectories.id, absPath: clawDirectories.absPath })
        .from(clawDirectories)
        .where(
          and(
            eq(clawDirectories.tenantId, tenantId),
            eq(clawDirectories.clawId, clawId),
            eq(clawDirectories.projectId, primaryProject.id),
          ),
        )
        .orderBy(desc(clawDirectories.updatedAt))
        .limit(1);

      if (latestDirectory) {
        directoryPath = latestDirectory.absPath;
        const files = await db
          .select({ relPath: clawDirectoryFiles.relPath })
          .from(clawDirectoryFiles)
          .where(
            and(
              eq(clawDirectoryFiles.tenantId, tenantId),
              eq(clawDirectoryFiles.clawId, clawId),
              eq(clawDirectoryFiles.directoryId, latestDirectory.id),
            ),
          );
        contextHints = classifyContextFiles(files.map((file) => file.relPath));
      }
    }

    let parsedNetworkMetadata: Record<string, unknown> | null = null;
    if (clawRow.networkMetadata) {
      try {
        parsedNetworkMetadata = JSON.parse(clawRow.networkMetadata) as Record<string, unknown>;
      } catch {
        parsedNetworkMetadata = null;
      }
    }

    return {
      claw: {
        id: clawRow.id,
        slug: clawRow.slug,
        name: clawRow.name,
        tenantId: clawRow.tenantId,
        lastSeenAt: clawRow.lastSeenAt,
        connectedAt: clawRow.connectedAt,
        updatedAt: clawRow.updatedAt,
        machineProfile: {
          machineName: clawRow.machineName,
          machineIp: clawRow.machineIp,
          rootInstallDirectory: clawRow.rootInstallDirectory,
          workspaceDirectory: clawRow.workspaceDirectory,
          gatewayPort: clawRow.gatewayPort,
          relayPort: clawRow.relayPort,
          tunnelUrl: clawRow.tunnelUrl,
          tunnelStatus: clawRow.tunnelStatus,
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

  const verifyClawApiKey = async (id: number, key?: string) => {
    if (!key) return null;
    return clawService.verifyApiKey(id, key);
  };

  /**
   * Extract the claw API key from the request.
   * Prefers the Authorization: Bearer header; falls back to the legacy ?key= query
   * parameter so existing claws continue working during the migration window.
   */
  const extractClawKey = (c: Context<ClawHonoEnv>): string | undefined =>
    c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ??
    c.req.query('key');

  /**
   * Extract the source claw ID for endpoints that identify the caller.
   * Prefers the X-Claw-From header; falls back to the legacy ?from= query param.
   */
  const extractFromId = (c: Context<ClawHonoEnv>): number => {
    const raw = c.req.header('X-Claw-From') ?? c.req.query('from') ?? '';
    return Number(raw);
  };

  /**
   * Verify an HMAC-SHA256 payload signature sent as X-Claw-Signature: sha256=<hex>.
   * Uses the Web Crypto API (available in Cloudflare Workers).
   * Returns true if the signature is absent (backward compat) or matches.
   * Returns false only when a signature is present but invalid.
   */
  const verifyClawSignature = async (
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

  // GET /api/claws/fleet?from=<clawId>&key=<apiKey>
  // Claw-authenticated endpoint: returns all claws in the same tenant.
  // Used by the claw_fleet agent tool for peer discovery without a user JWT.
  // NOTE: registered before /:id routes so "/fleet" is not captured by the param.
  router.get('/fleet', async (c) => {
    const fromId = extractFromId(c);
    const key    = extractClawKey(c);

    if (Number.isNaN(fromId) || fromId <= 0) {
      return c.json({ error: 'from parameter or X-Claw-From header (source claw id) is required' }, 400);
    }

    const sourceClaw = await verifyClawApiKey(fromId, key);
    if (!sourceClaw) return c.text('Unauthorized', 401);

    const claws = await clawService.listClawsForTenant(Number(sourceClaw.tenantId));
    const fleet = claws.map((claw) => ({
      id:                   claw.id,
      name:                 claw.name,
      slug:                 claw.slug,
      online:               claw.connectedAt !== null,
      connectedAt:          claw.connectedAt,
      lastSeenAt:           claw.lastSeenAt,
      capabilities:         claw.capabilities ?? [],
      declaredCapabilities: claw.declaredCapabilities ?? [],
    }));

    return c.json({ fleet });
  });

  // GET /api/claws/fleet/route?requires=<cap1,cap2>&token=<jwt>
  // P2-3: Capability routing — returns the best-matching online claw for the
  // given required capabilities (tenant JWT auth).
  // NOTE: registered before /:id routes so "/fleet/route" is not captured.
  router.get('/fleet/route', authMiddleware as never, async (c) => {
    const requires = (c.req.query('requires') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const tenantId = (c as unknown as { get: (k: string) => unknown }).get('tenantId') as number;

    const claws = await clawService.listClawsForTenant(tenantId);

    const score = (claw: (typeof claws)[number]): number => {
      const caps = new Set([
        ...(claw.capabilities ?? []),
        ...(claw.declaredCapabilities ?? []),
      ]);
      const online = claw.connectedAt !== null ? 1 : 0;
      const matched = requires.filter((r) => caps.has(r)).length;
      const total = requires.length || 1;
      return online * 0.5 + (matched / total) * 0.5;
    };

    const scored = claws.map((claw) => ({ claw, score: score(claw) })).sort((a, b) => b.score - a.score);

    if (scored.length === 0) return c.json({ error: 'No claws available' }, 404);

    const best = scored[0]!.claw;
    return c.json({
      clawId: best.id,
      name:   best.name,
      score:  Math.round(score(best) * 100) / 100,
      online: best.connectedAt !== null,
    });
  });

  // GET /api/claws – list all claws for the current tenant
  // Optional query params:
  //  - status=online  (only claws with connectedAt NOT NULL)
  //  - status=offline (only claws with connectedAt NULL)
  router.get('/', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const status = (c.req.query('status') ?? '').toString().trim().toLowerCase();

    const filterStatus = status === 'online' || status === 'offline' ? status : null;
    const claws = await clawService.listClawsForTenant(tenantId, filterStatus);

    const rows = claws.map((claw) => ({
      id: claw.id,
      name: claw.name,
      slug: claw.slug,
      status: claw.status,
      connectedAt: claw.connectedAt,
      lastSeenAt: claw.lastSeenAt,
      createdAt: claw.createdAt,
    }));

    return c.json({ claws: rows });
  });

  // POST /api/claws – register a new CoderClaw instance
  // Returns the plaintext API key once – it is never stored in plaintext.
  router.post('/', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const body     = await c.req.json<{ name: string; machineProfile?: ClawMachineProfileInput }>();

    if (!body.name?.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }

    const guard = buildPlanLimitsGuard(db);
    const limitErr = await guard.checkClawLimit(tenantId);
    if (limitErr) return c.json(limitErr, 402);

    const slug    = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const rawKey  = generateApiKey();
    const keyHash = await hashSecret(rawKey);
    const machineProfile = normalizeMachineProfile(body.machineProfile);

    const [inserted] = await db
      .insert(coderclawInstances)
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
        id:        coderclawInstances.id,
        name:      coderclawInstances.name,
        slug:      coderclawInstances.slug,
        status:    coderclawInstances.status,
        createdAt: coderclawInstances.createdAt,
      });

    if (!inserted) {
      return c.json({ error: 'Failed to register claw' }, 500);
    }

    await db
      .update(tenants)
      .set({
        defaultClawId: inserted.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenants.id, tenantId),
          isNull(tenants.defaultClawId),
        ),
      );

    return c.json({
      claw:   inserted,
      apiKey: rawKey,
      note:   'Save this API key — it will not be shown again. Paste it into your CoderClaw config.',
    }, 201);
  });

  // DELETE /api/claws/:id – deactivate / remove a claw
  router.delete('/:id', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id       = Number(c.req.param('id'));
    await db
      .delete(coderclawInstances)
      .where(and(eq(coderclawInstances.id, id), eq(coderclawInstances.tenantId, tenantId)));
    return c.body(null, 204);
  });

  // PATCH /api/claws/:id/status – lifecycle status transition (manager+)
  router.patch('/:id/status', authMiddleware as never, requireRole(TenantRole.MANAGER) as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId = Number(c.req.param('id'));
    const body = await c.req.json<{ status?: 'active' | 'inactive' | 'suspended' }>();

    if (!body.status || !['active', 'inactive', 'suspended'].includes(body.status)) {
      return c.json({ error: 'status must be one of: active, inactive, suspended' }, 400);
    }

    const updated = await clawService.setStatus(clawId, tenantId, body.status);
    if (!updated) return c.json({ error: 'Claw not found' }, 404);

    // Non-active claws should not appear as connected.
    if (body.status !== 'active') {
      await db
        .update(coderclawInstances)
        .set({ connectedAt: null })
        .where(and(eq(coderclawInstances.id, clawId), eq(coderclawInstances.tenantId, tenantId)));
    }

    return c.json({
      claw: {
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

  // PATCH /api/claws/:id/limits – set per-claw token budget (manager+)
  // Allows managers to cap individual Claw token spend per day.
  // Set tokenDailyLimit to null to remove the per-claw cap (plan-level limit applies).
  router.patch('/:id/limits', authMiddleware as never, requireRole(TenantRole.MANAGER) as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId = Number(c.req.param('id'));
    const body = await c.req.json<{ tokenDailyLimit?: number | null }>();

    const limit = body.tokenDailyLimit === undefined ? undefined : body.tokenDailyLimit;
    if (limit !== null && limit !== undefined && (typeof limit !== 'number' || limit < 0 || !Number.isInteger(limit))) {
      return c.json({ error: 'tokenDailyLimit must be a non-negative integer or null' }, 400);
    }

    const [updated] = await db
      .update(coderclawInstances)
      .set({
        tokenDailyLimit: limit === undefined ? undefined : limit,
        updatedAt: new Date(),
      })
      .where(and(eq(coderclawInstances.id, clawId), eq(coderclawInstances.tenantId, tenantId)))
      .returning({ id: coderclawInstances.id, tokenDailyLimit: coderclawInstances.tokenDailyLimit });

    if (!updated) return c.json({ error: 'Claw not found' }, 404);

    return c.json({ clawId: updated.id, tokenDailyLimit: updated.tokenDailyLimit });
  });

  // GET /api/claws/:id/projects – list projects associated with this claw
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
      .from(clawProjects)
      .innerJoin(projects, eq(projects.id, clawProjects.projectId))
      .where(
        and(
          eq(clawProjects.tenantId, tenantId),
          eq(clawProjects.clawId, id),
        ),
      );

    return c.json({ projects: rows });
  });

  // GET /api/claws/:id/nodes – list paired nodes for a claw
  // Current implementation models one primary node (the claw instance itself).
  router.get('/:id/nodes', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId = Number(c.req.param('id'));

    const [claw] = await db
      .select({
        id: coderclawInstances.id,
        name: coderclawInstances.name,
        connectedAt: coderclawInstances.connectedAt,
        lastSeenAt: coderclawInstances.lastSeenAt,
      })
      .from(coderclawInstances)
      .where(
        and(
          eq(coderclawInstances.id, clawId),
          eq(coderclawInstances.tenantId, tenantId),
        ),
      );

    if (!claw) return c.json([], 200);

    return c.json([
      {
        id: String(claw.id),
        name: claw.name,
        capabilities: ['chat', 'tasks', 'relay'],
        connectedAt: claw.connectedAt,
        lastSeenAt: claw.lastSeenAt,
        status: claw.connectedAt ? 'connected' : 'disconnected',
      },
    ]);
  });

  // DELETE /api/claws/:id/nodes/:nodeId – unpair a node
  // For now, unpairing primary node marks claw as inactive/disconnected.
  router.delete('/:id/nodes/:nodeId', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId = Number(c.req.param('id'));
    const nodeId = Number(c.req.param('nodeId'));

    if (Number.isNaN(clawId) || Number.isNaN(nodeId) || clawId !== nodeId) {
      return c.json({ error: 'Node not found' }, 404);
    }

    await clawService.deactivate(clawId, tenantId);
    await db
      .update(coderclawInstances)
      .set({
        connectedAt: null,
      })
      .where(
        and(
          eq(coderclawInstances.id, clawId),
          eq(coderclawInstances.tenantId, tenantId),
        ),
      );

    return c.body(null, 204);
  });

  // PUT /api/claws/:id/projects/:projectId – associate project with claw
  router.put('/:id/projects/:projectId', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId = Number(c.req.param('id'));
    const projectId = Number(c.req.param('projectId'));

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
    if (!project) return c.json({ error: 'Project not found in tenant' }, 404);

    await db
      .insert(clawProjects)
      .values({ tenantId, clawId, projectId, role: 'default' })
      .onConflictDoUpdate({
        target: [clawProjects.tenantId, clawProjects.clawId, clawProjects.projectId],
        set: { updatedAt: new Date() },
      });

    const assignmentContext = await buildAssignmentContext(clawId, tenantId, projectId);
    return c.json({ ok: true, assignmentContext });
  });

  // GET /api/claws/:id/assignment-context – claw-authenticated assignment and context handshake payload
  router.get('/:id/assignment-context', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key = extractClawKey(c);
    const claw = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    const assignmentContext = await buildAssignmentContext(clawId, Number(claw.tenantId));
    if (!assignmentContext) {
      return c.json({ error: 'Claw not found' }, 404);
    }

    return c.json(assignmentContext);
  });

  // DELETE /api/claws/:id/projects/:projectId – unassociate project from claw
  router.delete('/:id/projects/:projectId', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId = Number(c.req.param('id'));
    const projectId = Number(c.req.param('projectId'));

    await db
      .delete(clawProjects)
      .where(
        and(
          eq(clawProjects.tenantId, tenantId),
          eq(clawProjects.clawId, clawId),
          eq(clawProjects.projectId, projectId),
        ),
      );

    return c.body(null, 204);
  });

  // GET /api/claws/:id/directories – list synced directory manifest entries
  router.get('/:id/directories', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId = Number(c.req.param('id'));

    const rows = await db
      .select({
        id: clawDirectories.id,
        projectId: clawDirectories.projectId,
        absPath: clawDirectories.absPath,
        status: clawDirectories.status,
        errorMessage: clawDirectories.errorMessage,
        metadata: clawDirectories.metadata,
        lastSeenAt: clawDirectories.lastSeenAt,
        lastSyncedAt: clawDirectories.lastSyncedAt,
        updatedAt: clawDirectories.updatedAt,
      })
      .from(clawDirectories)
      .where(
        and(
          eq(clawDirectories.tenantId, tenantId),
          eq(clawDirectories.clawId, clawId),
        ),
      );

    return c.json({ directories: rows });
  });

  // GET /api/claws/:id/directories/:directoryId/files – list synced files
  router.get('/:id/directories/:directoryId/files', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId = Number(c.req.param('id'));
    const directoryId = Number(c.req.param('directoryId'));

    const files = await db
      .select({
        relPath: clawDirectoryFiles.relPath,
        contentHash: clawDirectoryFiles.contentHash,
        sizeBytes: clawDirectoryFiles.sizeBytes,
        updatedAt: clawDirectoryFiles.updatedAt,
      })
      .from(clawDirectoryFiles)
      .where(
        and(
          eq(clawDirectoryFiles.tenantId, tenantId),
          eq(clawDirectoryFiles.clawId, clawId),
          eq(clawDirectoryFiles.directoryId, directoryId),
        ),
      );

    return c.json({ files });
  });

  // GET /api/claws/:id/directories/:directoryId/files/content?path=...
  router.get('/:id/directories/:directoryId/files/content', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId = Number(c.req.param('id'));
    const directoryId = Number(c.req.param('directoryId'));
    const relPath = c.req.query('path')?.trim();
    if (!relPath) return c.json({ error: 'path is required' }, 400);

    const [file] = await db
      .select({
        relPath: clawDirectoryFiles.relPath,
        content: clawDirectoryFiles.content,
        contentHash: clawDirectoryFiles.contentHash,
        updatedAt: clawDirectoryFiles.updatedAt,
      })
      .from(clawDirectoryFiles)
      .where(
        and(
          eq(clawDirectoryFiles.tenantId, tenantId),
          eq(clawDirectoryFiles.clawId, clawId),
          eq(clawDirectoryFiles.directoryId, directoryId),
          eq(clawDirectoryFiles.relPath, relPath),
        ),
      );

    if (!file) return c.json({ error: 'File not found' }, 404);
    return c.json(file);
  });

  // PUT /api/claws/:id/directories/sync – startup/full/delta sync from local gateway
  // Authentication: API key via ?key= query param.
  router.put('/:id/directories/sync', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key = extractClawKey(c);
    const claw = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

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
        .where(and(eq(projects.id, body.projectId), eq(projects.tenantId, claw.tenantId)))
        .limit(1);

      if (!project) {
        return c.json({ error: 'project not found in tenant' }, 404);
      }

      const [projectMapping] = await db
        .select({ clawId: clawProjects.clawId })
        .from(clawProjects)
        .where(and(
          eq(clawProjects.tenantId, claw.tenantId),
          eq(clawProjects.clawId, clawId),
          eq(clawProjects.projectId, body.projectId),
        ))
        .limit(1);

      if (!projectMapping) {
        const [tenant] = await db
          .select({ defaultClawId: tenants.defaultClawId })
          .from(tenants)
          .where(eq(tenants.id, claw.tenantId))
          .limit(1);

        if (tenant?.defaultClawId !== clawId) {
          return c.json({
            ok: true,
            skipped: true,
            reason: 'project_wip_no_project_or_default_claw_assignment',
          }, 202);
        }
      }
    }

    const pathHash = await hashPath(absPath);
    const [directory] = await db
      .insert(clawDirectories)
      .values({
        tenantId: claw.tenantId,
        clawId,
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
        target: [clawDirectories.tenantId, clawDirectories.clawId, clawDirectories.pathHash],
        set: {
          projectId: body.projectId ?? null,
          absPath,
          status: body.status ?? 'pending',
          metadata: body.metadata ? JSON.stringify(body.metadata) : null,
          errorMessage: body.errorMessage ?? null,
          lastSeenAt: new Date(),
          lastSyncedAt: body.status === 'synced' ? new Date() : clawDirectories.lastSyncedAt,
          updatedAt: new Date(),
        },
      })
      .returning({ id: clawDirectories.id });

    if (!directory) {
      return c.json({ error: 'Unable to persist directory manifest entry' }, 500);
    }

    if (body.files?.length) {
      const fileRows = body.files
        .filter((file) => file.relPath?.trim())
        .map((file) => ({
          tenantId: claw.tenantId,
          clawId,
          directoryId: directory.id,
          relPath: file.relPath,
          contentHash: file.contentHash ?? '',
          sizeBytes: file.sizeBytes ?? (file.content ? file.content.length : 0),
          content: file.content ?? null,
          updatedAt: new Date(),
        }));

      for (const row of fileRows) {
        await db
          .insert(clawDirectoryFiles)
          .values(row)
          .onConflictDoUpdate({
            target: [clawDirectoryFiles.directoryId, clawDirectoryFiles.relPath],
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
    await db.insert(clawSyncHistory).values({
      tenantId: claw.tenantId,
      clawId,
      directoryId: directory.id,
      triggeredBy,
      fileCount,
      bytesTotal,
      status: 'success',
    });

    return c.json({ ok: true, directoryId: directory.id });
  });

  // GET /api/claws/:id/sync-history – recent sync history (JWT auth)
  router.get('/:id/sync-history', authMiddleware as never, async (c) => {
    const clawId = Number(c.req.param('id'));
    const tenantId = (c as unknown as { get: (k: string) => unknown }).get('tenantId') as number;

    const rows = await db
      .select({
        id:          clawSyncHistory.id,
        triggeredBy: clawSyncHistory.triggeredBy,
        fileCount:   clawSyncHistory.fileCount,
        bytesTotal:  clawSyncHistory.bytesTotal,
        status:      clawSyncHistory.status,
        errorMsg:    clawSyncHistory.errorMsg,
        createdAt:   clawSyncHistory.createdAt,
      })
      .from(clawSyncHistory)
      .where(and(
        eq(clawSyncHistory.clawId, clawId),
        eq(clawSyncHistory.tenantId, tenantId),
      ))
      .orderBy(desc(clawSyncHistory.createdAt))
      .limit(20);

    return c.json({ history: rows });
  });

  // GET /api/claws/:id/executions – history of executions run by this claw
  router.get('/:id/executions', authMiddleware as never, async (c) => {
    const clawId = Number(c.req.param('id'));
    const tenantId = c.get('tenantId') as number;
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);

    // Ensure the claw belongs to this tenant
    const claw = await clawService.getClawForTenant(clawId, tenantId);
    if (!claw) return c.json({ error: 'Claw not found' }, 404);

    const rows = await db
      .select({
        id:          executions.id,
        taskId:      executions.taskId,
        agentId:     executions.agentId,
        clawId:      executions.clawId,
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
      .where(and(eq(executions.clawId, clawId), eq(executions.tenantId, tenantId)))
      .orderBy(desc(executions.createdAt))
      .limit(limit);

    return c.json({ clawId, executions: rows });
  });

  // GET /api/claws/:id/skills – merged skill assignments (tenant + claw)
  // Accepts claw API key (Bearer or ?key=) OR tenant JWT.
  router.get('/:id/skills', async (c) => {
    const clawId = Number(c.req.param('id'));
    let tenantId: number;

    const clawFromKey = await verifyClawApiKey(clawId, extractClawKey(c));
    if (clawFromKey) {
      tenantId = clawFromKey.tenantId;
    } else {
      await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
    }

    // Ensure claw belongs to this tenant
    const claw = await clawService.getClawForTenant(clawId, tenantId);
    if (!claw) return c.json({ error: 'Claw not found' }, 404);

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

    const clawSkills = await db
      .select({
        skillSlug:  clawSkillAssignments.skillSlug,
        assignedBy: clawSkillAssignments.assignedBy,
        assignedAt: clawSkillAssignments.assignedAt,
        skillName:  marketplaceSkills.name,
        skillDesc:  marketplaceSkills.description,
        skillIcon:  marketplaceSkills.iconUrl,
        skillVer:   marketplaceSkills.version,
      })
      .from(clawSkillAssignments)
      .leftJoin(marketplaceSkills, eq(clawSkillAssignments.skillSlug, marketplaceSkills.slug))
      .where(eq(clawSkillAssignments.clawId, clawId));

    const merged = new Map<string, Record<string, unknown>>();
    tenantSkills.forEach((row) => merged.set(row.skillSlug, { ...row, source: 'tenant' }));
    clawSkills.forEach((row) => merged.set(row.skillSlug, { ...row, source: 'claw' }));

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

    return c.json({ clawId, skills });
  });

  // GET /api/claws/:id/sessions – list chat sessions for this claw
  router.get('/:id/sessions', authMiddleware as never, async (c) => {
    const clawId  = Number(c.req.param('id'));
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
        eq(chatSessions.clawId, clawId),
        eq(chatSessions.tenantId, tenantId),
      ))
      .orderBy(desc(chatSessions.lastMsgAt))
      .limit(limit);

    return c.json({ sessions: rows });
  });

  // GET /api/claws/:id/cron – list cron jobs for this claw
  // Accepts claw API key (Bearer or ?key=) OR tenant JWT.
  router.get('/:id/cron', async (c) => {
    const clawId = Number(c.req.param('id'));
    let tenantId: number;

    const clawFromKey = await verifyClawApiKey(clawId, extractClawKey(c));
    if (clawFromKey) {
      tenantId = clawFromKey.tenantId;
    } else {
      await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
    }

    const projectIdParam = c.req.query('projectId');

    const conditions = [eq(cronJobs.tenantId, tenantId), eq(cronJobs.clawId, clawId)];
    if (projectIdParam) conditions.push(eq(cronJobs.projectId, Number(projectIdParam)));

    const rows = await db
      .select()
      .from(cronJobs)
      .where(and(...conditions))
      .orderBy(desc(cronJobs.createdAt));
    return c.json({ jobs: rows });
  });

  // POST /api/claws/:id/cron – create a cron job
  router.post('/:id/cron', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId   = Number(c.req.param('id'));
    const body = await c.req.json<{
      id?: string;
      name: string;
      schedule: string;
      taskId?: number | null;
      projectId?: number | null;
      enabled?: boolean;
    }>();
    if (!body.name?.trim() || !body.schedule?.trim()) {
      return c.json({ error: 'name and schedule are required' }, 400);
    }
    const insertData = {
      tenantId,
      clawId,
      name: body.name.trim(),
      schedule: body.schedule.trim(),
      taskId: body.taskId ?? null,
      projectId: body.projectId ?? null,
      enabled: body.enabled ?? true,
      ...(body.id ? { id: body.id } : {}),
    };

    const [inserted] = await db.insert(cronJobs).values(insertData).returning();
    return c.json(inserted, 201);
  });

  // PATCH /api/claws/:id/cron/:jobId – update a cron job
  // Accepts claw API key (Bearer or ?key=) OR tenant JWT so the cron poller
  // can patch lastRunAt / lastStatus after each job fires.
  router.patch('/:id/cron/:jobId', async (c) => {
    const clawId = Number(c.req.param('id'));
    let tenantId: number;

    const clawFromKey = await verifyClawApiKey(clawId, extractClawKey(c));
    if (clawFromKey) {
      tenantId = clawFromKey.tenantId;
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
      .where(and(eq(cronJobs.id, jobId), eq(cronJobs.tenantId, tenantId), eq(cronJobs.clawId, clawId)))
      .returning();
    if (!updated) return c.json({ error: 'Not found' }, 404);
    return c.json(updated);
  });

  // DELETE /api/claws/:id/cron/:jobId – delete a cron job
  router.delete('/:id/cron/:jobId', authMiddleware as never, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId   = Number(c.req.param('id'));
    const jobId    = c.req.param('jobId');
    await db.delete(cronJobs).where(and(eq(cronJobs.id, jobId), eq(cronJobs.tenantId, tenantId), eq(cronJobs.clawId, clawId)));
    return c.body(null, 204);
  });

  // GET /api/claws/:id/channels – list connected channels for this claw (stub)
  router.get('/:id/channels', authMiddleware as never, async (c) => {
    return c.json({ channels: [] });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/claws/:id/capabilities – update declared capabilities (SPA)
  // P2-3: Allows portal users to configure desired capabilities per claw.
  // -------------------------------------------------------------------------
  router.patch('/:id/capabilities', authMiddleware as never, async (c) => {
    const tenantId = (c as unknown as { get: (k: string) => unknown }).get('tenantId') as number;
    const clawId = Number(c.req.param('id'));

    const body = await c.req.json<{ declaredCapabilities: string[] }>();
    if (!Array.isArray(body.declaredCapabilities)) {
      return c.json({ error: 'declaredCapabilities must be an array' }, 400);
    }

    const caps = body.declaredCapabilities.filter((v) => typeof v === 'string');
    await db
      .update(coderclawInstances)
      .set({ declaredCapabilities: JSON.stringify(caps) })
      .where(and(eq(coderclawInstances.id, clawId), eq(coderclawInstances.tenantId, tenantId)));

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/claws/:id/heartbeat – claw keepalive, updates lastSeenAt
  // Called periodically by ClawLinkRelayService via HTTP alongside the WS.
  // Authentication: API key via ?key= query param (same as upstream WS).
  // -------------------------------------------------------------------------
  router.patch('/:id/heartbeat', async (c) => {
    const id  = Number(c.req.param('id'));
    const key = extractClawKey(c);

    const claw = await verifyClawApiKey(id, key);
    if (!claw) return c.text('Unauthorized', 401);

    // Accept optional capabilities array from request body
    let capabilitiesJson: string | undefined;
    let machineProfile: ClawMachineProfileInput | null = null;
    try {
      const body = await c.req.json<{ capabilities?: string[]; machineProfile?: ClawMachineProfileInput }>();
      if (Array.isArray(body.capabilities)) {
        const caps = body.capabilities.filter((v) => typeof v === 'string');
        capabilitiesJson = JSON.stringify(caps);
      }
      machineProfile = normalizeMachineProfile(body.machineProfile);
    } catch { /* body may be empty — fine */ }

    await db
      .update(coderclawInstances)
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
      .where(eq(coderclawInstances.id, id));

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/claws/:id/status – connection status (no auth required for polling)
  // -------------------------------------------------------------------------
  router.get('/:id/status', async (c) => {
    const id = Number(c.req.param('id'));
    const [row] = await db
      .select({ connectedAt: coderclawInstances.connectedAt })
      .from(coderclawInstances)
      .where(eq(coderclawInstances.id, id));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ connected: row.connectedAt !== null, connectedAt: row.connectedAt });
  });

  // -------------------------------------------------------------------------
  // GET /api/claws/:id/ws – browser client connects to claw relay
  // Requires tenant JWT (passed via ?token= since WS upgrades can't set headers
  // in all browsers)
  // -------------------------------------------------------------------------
  router.get('/:id/ws', async (c) => {
    const id  = Number(c.req.param('id'));
    const env = c.env;

    if (!env.CLAW_RELAY) return c.text('CLAW_RELAY binding not configured', 503);

    // The browser connects via WebSocket and cannot reliably set Authorization headers,
    // so we accept the JWT via ?token= as used by the UI.
    const token = c.req.header('Authorization')?.startsWith('Bearer ')
      ? c.req.header('Authorization')?.slice(7)
      : c.req.query('token');
    if (!token) return c.text('Unauthorized', 401);

    // Verify tenant JWT and ensure it matches the claw's tenant.
    let payload;
    try {
      payload = await verifyJwt(token, c.env.JWT_SECRET);
    } catch {
      return c.text('Unauthorized', 401);
    }

    const [claw] = await db
      .select({ id: coderclawInstances.id, tenantId: coderclawInstances.tenantId })
      .from(coderclawInstances)
      .where(eq(coderclawInstances.id, id));
    if (!claw) return c.text('Not found', 404);
    if (payload.tid !== claw.tenantId) return c.text('Unauthorized', 401);

    const stub = env.CLAW_RELAY.get(env.CLAW_RELAY.idFromName(String(id)));
    const url  = new URL(c.req.url);
    url.searchParams.set('role', 'client');
    return stub.fetch(new Request(url.toString(), c.req.raw));
  });

  // -------------------------------------------------------------------------
  // GET /api/claws/:id/upstream – CoderClaw instance connects (API key auth)
  // Accepts Authorization: Bearer <key> header (preferred) or legacy ?key= param.
  // -------------------------------------------------------------------------
  router.get('/:id/upstream', async (c) => {
    const id  = Number(c.req.param('id'));
    const env = c.env;
    const key = extractClawKey(c);

    if (!env.CLAW_RELAY) return c.text('CLAW_RELAY binding not configured', 503);
    if (!key) return c.text('Unauthorized', 401);

    const claw = await verifyClawApiKey(id, key);
    if (!claw) return c.text('Unauthorized', 401);

    // Mark as connected
    await db
      .update(coderclawInstances)
      .set({ connectedAt: new Date(), lastSeenAt: new Date() })
      .where(eq(coderclawInstances.id, id));

    const stub = env.CLAW_RELAY.get(env.CLAW_RELAY.idFromName(String(id)));
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
        .update(coderclawInstances)
        .set({ connectedAt: null })
        .where(eq(coderclawInstances.id, id));
    });

    return response;
  });

  // -------------------------------------------------------------------------
  // POST /api/claws/:id/forward?from=<sourceClawId>&key=<sourceClawApiKey>
  // Claw-to-claw task delegation: source claw dispatches a payload to target
  // claw via the ClawRelayDO dispatch mechanism.
  // The source claw authenticates with its OWN API key (not the target's key).
  // Both claws must belong to the same tenant.
  // Accepts optional correlationId for remote task result tracking (P0-1).
  // -------------------------------------------------------------------------
  router.post('/:id/forward', async (c) => {
    const targetId = Number(c.req.param('id'));
    const fromId   = extractFromId(c);
    const key      = extractClawKey(c);
    const env      = c.env;

    if (!env.CLAW_RELAY) return c.text('CLAW_RELAY binding not configured', 503);

    if (Number.isNaN(fromId) || fromId <= 0) {
      return c.json({ error: 'from parameter or X-Claw-From header (source claw id) is required' }, 400);
    }

    // Authenticate the calling (source) claw
    const sourceClaw = await verifyClawApiKey(fromId, key);
    if (!sourceClaw) return c.text('Unauthorized', 401);

    // Ensure target is in same tenant
    const [targetClaw] = await db
      .select({ id: coderclawInstances.id, connectedAt: coderclawInstances.connectedAt })
      .from(coderclawInstances)
      .where(and(
        eq(coderclawInstances.id, targetId),
        eq(coderclawInstances.tenantId, sourceClaw.tenantId),
      ));

    if (!targetClaw) return c.json({ error: 'Target claw not found in tenant' }, 404);

    // Read body as text so we can verify the HMAC signature before parsing.
    // X-Claw-Signature: sha256=<hex> — signed by the source claw using its raw API key.
    // If absent (older claws), we skip verification for backward compat.
    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }

    const sigOk = await verifyClawSignature(key ?? '', rawBody, c.req.header('X-Claw-Signature'));
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

    // Inject fromClawId so the target knows where to send the remote.result
    const enrichedPayload = { ...payload, fromClawId: fromId };

    // Forward to target claw via ClawRelayDO /dispatch endpoint
    const stub = env.CLAW_RELAY.get(env.CLAW_RELAY.idFromName(String(targetId)));
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
  // POST /api/claws/:id/relay-result?key=<clawApiKey>
  // P0-1: Target claw posts a remote.result frame; this endpoint forwards it
  // to the source claw's relay WebSocket so its pending promise can resolve.
  // Authentication: the TARGET claw's API key (the one that executed the task).
  // -------------------------------------------------------------------------
  router.post('/:id/relay-result', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);
    const env    = c.env;

    if (!env.CLAW_RELAY) return c.text('CLAW_RELAY binding not configured', 503);

    const claw = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    // Dispatch the remote.result into the SOURCE claw's relay (identified by clawId param)
    const stub = env.CLAW_RELAY.get(env.CLAW_RELAY.idFromName(String(clawId)));
    const result = await stub.fetch(new Request('https://internal/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));

    return result;
  });

  // -------------------------------------------------------------------------
  // POST /api/claws/:id/usage-snapshot?key=<clawApiKey>
  // P2-2: Claw posts context window / token usage snapshot for persistence.
  // -------------------------------------------------------------------------
  router.post('/:id/usage-snapshot', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);

    const claw = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

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
      tenantId:         claw.tenantId,
      clawId,
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
  // GET /api/claws/:id/tool-audit?runId=&sessionKey=&limit=
  // Returns tool audit events for a claw, filterable by runId or sessionKey.
  // -------------------------------------------------------------------------
  router.get('/:id/tool-audit', authMiddleware as never, async (c) => {
    const clawId   = Number(c.req.param('id'));
    const tenantId = (c as unknown as { get: (k: string) => unknown }).get('tenantId') as number;
    const runId    = c.req.query('runId');
    const sessKey  = c.req.query('sessionKey');
    const limit    = Math.min(Number(c.req.query('limit') ?? 200), 500);

    const conditions = [
      eq(toolAuditEvents.clawId,    clawId),
      eq(toolAuditEvents.tenantId,  tenantId),
      ...(runId   ? [eq(toolAuditEvents.runId,       runId)]   : []),
      ...(sessKey ? [eq(toolAuditEvents.sessionKey,  sessKey)] : []),
    ];

    const rows = await db
      .select({
        id:         toolAuditEvents.id,
        runId:      toolAuditEvents.runId,
        sessionKey: toolAuditEvents.sessionKey,
        toolCallId: toolAuditEvents.toolCallId,
        toolName:   toolAuditEvents.toolName,
        category:   toolAuditEvents.category,
        args:       toolAuditEvents.args,
        result:     toolAuditEvents.result,
        durationMs: toolAuditEvents.durationMs,
        ts:         toolAuditEvents.ts,
      })
      .from(toolAuditEvents)
      .where(and(...conditions))
      .orderBy(toolAuditEvents.ts)
      .limit(limit);

    return c.json({ events: rows });
  });

  // -------------------------------------------------------------------------
  // POST /api/claws/:id/tool-audit?key=<clawApiKey>
  // P2-4: Claw posts a tool call audit event for persistence.
  // -------------------------------------------------------------------------
  router.post('/:id/tool-audit', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);

    const claw = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      runId?:       string;
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
      tenantId:    claw.tenantId,
      clawId,
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
  // POST /api/claws/:id/approval-request?key=<clawApiKey>
  // P3-3: Claw creates a pending approval for a destructive/high-risk action.
  // -------------------------------------------------------------------------
  router.post('/:id/approval-request', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);
    const env    = c.env;

    const claw = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      actionType?:  string;
      description?: string;
      metadata?:    unknown;
      expiresAt?:   string;
      requestedBy?: string;
    }>();

    if (!body.actionType || !body.description) {
      return c.json({ error: 'actionType and description are required' }, 400);
    }

    const approvalId = crypto.randomUUID();
    await db.insert(approvals).values({
      id:          approvalId,
      tenantId:    claw.tenantId,
      clawId,
      requestedBy: body.requestedBy ?? String(clawId),
      actionType:  body.actionType,
      description: body.description,
      metadata:    body.metadata != null ? JSON.stringify(body.metadata) : null,
      expiresAt:   body.expiresAt ? new Date(body.expiresAt) : null,
    });

    // Notify connected browser clients via the relay
    if (env.CLAW_RELAY) {
      const stub = env.CLAW_RELAY.get(env.CLAW_RELAY.idFromName(String(clawId)));
      stub.fetch(new Request('https://internal/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approval.request',
          approvalId,
          actionType:  body.actionType,
          description: body.description,
          expiresAt:   body.expiresAt,
        }),
      })).catch(() => { /* best-effort */ });
    }

    return c.json({ ok: true, approvalId }, 201);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/claws/:id/executions/:eid/state
  // Claw callback: update execution lifecycle state after task.assign dispatch.
  // Reports running → completed / failed back to the executions table so the
  // portal reflects live task status without requiring a tenant JWT.
  // -------------------------------------------------------------------------
  router.patch('/:id/executions/:eid/state', async (c) => {
    const clawId      = Number(c.req.param('id'));
    const executionId = Number(c.req.param('eid'));
    const key         = extractClawKey(c);

    const claw = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

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
      .where(and(eq(executions.id, executionId), eq(executions.clawId, clawId)));

    const [row] = await db
      .select()
      .from(executions)
      .where(and(eq(executions.id, executionId), eq(executions.clawId, clawId)));
    if (!row) return c.json({ error: 'Execution not found' }, 404);
    return c.json(row);
  });

  // -------------------------------------------------------------------------
  // GET /api/claws/:id/spec
  // Claw-auth: returns the active (approved or in_progress) spec for this
  // claw's primary project. Used by CoderClaw to pull planning context.
  // -------------------------------------------------------------------------
  router.get('/:id/spec', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);
    const claw   = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    const [assignment] = await db
      .select({ projectId: clawProjects.projectId })
      .from(clawProjects)
      .where(and(eq(clawProjects.clawId, clawId), eq(clawProjects.tenantId, Number(claw.tenantId))))
      .limit(1);

    if (!assignment) return c.json({ spec: null });

    const [spec] = await db
      .select()
      .from(specs)
      .where(
        and(
          eq(specs.projectId, assignment.projectId),
          eq(specs.tenantId, Number(claw.tenantId)),
          inArray(specs.status, ['approved', 'in_progress']),
        ),
      )
      .orderBy(desc(specs.updatedAt))
      .limit(1);

    return c.json({ spec: spec ?? null });
  });

  // -------------------------------------------------------------------------
  // GET /api/claws/:id/platform-personas
  // Claw-auth: returns all active admin-managed platform personas.
  // -------------------------------------------------------------------------
  router.get('/:id/platform-personas', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);
    const claw   = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    const rows = await db
      .select()
      .from(platformPersonas)
      .where(eq(platformPersonas.active, true))
      .orderBy(platformPersonas.name);

    return c.json({ personas: rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/claws/:id/quota
  // Claw-auth: returns token usage totals for this claw over the last 30 days.
  // -------------------------------------------------------------------------
  router.get('/:id/quota', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);
    const claw   = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        inputTokens:  usageSnapshots.inputTokens,
        outputTokens: usageSnapshots.outputTokens,
      })
      .from(usageSnapshots)
      .where(and(eq(usageSnapshots.clawId, clawId), gte(usageSnapshots.ts, since)));

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
  // PATCH /api/claws/:id/project-context
  // Claw-auth: push local project governance/architecture context to the
  // project record in Builderforce so the portal and other claws can read it.
  // -------------------------------------------------------------------------
  router.patch('/:id/project-context', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);
    const claw   = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    const body = await c.req.json<{ projectId?: number; governance?: string }>();

    let projectId = body.projectId;
    if (!projectId) {
      const [assignment] = await db
        .select({ projectId: clawProjects.projectId })
        .from(clawProjects)
        .where(and(eq(clawProjects.clawId, clawId), eq(clawProjects.tenantId, Number(claw.tenantId))))
        .limit(1);
      projectId = assignment?.projectId;
    }

    if (!projectId) return c.json({ error: 'No project assigned to this claw' }, 404);
    if (!body.governance) return c.json({ error: 'governance field is required' }, 400);

    await db
      .update(projects)
      .set({ governance: body.governance, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, Number(claw.tenantId))));

    return c.json({ ok: true, projectId });
  });

  // -------------------------------------------------------------------------
  // GET /api/claws/:id/artifacts/resolve
  // Claw-auth: resolve effective artifact set for this claw's context.
  // Query params: taskId?, projectId?
  // -------------------------------------------------------------------------
  router.get('/:id/artifacts/resolve', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);
    const claw   = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    const taskIdP    = c.req.query('taskId');
    const projectIdP = c.req.query('projectId');

    // Default to claw's primary project if no projectId given
    let projectId = projectIdP ? Number(projectIdP) : undefined;
    if (!projectId) {
      const [assignment] = await db
        .select({ projectId: clawProjects.projectId })
        .from(clawProjects)
        .where(and(eq(clawProjects.clawId, clawId), eq(clawProjects.tenantId, Number(claw.tenantId))))
        .limit(1);
      projectId = assignment?.projectId;
    }

    const resolved = await resolveArtifacts(db, {
      tenantId:  Number(claw.tenantId),
      taskId:    taskIdP ? Number(taskIdP) : undefined,
      clawId,
      projectId,
    });
    return c.json(resolved);
  });

  // -------------------------------------------------------------------------
  // PUT /api/claws/:id/personas
  // Claw-auth: register this claw's local custom role definitions so the
  // portal can display what agent personas are available.
  // -------------------------------------------------------------------------
  router.put('/:id/personas', async (c) => {
    const clawId = Number(c.req.param('id'));
    const key    = extractClawKey(c);
    const claw   = await verifyClawApiKey(clawId, key);
    if (!claw) return c.text('Unauthorized', 401);

    const body = await c.req.json<{ personas: unknown[] }>();
    if (!Array.isArray(body.personas)) {
      return c.json({ error: 'personas must be an array' }, 400);
    }

    await db
      .update(coderclawInstances)
      .set({ localPersonas: JSON.stringify(body.personas), updatedAt: new Date() })
      .where(eq(coderclawInstances.id, clawId));

    return c.json({ ok: true, count: body.personas.length });
  });

  return router;
}
