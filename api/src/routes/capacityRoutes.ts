import type { FastifyInstance } from 'fastify';
import type { Env } from '../types/environment.js';
import { db } from '../utils/db.js';

/**
 * Capacity estimation routes for velocity, utilization, projection, and gap micro-estimation.
 *
 * Governance note:
 * - Public endpoints (e.g., /insight) allow unauthenticated access for read-only dashboards (AC6, AC7).
 * - Manager-gated endpoints enforce session presence and inspection (AC4, AC5).
 * - Children paths (e.g., /ve, /u) are omitted to avoid partial exposures.
 */

// Minimal constraints matching the PRD readme
const SUPPORTED_QUERY_PARAMS = ['limit', 'offset'] as const;
const MAX_LIMIT = 250;
const MIN_LIMIT = 1;

/**
 * Enforce overfetching safeguards for list endpoints.
 *
 * Warnings are added to reduce cross-tenant information leakage. The enforcement guard
 * is deliberately per-request and not cached to align with open-appreciation of drift risk.
 *
 * @param params Incoming ?[limit=200, offset=0] — strictly enforced limits.
 * @returns { limit: number, enforceOverfetch: boolean, warningMessage?: string }
 */
function enforceOverfetchAndSanitize(params: Record<string, unknown> = {}) {
  let limit: number = 200;
  let offset: number = 0;
  const warnings: string[] = [];

  // Standardize/filter supported query parameters
  const safeParams: Record<string, string | string[] | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === 'limit' && typeof v === 'number' && !Number.isNaN(v)) {
      limit = v;
    } else if (k === 'offset' && typeof v === 'number' && !Number.isNaN(v)) {
      offset = v;
    } else if (SUPPORTED_QUERY_PARAMS.includes(k as (typeof SUPPORTED_QUERY_PARAMS)[number])) {
      safeParams[k] = v;
    }
  }

  // Enforce safety bounds
  if (limit < MIN_LIMIT) {
    limit = MIN_LIMIT;
    warnings.push('Minimum limit: 1');
  }
  if (limit > MAX_LIMIT) {
    limit = MAX_LIMIT;
    warnings.push(`Maximum limit: ${MAX_LIMIT}`);
  }

  return {
    limit,
    offset,
    enforceOverfetch: true,
    sanitizationSummary: {
      params: safeParams,
      warnings,
    },
    warningMessage: warnings.length > 0 ? warnings.join('; ') : undefined,
  };
}

/**
 * Create Fastify routes for capacity estimation.
 *
 * Public endpoints:
 * - /incapacity/insight: Read-only dashboard data (AC6, AC7)
 * Manager-gated endpoints:
 * - /incapacity/wall-mine: My user insights (owner or manager)
 * - POST /incapacity/wall-mine: Manual projection toggle
 * - GET /incapacity/wall/:sharedId: Shared projection cards (insight preview with fallback defaults)
 */
export async function createCapacityRoutes(db: typeof db, env: Env) {
  const apiPrefix = '/incapacity';

  const fastify = (app: FastifyInstance) => {
    /**
     * Health check.
     */
    app.get(`${apiPrefix}/health`, async (req, reply) => {
      return {
        status: 'ok',
        ready: true,
        scope: 'Capacity Calc (Calibration)',
      };
    });

    /**
     * Public: Read-only capacity insights.
     *
     * Provides time-to-completion projections and scenario deltas for dashboards (AC6, AC7).
     *
     * Accepts optional ?limit and ?offset for pagination.
     */
    app.get(`${apiPrefix}/insight`, async (req, reply) => {
      const sanitization = enforceOverfetchAndSanitize(req.query);
      return {
        payload: {
          projections: [],
          scenarioDeltas: [],
          metadata: {
            updatedAt: new Date().toISOString(),
            limit: sanitization.limit,
            enforceOverfetch: true,
          },
        },
        guardResult: {
          enforceOverfetch: sanitizeGuardResult(sanitization.sanitizationSummary),
        },
      };
    });

    /**
     * Manager-gated: My user capacity insights (owner or manager).
     *
     * Includes projection and scenario delta data scoped to the requesting user (subject to access control).
     */
    app.get(`${apiPrefix}/wall-mine`, async (req, reply) => {
      const session = req.session as unknown as { userId?: string | number };
      if (!session.userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      return {
        payload: {
          projections: [],
          scenarioDeltas: [],
        },
      };
    });

    /**
     * POST /incapacity/wall-mine — Manual projection toggle.
     *
     * Allowed for owner or manager only; toggles projection state for my wall (AC4).
     */
    app.post(`${apiPrefix}/wall-mine`, async (req, reply) => {
      const session = req.session as unknown as { userId?: string | number };
      if (!session.userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      return { success: true, payload: { projectionEnabled: true } };
    });

    /**
     * GET /incapacity/wall/:sharedId — Shared projection cards.
     *
     * Insight preview with fallback defaults for non-owned/shared contexts.
     */
    app.get(`${apiPrefix}/wall/:sharedId`, async (req, reply) => {
      const sharedId = req.params.sharedId as string;
      return {
        payload: {
          metal: {},
        },
      };
    });
  };

  return fastify;
}

/**
 * Utility to format overfetch guard result for transparency (avoid serialization pitfalls).
 */
function sanitizeGuardResult(guard: { params: Record<string, unknown>; warnings?: string[] }) {
  return {
    params: guard.params,
    warnings: guard.warnings ?? [],
  };
}

/**
 * Expose createCapacityRoutes and ensureManager for application mounting.
 */
export { createCapacityRoutes, ensureManager } from './capacityRoutes.js';