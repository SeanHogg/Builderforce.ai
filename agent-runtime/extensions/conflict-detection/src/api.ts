/**
 * Conflict Detection API Layer
 *
 * Implements PRD requirements:
 * - POST /conflicts/detect — Trigger conflict detection
 * - GET /conflicts — List conflicts from priority register (by status filter)
 * - GET /conflicts/:id — Get specific alert
 * - POST /conflicts/:id/resolve — Manual resolution by conflict resolver
 * - GET /conflicts/health, GET /conflicts/rule
 *
 * All endpoints documented in OpenAPI spec.
 */

import { z } from 'zod';
import {
  conflictDetectionService,
  ConflictDetectionService,
} from './conflict-detector.service.js';
import { CONFLICT_RULE_SPEC } from './conflict-rule.spec.js';

/**
 * Validation Schemas — Zod
 */
export const schemas = {
  detectConflicts: {
    body: z.object({
      requests: z
        .array(
          z.object({
            id: z.string().min(1).describe('Unique request identifier'),
            title: z.string().min(1).describe('Request title'),
            description: z.string().optional().describe('Request description'),
            priority: z
              .enum(['P0', 'P1', 'P2', 'P3'])
              .describe('Priority level — P0 is highest'),
            stakeholderId: z.string().min(1).describe('Stakeholder unique identifier'),
            stakeholder: z
              .object({
                name: z.string().optional().describe('Stakeholder display name'),
                role: z.string().optional().describe('Stakeholder role (e.g. Product Manager)'),
                email: z.string().email().optional().describe('Stakeholder email'),
              })
              .describe('Stakeholder details'),
            teamId: z.string().min(1).describe('Team unique identifier'),
            team: z
              .object({
                name: z.string().optional().describe('Team display name'),
                organization: z.string().optional().describe('Organization / department'),
              })
              .describe('Team details'),
            versionId: z.string().optional().describe('Priority version identifier (defines review window)'),
            reviewWindowStart: z.string().optional().describe('Review window start (ISO 8601)'),
            reviewWindowEnd: z.string().optional().describe('Review window end (ISO 8601)'),
            createdAt: z.string().describe('Request creation timestamp (ISO 8601)'),
            updatedAt: z.string().optional().describe('Request update timestamp'),
            sourceSystem: z.string().optional().describe('Origin system id'),
          })
        )
        .min(2, 'At least 2 requests required for conflict detection'),
      versionId: z.string().optional().describe('Scope detection to specific priority version / review window'),
      windowThresholdDays: z.number().int().positive().optional().describe('Review window size in days (default 7)'),
    }),
  },

  listConflicts: {
    querystring: z.object({
      status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed', 'all']).optional().describe('Filter by status'),
      versionId: z.string().optional().describe('Filter by priority version'),
      teamId: z.string().optional().describe('Filter by team ID'),
      stakeholderId: z.string().optional().describe('Filter by involved stakeholder ID'),
      severity: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Filter by severity'),
      page: z.coerce.number().int().positive().default(1).optional().describe('Page number (1-indexed)'),
      limit: z.coerce.number().int().positive().max(100).default(20).optional().describe('Items per page'),
    }),
  },

  getConflict: {
    params: z.object({
      id: z.string().min(1).describe('Conflict alert ID (stable key)'),
    }),
  },

  resolveConflict: {
    params: z.object({
      id: z.string().min(1).describe('Conflict alert ID'),
    }),
    body: z.object({
      action: z.enum(['acknowledge', 'resolve', 'dismiss']).describe('Resolution action'),
      note: z.string().max(2000).optional().describe('Resolution/reasoning note from resolver'),
      resolverUserId: z.string().optional().describe('User ID of person resolving'),
    }),
  },
};

/**
 * Fastify-like type helpers — without hard depending on fastify types at runtime
 * Works with both Fastify server and Express-compatible injection
 */
type FastifyRequestGeneric = {
  body?: any;
  query?: any;
  params?: any;
  headers?: Record<string, any>;
};

type FastifyReplyGeneric = {
  code: (status: number) => FastifyReplyGeneric;
  send: (payload: any) => any;
  status?: (code: number) => FastifyReplyGeneric;
};

/**
 * Register conflict detection routes on a Fastify instance
 *
 * Usage:
 *   import { registerConflictDetectionRoutes } from './api.js';
 *   await fastify.register(registerConflictDetectionRoutes);
 */
export async function registerConflictDetectionRoutes(fastify: any) {
  const service = conflictDetectionService;

  // ── POST /conflicts/detect ──────────────────────────────────────────────
  fastify.post('/conflicts/detect', async (request: FastifyRequestGeneric, reply: FastifyReplyGeneric) => {
    try {
      const parsed = schemas.detectConflicts.body.parse(request.body);

      const result = service.detectConflicts({
        requests: parsed.requests as any,
        versionId: parsed.versionId,
        windowThresholdDays: parsed.windowThresholdDays,
      });

      const response = {
        success: result.success,
        conflicts: result.conflicts,
        duplicatesFound: result.duplicatesFound,
        timestamp: new Date().toISOString(),
      };

      if (!result.success) {
        return reply.code(400).send({ ...response, error: result.error });
      }

      // 201 if new alerts created, 200 otherwise (idempotent)
      const statusCode = result.conflicts.length > 0 ? 201 : 200;
      return reply.code(statusCode).send(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
          timestamp: new Date().toISOString(),
        });
      }
      request?.headers && console.error('[conflict-detection] detect error', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Internal error',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── GET /conflicts ──────────────────────────────────────────────────────
  fastify.get('/conflicts', async (request: FastifyRequestGeneric, reply: FastifyReplyGeneric) => {
    try {
      const q = schemas.listConflicts.querystring.parse(request.query);

      const allMatching = service.listConflicts({
        status: q.status,
        versionId: q.versionId,
        teamId: q.teamId,
        stakeholderId: q.stakeholderId,
        severity: q.severity,
      });

      const page = q.page ?? 1;
      const limit = q.limit ?? 20;
      const start = (page - 1) * limit;
      const paged = allMatching.slice(start, start + limit);

      return reply.code(200).send({
        conflicts: paged,
        total: allMatching.length,
        page,
        limit,
        totalPages: Math.ceil(allMatching.length / limit),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  // ── GET /conflicts/rule — rule spec visibility per PRD ─────────────────
  fastify.get('/conflicts/rule', async (_request: FastifyRequestGeneric, reply: FastifyReplyGeneric) => {
    return reply.code(200).send({
      success: true,
      rule: CONFLICT_RULE_SPEC,
      timestamp: new Date().toISOString(),
    });
  });

  // ── GET /conflicts/openapi — expose OpenAPI doc ───────────────────────
  fastify.get('/conflicts/openapi', async (_request: FastifyRequestGeneric, reply: FastifyReplyGeneric) => {
    // Dynamic import to avoid circular
    try {
      const { openApiSpec } = await import('./openapi.js');
      return reply.code(200).send(openApiSpec);
    } catch {
      return reply.code(200).send({ info: 'OpenAPI spec at openapi/openapi.json' });
    }
  });

  // ── GET /conflicts/:id ──────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/conflicts/:id', async (request: FastifyRequestGeneric, reply: FastifyReplyGeneric) => {
    try {
      const { id } = schemas.getConflict.params.parse(request.params);
      const conflict = service.getConflictById(id);

      if (!conflict) {
        return reply.code(404).send({
          success: false,
          error: `Conflict not found: ${id}`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.code(200).send({
        success: true,
        conflict,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  // ── POST /conflicts/:id/resolve ─────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/conflicts/:id/resolve', async (request: FastifyRequestGeneric, reply: FastifyReplyGeneric) => {
    try {
      const { id } = schemas.resolveConflict.params.parse(request.params);
      const { action, note, resolverUserId } = schemas.resolveConflict.body.parse(request.body);

      // Map API action -> internal status
      const statusMap: Record<string, 'acknowledged' | 'resolved' | 'dismissed'> = {
        acknowledge: 'acknowledged',
        resolve: 'resolved',
        dismiss: 'dismissed',
      };

      const mappedStatus = statusMap[action];
      const updated = service.resolveConflict(id, mappedStatus, note, resolverUserId);

      if (!updated) {
        return reply.code(404).send({
          success: false,
          error: `Conflict not found: ${id}`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.code(200).send({
        success: true,
        conflict: updated,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }
      throw error;
    }
  });

  // ── GET /conflicts/health ───────────────────────────────────────────────
  fastify.get('/conflicts/health', async (_request: FastifyRequestGeneric, reply: FastifyReplyGeneric) => {
    return reply.code(200).send({
      status: 'healthy',
      service: 'conflict-detection',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      rule: CONFLICT_RULE_SPEC.name,
    });
  });

  // Compatibility alias: GET /health
  fastify.get('/health', async (_request: FastifyRequestGeneric, reply: FastifyReplyGeneric) => {
    return reply.code(200).send({
      status: 'healthy',
      service: 'conflict-detection',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });
}

// Re-export for convenience — mirrors old index
export { CONFLICT_RULE_SPEC } from './conflict-rule.spec.js';
export const ConflictRuleSpec = CONFLICT_RULE_SPEC;

// Legacy named export used by some docs
export function getRuleSpecification() {
  return CONFLICT_RULE_SPEC;
}
