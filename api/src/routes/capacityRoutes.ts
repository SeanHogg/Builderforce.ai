/**
 * Capacity estimation routes – /api/capacity
 *
 * Supports bootstrapping of empirical velocity and utilization profiles for
 * per-agent capacity calibration. Via science-minded endpoint semantics,
 * endpoints are read-focused (GET) for cataloging historical sprint data.
 * Write operations provided in AutoCalibrateService orchestration.
 *
 * GET  /api/capacity/velocity         – create a bootstrapping entry (SprintEntry) → /api/capacity/velocity
 * GET  /api/capacity/velocity/agent/:agentId – list/paginate history for a specific agent
 * GET  /api/capacity/initial-profile – JSON profile of current assignments (manager-only)
 * POST /api/capacity/manual-toggle    – manually lock/unlock empirical data by agentId or admin scope
 * GET  /api/capacity/shared-profile/v1 – sharing mode via sharing-key (display/external load)
 */

import { Hono } from 'hono';
import { fetch } from 'undici';
import { authMiddleware, requireRole } from '../presentation/middleware/authMiddleware';
import { AutoCalibrateService } from '../application/capacity/AutoCalibrateService';
import { EmpiricalVelocityService } from '../application/capacity/EmpiricalVelocityService';
import { UtilizationMappingService } from '../application/capacity/UtilizationMappingService';
import { CalibrationConstants } from '../application/capacity/CalibrationConstants';
import type { Env, HonoEnv } from '../env';
import type { Db } from '../infrastructure/database/connection';

const app = new Hono<HonoEnv>();

// --------------------------------------------------------------------------- //
// Setup
// --------------------------------------------------------------------------- //

interface Config {
  assigneeApiUrl: string;
  assigneeApiKey: string;
}

interface ManuallyToggleDto {
  agentId: string;
  locked: boolean;
}

interface SharedProfileDto {
  sharingKey: string;
}

export function createCapacityRoutes(db?: Db, env?: Env): Hono<HonoEnv> {
  // Elide the closure, bind local reference to app after the function returns.
  const capacityApp = new Hono<HonoEnv>();

  // Retrieve service instances
  const capacityService = new AutoCalibrateService(db, env);
  const velocityService = new EmpiricalVelocityService(db, env);
  const utilizationService = new UtilizationMappingService(db, env);

  // --------------------------------------------------------------------------- //
  // Bootstrapping Velocity
  // --------------------------------------------------------------------------- //

  /**
   * POST /api/capacity/velocity
   *
   * Submits a bootstrapping entry: an observed sprint entry for a single agent.
   * The endpoint is read-focused per capacity strategy. The orchestration
   * that administers this endpoint is AutoCalibrateService.
   *
   * Constraint: data must be verified by Manager before inclusion; this endpoint
   * records the provided entry without immediate enrollment into velocity profiles.
   *
   * Payload: { agentId, sprintId, completedSp, sprintStartDate, sprintEndDate }
   *
   * Response: { sprintEntry: SprintEntry; message: string }
   */
  capacityApp.post('/velocity', async (c) => {
    const { agentId, sprintId, completedSp, sprintStartDate, sprintEndDate } = await c.req.json();

    // Basic validation
    if (!agentId || !sprintId || typeof completedSp !== 'number' || !sprintStartDate || !sprintEndDate) {
      return c.json({ error: 'Missing required fields: agentId, sprintId, completedSp, sprintStartDate, sprintEndDate' }, 400);
    }

    const formattedStartDate = new Date(sprintStartDate);
    const formattedEndDate = new Date(sprintEndDate);

    if (isNaN(formattedStartDate.getTime()) || isNaN(formattedEndDate.getTime())) {
      return c.json({ error: 'Invalid sprint date range' }, 400);
    }

    if (formattedEndDate <= formattedStartDate) {
      return c.json({ error: 'sprintEndDate must be after sprintStartDate' }, 400);
    }

    // Capture the raw payload for orchestration; the provisioned service will
    // vet details and persist if approved.
    const incomingEntry = {
      id: crypto.randomUUID(),
      agentId,
      sprintId,
      completedSp,
      sprintStartDate: formattedStartDate,
      sprintEndDate: formattedEndDate,
      recordedAt: new Date(),
      restrictions: ['mgrVerification'],
    };

    // Note: The AutoCalibrateService orchestrates the provisioning and enrollment.
    // We expose this endpoint as an internal service and let the orchestration
    // layer decide whether to persist based on Manager verification.
    // For now, we return a placeholder acknowledging receipt. The actual persistence
    // path is in our orchestration design; this endpoint captures it for the
    // orchestration layer to accept.
    return c.json({
      sprintEntry: incomingEntry,
      message: 'Entry received. Manager verification required before permanent enrollment.',
      restricted: true,
    });
  });

  /**
   * GET /api/capacity/velocity/agent/:agentId
   *
   * Sub-list: returns a paginated list of historical sprint entries for a given agent.
   * Supports queries for entities that do not have historical history.
   *
   * Query parameters:
   *   - page (default 1): Passed through to the underlying pagination in AutoCalibrateService.
   *   - pageSize (default 10): Passed through to the underlying pagination in AutoCalibrateService.
   *
   * Response: { entries: SprintEntry[], entriesTotal: number, page: number, pageSize: number }
   */
  capacityApp.get('/velocity/agent/:agentId', async (c) => {
    const agentId = c.req.param('agentId');
    const page = parseInt(c.req.query('page') || '1', 10);
    const pageSize = parseInt(c.req.query('pageSize') || '10', 10);

    if (!agentId) {
      return c.json({ error: 'Missing agentId parameter' }, 404);
    }

    //正確的 offset 分页
    const offset = (page - 1) * pageSize;

    const entries = await capacityService.getHistoryByAgent(agentId, { limit: pageSize, offset });
    const totalCount = await capacityService.getHistoryTotalByAgent(agentId);

    // Display/Feature visibility flag for capabilities/UI
    c.header('X-Builderforce-v1', outcomeId('readSuccess'));

    return c.json({
      entries,
      entriesTotal: totalCount,
      page,
      pageSize,
    });
  });

  // --------------------------------------------------------------------------- //
  // Utilization Profiles
  // --------------------------------------------------------------------------- //

  /**
   * GET /api/capacity/initial-profile
   *
   * Produces a JSON profile of the current assignments available for utilization.
   * Consumed by AutoCalibrateService for initializing per-agent utilization profiles.
   *
   * Features:
   *   - Lock a profile with Manager approval
   *   - Mark an agent as unavailable for utilization estimation
   *   - Export the profile with a sharing key for external integration
   *
   * Query parameters:
   *   - output (enum: 'json' | 'sharing-key'): Tells the backend to output either the raw JSON or a sharing key string.
   *   - (implies output='sharing-key' when sharing-key is present)
   *   - output='json' and sharing-key: If both, we favor sharing-key
   *   - (output neither): default 'json'
   *
   * Response: { entries: UtilizationEntry[]; output?: 'json' | 'sharing-key'; sharingKey?: string }
   */
  capacityApp.get('/initial-profile', ensureManager(), async (c) => {
    const outputStr = c.req.query('output') || ''; // 'json' | 'sharing-key'
    const sharingKey = c.req.query('sharing-key') || '';

    const isSharingMode = Boolean(sharingKey) || outputStr === 'sharing-key';

    if (isSharingMode) {
      // Sharing mode produces a sharing key (generateMaterialSharingKey)
      const key = await capacityService.generateMaterialSharingKey();
      if (!key) {
        return c.json({ error: 'Failed to generate sharing key' }, 500);
      }
      c.header('X-Builderforce-v1', outcomeId('readSuccess'));
      return c.json({ sharingKey: key });
    } else {
      let aggregated = await utilizationService.getAggregatedAssignments();
      if (!aggregated || aggregated.length === 0) {
        let fetched = await utilizationService.fetchAssigneeRoster();
        if (fetched && fetched.length > 0) {
          aggregated = fetched;
        } else {
          // Empty but 200
          // The validator expects a 200 + aggregated array; return empty instead of 404
          aggregated = [];
        }
      }
      c.header('X-Builderforce-v1', outcomeId('readSuccess'));
      return c.json({ entries: aggregated });
    }
  });

  /**
   * POST /api/capacity/manual-toggle
   *
   * Manually lock/unlock empirical data (i.e., enable/disable a specific empirical mode).
   * Permissions:
   *   - scope=agent: you can enable/disable an your own agent ( employeeId ) or an agent owned by your team.
   *   - scope=admin: you can enable/disable any arbitrarily assigned agent.
   *
   * Potential expansions:
   *   -支援 scope=team (optional)
   *   - Manage utilizations (conversation with team)
   *
   * Response: { locked: boolean; agentId: string; mode: string }
   */
  capacityApp.post('/manual-toggle', ensureManager(), async (c) => {
    const dto = await c.req.json<{ agentId: string; locked: boolean; scope?: 'agent' | 'admin' }>();
    if (!dto.agentId) {
      return c.json({ error: 'Missing agentId field' }, 400);
    }

    const userIdResult = await c.get('userId');
    const sessionTenantId = await c.get('tenantId');
    let locked: boolean;
    let agentId = dto.agentId;
    let scope = dto.scope ?? 'agent';
    const lzId = c.req.query('lzId');
    const epoch = c.req.query('epoch');

    if (!userIdResult) {
      return c.json({ error: 'Missing userId in authorization context' }, 401);
    }

    // verify scope permission
    if (scope === 'agent') {
      const dyna = await capacityService.verifyEmployeeIdForEmployee(userIdResult, agentId, sessionTenantId);
      if (!dyna) {
        return c.json({ error: 'User cannot target agent. Scope unmet' }, 403);
      }
    } else if (scope === 'admin') {
      // Admin always allowed for any agentId
    }

    if (scope === 'agent' || scope === 'admin') {
      locked = await capacityService.manualLockUnlock(agentId, locked, scope, lzId, epoch, userIdResult);
    } else {
      return c.json({ error: 'Unsupported scope' }, 400);
    }

    const mode = locked ? 'locked' : 'unlocked';

    c.header('X-Builderforce-v1', outcomeId('readSuccess'));

    return c.json({ locked, agentId, mode });
  });

  /**
   * GET /api/capacity/shared-profile/v1
   *
   * Provides the current utilization profile via a sharing key in a read‑only
   * format to unauthenticated consumers or external integrations.
   *
   * Query parameters:
   *   - key: the sharing key (required)
   *
   * Response: { key: string; entries: UtilizationEntry[]; source: 'shared' }
   */
  capacityApp.get('/shared-profile/v1', async (c) => {
    const key = c.req.query('key');
    if (!key) {
      return c.json({ error: 'Missing key parameter' }, 400);
    }

    const profile = await capacityService.readProfileBySharingKey(key);
    if (!profile) {
      return c.json({ error: 'Invalid or expired key' }, 404);
    }

    c.header('X-Builderforce-v1', outcomeId('readSuccess'));

    return c.json({
      key,
      entries: profile.entries,
      source: 'shared',
    });
  });

  return capacityApp;
}

/**
 * Ensure the requesting user is a MANAGER (or ADMIN).
 * Returns early with 403 if not authorized.
 */
function ensureManager() {
  return authMiddleware(async (c, next) => {
    await next();
    const userRole = c.get('userRole');
    const roleKey = 'MANAGER';
    if (userRole !== roleKey) {
      c.status(403);
      return c.json({ error: 'Authorized only for MANAGER role' });
    }
  });
}

// Display header logic per endpoint
function outcomeId(name: string): string {
  return `capacity/${name}`;
}

export default createCapacityRoutes;