/**
 * Conflict Detection API Layer
 * 
 * Fastify server and API routes for the conflict detection system.
 * Implements:
 * - POST /conflicts/detect - Trigger conflict detection
 * - GET /conflicts - List conflicts with filters
 * - POST /conflicts/:id/resolve - Manually resolve a conflict
 */

import type { FastifyInstance } from 'fastify';
import { ConflictDetectionService } from './conflict-detector.service.js';
import { z } from 'zod';

/**
 * Schema definitions for request validation
 */
const schemas = {
  detectConflicts: {
    body: z.object({
      requests: z.array(z.object({
        id: z.string().min(1).describe('Unique request identifier'),
        title: z.string().min(1).describe('Request title'),
        description: z.string().optional().describe('Request description'),
        priority: z.string().regex(/^(P0|P1|P2|P3)$/, 'Priority must be P0, P1, P2, or P3').describe('Priority level'),
        stakeholderId: z.string().min(1).describe('Stakeholder unique identifier'),
        stakeholder: z.object({
          name: z.string().optional().describe('Stakeholder name'),
          role: z.string().optional().describe('Stakeholder role'),
          email: z.string().email().optional().describe('Stakeholder email')
        }).describe('Stakeholder details'),
        teamId: z.string().min(1).describe('Team unique identifier'),
        team: z.object({
          name: z.string().optional().describe('Team name'),
          organization: z.string().optional().describe('Team organization')
        }).describe('Team details'),
        versionId: z.string().optional().describe('Priority version identifier'),
        reviewWindowStart: z.string().datetime().optional().describe('Review window start (ISO 8601)'),
        reviewWindowEnd: z.string().datetime().optional().describe('Review window end (ISO 8601)'),
        createdAt: z.string().datetime().describe('Request creation timestamp (ISO 8601)'),
        updatedAt: z.string().datetime().optional().describe('Request update timestamp (ISO 8601)'),
        sourceSystem: z.string().optional().describe('System that generated this request')
      })).min(2, 'At least 2 requests required for conflict detection'),
      versionId: z.string().optional().describe('Scope detection to specific priority version'),
      windowThresholdDays: z.number().int().positive().optional().describe('Override default review window size (days)')
    })
  },
  
  listConflicts: {
    querystring: z.object({
      status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed', 'all']).optional(),
      versionId: z.string().optional(),
      teamId: z.string().optional(),
      stakeholderId: z.string().optional(),
      severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      page: z.coerce.number().int().positive().default(1).optional(),
      limit: z.coerce.number().int().positive().max(100).default(20).optional()
    }),
    params: z.object({
      id: z.string().optional().describe('Conflict alert ID')
    })
  },
  
  resolveConflict: {
    params: z.object({
      id: z.string().describe('Conflict alert ID')
    }).required(),
    body: z.object({
      action: z.enum(['acknowledge', 'resolve', 'dismiss']),
      note: z.string().optional().describe('Resolution note'),
      resolverUserId: z.string().optional().describe('User who resolved this conflict')
    })
  }
};

/**
 * Register conflict detection API routes
 */
export async function registerConflictDetectionRoutes(fastify: FastifyInstance) {
  const service = conflictDetectionService;
  
  /**
   * POST /conflicts/detect
   * Trigger conflict detection on a batch of priority requests
   */
  fastify.post('/conflicts/detect', async (request, reply) => {
    try {
      const { requests, versionId, windowThresholdDays } = schemas.detectConflicts.body.parse(
        request.body
      );
      
      // Create mock request objects for the service
      const mockPriorityRequests = requests.map(r => ({
        ...r,
        stakeholder: r.stakeholder,
        team: r.team
      }));
      
      const result = service.detectConflicts({
        requests: mockPriorityRequests,
        versionId,
        windowThresholdDays
      });
      
      // Add response metadata
      const response = {
        success: result.success,
        conflicts: result.conflicts,
        duplicatesFound: result.duplicatesFound,
        timestamp: new Date().toISOString()
      };
      
      if (!result.success || result.conflicts.length === 0) {
        return reply.code(200).send(response);
      }
      
      return reply.code(201).send(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      }
      
      throw error;
    }
  });
  
  /**
   * GET /conflicts
   * List conflicts with optional filtering
   */
  fastify.get('/conflicts', async (request, reply) => {
    try {
      const { status, versionId, teamId, stakeholderId, severity, page, limit } = 
        schemas.listConflicts.querystring.parse(request.query);
      
      // In a full implementation, this would query a persistence layer
      // For now, return empty array or sample data based on parameters
      
      const mockConflicts = generateMockConflicts(status, versionId, teamId, stakeholderId, severity, page, limit);
      
      const response = {
        conflicts: mockConflicts,
        total: mockConflicts.length,
        page: page || 1,
        limit: limit || 20,
        totalPages: Math.ceil(mockConflicts.length / (limit || 20)),
        timestamp: new Date().toISOString()
      };
      
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      }
      
      throw error;
    }
  });
  
  /**
   * GET /conflicts/:id
   * Get a specific conflict alert by ID
   */
  fastify.get<{ Params: { id: string } }>('/conflicts/:id', async (request, reply) => {
    try {
      const { id } = schemas.listConflicts.params.parse(request.params);
      
      // In a full implementation, this would query a persistence layer
      // For now, return 404 if ID doesn't exist
      const conflict = mockConflictsDatabase.find(c => c.id === id);
      
      if (!conflict) {
        return reply.code(404).send({
          success: false,
          error: 'Conflict not found'
        });
      }
      
      return reply.code(200).send({
        success: true,
        conflict,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      }
      
      throw error;
    }
  });
  
  /**
   * POST /conflicts/:id/resolve
   * Manually resolve a conflict alert
   */
  fastify.post<{ Params: { id: string } }>('/conflicts/:id/resolve', async (request, reply) => {
    try {
      const { id } = schemas.resolveConflict.params.parse(request.params);
      const { action, note, resolverUserId } = schemas.resolveConflict.body.parse(request.body);
      
      // In a full implementation, this would update the persistence layer
      const conflictIndex = mockConflictsDatabase.findIndex(c => c.id === id);
      
      if (conflictIndex === -1) {
        return reply.code(404).send({
          success: false,
          error: 'Conflict not found'
        });
      }
      
      // Update conflict status
      const updated = {
        ...mockConflictsDatabase[conflictIndex],
        status: action,
        resolutionNote: note,
        resolvedBy: resolverUserId,
        resolvedAt: new Date().toISOString()
      };
      
      mockConflictsDatabase[conflictIndex] = updated;
      
      return reply.code(200).send({
        success: true,
        conflict: updated,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      }
      
      throw error;
    }
  });
  
  /**
   * Health check endpoint
   */
  fastify.get('/health', async (request, reply) => {
    return reply.code(200).send({
      status: 'healthy',
      service: 'conflict-detection',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });
}

/**
 * Mock conflicts database (simplified in-memory store)
 * In production, this would be backed by PostgreSQL/that
 */
let mockConflictsDatabase: any[] = [
  {
    id: 'alice_bob_engineering__V1',
    key: {
      stakeholderId1: 'alice',
      stakeholderId2: 'bob',
      teamId: 'engineering',
      versionId: 'V1'
    },
    title: 'Engineering Team — P0 Priority Conflict',
    description: 'Detected: Alice requested P0 for engineering team, Bob requested P0 for same team. Conflicting priorities detected.',
    summary: 'P0 (stakeholder Alice, Engineering) vs P0 (stakeholder Bob, Engineering)',
    severity: 'critical',
    detectedAt: '2025-06-23T10:30:00Z',
    status: 'open',
    conflictingPriorities: {
      stakeholder1: { stakeholderId: 'alice', stakeholderName: 'Alice', role: 'Product Manager' },
      team: { teamId: 'engineering', teamName: 'Engineering Team' },
      priority1: 'P0',
      priority2: 'P0'
    },
    stakeholders: [
      { stakeholderId: 'alice', stakeholderName: 'Alice', role: 'Product Manager' },
      { stakeholderId: 'bob', stakeholderName: 'Bob', role: 'Engineering Manager' }
    ],
    versionIds: ['V1'],
    sourceRequestIds: ['req-001', 'req-002'],
    conflictCount: 2
  },
  {
    id: 'charlie_diana_marketing__V2',
    key: {
      stakeholderId1: 'charlie',
      stakeholderId2: 'diana',
      teamId: 'marketing',
      versionId: 'V2'
    },
    title: 'Marketing Team — P0 Priority Conflict',
    description: 'Detected: Charlie requested P1 for marketing team, Diana requested P0 for same team. Higher priority detected.',
    summary: 'P1 (stakeholder Charlie, Marketing) vs P0 (stakeholder Diana, Marketing)',
    severity: 'high',
    detectedAt: '2025-06-22T14:20:00Z',
    status: 'acknowledged',
    conflictingPriorities: {
      stakeholder1: { stakeholderId: 'charlie', stakeholderName: 'Charlie', role: 'Marketing Director' },
      team: { teamId: 'marketing', teamName: 'Marketing Team' },
      priority1: 'P1',
      priority2: 'P0'
    },
    stakeholders: [
      { stakeholderId: 'charlie', stakeholderName: 'Charlie', role: 'Marketing Director' },
      { stakeholderId: 'diana', stakeholderName: 'Diana', role: 'Product Owner' }
    ],
    versionIds: ['V2'],
    sourceRequestIds: ['req-005', 'req-006'],
    conflictCount: 1
  }
];

/**
 * Generate mock conflicts for testing/demo
 */
function generateMockConflicts(
  status?: string,
  versionId?: string,
  teamId?: string,
  stakeholderId?: string,
  severity?: string,
  page?: number,
  limit?: number
): any[] {
  let result = [...mockConflictsDatabase];
  
  // Filter by status
  if (status && status !== 'all') {
    result = result.filter(c => c.status === status);
  }
  
  // Filter by versionId
  if (versionId) {
    result = result.filter(c => c.versionIds.includes(versionId));
  }
  
  // Filter by teamId
  if (teamId) {
    result = result.filter(c => c.key.teamId === teamId);
  }
  
  // Filter by stakeholderId
  if (stakeholderId) {
    result = result.filter(
      c => c.stakeholders.some(s => s.stakeholderId === stakeholderId)
    );
  }
  
  // Filter by severity
  if (severity) {
    result = result.filter(c => c.severity === severity);
  }
  
  // Pagination
  if (page && limit) {
    const start = (page - 1) * limit;
    const end = start + limit;
    result = result.slice(start, end);
  }
  
  return result;
}