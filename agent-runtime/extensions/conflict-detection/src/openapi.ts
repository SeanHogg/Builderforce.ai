/**
 * OpenAPI 3.0 Specification for Conflict Detection Rules and Alerts
 *
 * Per PRD Deliverable:
 * - Provide comprehensive OpenAPI documentation for all conflict-related API endpoints (list, create/detect)
 * - Include sample payloads
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Builderforce.ai — Conflict Detection Rules and Alerts API',
    description: [
      'Automatically detects prioritization conflicts where two distinct stakeholders',
      'assign different/conflicting P0 priorities to the same team within the same review window.',
      '',
      'Rule (formal): IF stakeholder_1 != stakeholder_2 AND priority(req1)=P0 AND priority(req2)=P0',
      'AND team(req1)=team(req2) AND reviewWindow(req1) overlaps reviewWindow(req2) THEN ConflictAlert.',
      '',
      'Deliverables per PRD:',
      '- Conflict detector component (service)',
      '- Conflict rule spec (GET /conflicts/rule)',
      '- Conflict Alert DTO with labeling, summarization, attachment to priority version',
      '- Conflict detection API (POST /conflicts/detect)',
      '- Conflict list API (GET /conflicts) filtered by status',
      '- Manual resolution via conflict resolver (POST /conflicts/:id/resolve)',
      '- Alerts visible to all team members via API',
      '- Deduplication prevents duplicate alerts for same underlying conflict',
    ].join('\n'),
    version: '1.0.0',
    contact: { name: 'Builderforce.ai Platform' },
  },
  servers: [
    { url: 'http://localhost:3000/api', description: 'Local dev' },
    { url: 'https://api.builderforce.ai/api', description: 'Production' },
  ],
  tags: [
    { name: 'conflicts', description: 'Conflict detection, listing, and manual resolution' },
  ],
  paths: {
    '/conflicts/detect': {
      post: {
        tags: ['conflicts'],
        operationId: 'detectConflicts',
        summary: 'Trigger conflict detection',
        description:
          'Evaluates a batch of priority requests against the formal conflict rule. ' +
          'Two distinct stakeholders assigning P0 to the same team within the same review window triggers a ConflictAlert. ' +
          'Duplicate detection is deduplicated — same stakeholder-pair + team + version returns no new alert but counts toward duplicatesFound.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DetectConflictsRequest' },
              examples: {
                basicConflict: {
                  summary: 'Two stakeholders, same team, same version — P0 conflict',
                  value: {
                    versionId: 'V1',
                    windowThresholdDays: 7,
                    requests: [
                      {
                        id: 'req-001',
                        title: 'Increase feature X capacity',
                        description: 'Frontend needs P0 for Q3 release',
                        priority: 'P0',
                        stakeholderId: 'alice',
                        stakeholder: {
                          name: 'Alice Smith',
                          role: 'Product Manager',
                          email: 'alice@example.com',
                        },
                        teamId: 'engineering',
                        team: { name: 'Engineering Team', organization: 'Product' },
                        versionId: 'V1',
                        reviewWindowStart: '2025-06-01T00:00:00Z',
                        reviewWindowEnd: '2025-06-30T00:00:00Z',
                        createdAt: '2025-06-23T08:00:00Z',
                        sourceSystem: 'priority_queue',
                      },
                      {
                        id: 'req-002',
                        title: 'Database scaling — critical path',
                        description: 'DB scaling required for same release',
                        priority: 'P0',
                        stakeholderId: 'bob',
                        stakeholder: {
                          name: 'Bob Johnson',
                          role: 'Engineering Manager',
                          email: 'bob@example.com',
                        },
                        teamId: 'engineering',
                        team: { name: 'Engineering Team', organization: 'Product' },
                        versionId: 'V1',
                        reviewWindowStart: '2025-06-01T00:00:00Z',
                        reviewWindowEnd: '2025-06-30T00:00:00Z',
                        createdAt: '2025-06-23T08:30:00Z',
                        sourceSystem: 'priority_queue',
                      },
                    ],
                  },
                },
                noConflictSameStakeholder: {
                  summary: 'Same stakeholder → no conflict per rule (must be distinct)',
                  value: {
                    versionId: 'V1',
                    requests: [
                      {
                        id: 'req-010',
                        title: 'Feature A',
                        priority: 'P0',
                        stakeholderId: 'alice',
                        stakeholder: { name: 'Alice' },
                        teamId: 'engineering',
                        team: { name: 'Engineering' },
                        versionId: 'V1',
                        createdAt: '2025-06-23T08:00:00Z',
                      },
                      {
                        id: 'req-011',
                        title: 'Feature B',
                        priority: 'P0',
                        stakeholderId: 'alice',
                        stakeholder: { name: 'Alice' },
                        teamId: 'engineering',
                        team: { name: 'Engineering' },
                        versionId: 'V1',
                        createdAt: '2025-06-23T09:00:00Z',
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'New conflict alerts created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DetectConflictsResponse' },
                example: {
                  success: true,
                  duplicatesFound: 0,
                  timestamp: '2025-06-23T10:30:00Z',
                  conflicts: [
                    {
                      id: 'alice__bob__engineering__V1',
                      key: {
                        stakeholderId1: 'alice',
                        stakeholderId2: 'bob',
                        teamId: 'engineering',
                        versionId: 'V1',
                      },
                      title: 'Engineering Team — P0 Priority Conflict: Competing P0 requests',
                      description:
                        'Conflict detected on 2025-06-23T10:30:00.000Z in version V1.\nRule: Two distinct stakeholders assigned conflicting P0 priorities to the same team within the same review window.\nDetails:\n- Stakeholder "Alice Smith" (ID: alice) assigned priority P0 to team "Engineering Team".\n- Stakeholder "Bob Johnson" (ID: bob) assigned priority P0 to the same team "Engineering Team".\nImpact: Resource allocation conflict — team "Engineering Team" cannot satisfy two competing P0 priorities simultaneously.',
                      summary:
                        'Conflict: Stakeholder "Alice Smith" assigned P0 and stakeholder "Bob Johnson" assigned P0 to team "Engineering Team" within same review window. Rule violation: distinct stakeholders cannot both set P0 for same team in same window; requires manual resolution. [Version: V1]',
                      severity: 'critical',
                      detectedAt: '2025-06-23T10:30:00.000Z',
                      status: 'open',
                      conflictingPriorities: {
                        stakeholder1: {
                          stakeholderId: 'alice',
                          stakeholderName: 'Alice Smith',
                          role: 'Product Manager',
                          email: 'alice@example.com',
                        },
                        stakeholder2: {
                          stakeholderId: 'bob',
                          stakeholderName: 'Bob Johnson',
                          role: 'Engineering Manager',
                          email: 'bob@example.com',
                        },
                        team: { teamId: 'engineering', teamName: 'Engineering Team', organization: 'Product' },
                        priority1: 'P0',
                        priority2: 'P0',
                      },
                      stakeholders: [
                        {
                          stakeholderId: 'alice',
                          stakeholderName: 'Alice Smith',
                          role: 'Product Manager',
                          email: 'alice@example.com',
                        },
                        {
                          stakeholderId: 'bob',
                          stakeholderName: 'Bob Johnson',
                          role: 'Engineering Manager',
                          email: 'bob@example.com',
                        },
                      ],
                      versionIds: ['V1'],
                      sourceRequestIds: ['req-001', 'req-002'],
                      conflictCount: 2,
                    },
                  ],
                },
              },
            },
          },
          '200': {
            description: 'No new conflicts (all duplicates or no matches)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DetectConflictsResponse' },
                example: {
                  success: true,
                  conflicts: [],
                  duplicatesFound: 1,
                  timestamp: '2025-06-23T11:00:00Z',
                },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/conflicts': {
      get: {
        tags: ['conflicts'],
        operationId: 'listConflicts',
        summary: 'List conflicts from the priority register',
        description:
          'Retrieves conflicts from the priority register with filtering by status per PRD.' +
          ' Visibility: alerts are visible to all relevant team members via this API.' +
          ' Supports pagination and multi-dimension filtering.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'acknowledged', 'resolved', 'dismissed', 'all'] }, description: 'Filter by workflow status' },
          { name: 'versionId', in: 'query', schema: { type: 'string' }, description: 'Filter by priority version (review window)' },
          { name: 'teamId', in: 'query', schema: { type: 'string' }, description: 'Filter by team ID' },
          { name: 'stakeholderId', in: 'query', schema: { type: 'string' }, description: 'Filter by involved stakeholder ID' },
          { name: 'severity', in: 'query', schema: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, description: 'Filter by severity' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 }, description: 'Page number' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 }, description: 'Items per page' },
        ],
        responses: {
          '200': {
            description: 'Paginated list of conflict alerts',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ListConflictsResponse' },
                example: {
                  conflicts: [
                    {
                      id: 'alice__bob__engineering__V1',
                      key: {
                        stakeholderId1: 'alice',
                        stakeholderId2: 'bob',
                        teamId: 'engineering',
                        versionId: 'V1',
                      },
                      title: 'Engineering Team — P0 Priority Conflict: Competing P0 requests',
                      description: 'Conflict detected on 2025-06-23 ...',
                      summary:
                        'Conflict: Stakeholder "Alice" assigned P0 and stakeholder "Bob" assigned P0 to team "Engineering" within same review window. Rule violation: distinct stakeholders cannot both set P0 for same team in same window; requires manual resolution. [Version: V1]',
                      severity: 'critical',
                      detectedAt: '2025-06-23T10:30:00.000Z',
                      status: 'open',
                      stakeholders: [
                        { stakeholderId: 'alice', stakeholderName: 'Alice', role: 'Product Manager' },
                        { stakeholderId: 'bob', stakeholderName: 'Bob', role: 'Engineering Manager' },
                      ],
                      versionIds: ['V1'],
                      sourceRequestIds: ['req-001', 'req-002'],
                      conflictCount: 2,
                      conflictingPriorities: {
                        stakeholder1: { stakeholderId: 'alice', stakeholderName: 'Alice', role: 'Product Manager' },
                        stakeholder2: { stakeholderId: 'bob', stakeholderName: 'Bob', role: 'Engineering Manager' },
                        team: { teamId: 'engineering', teamName: 'Engineering Team' },
                        priority1: 'P0',
                        priority2: 'P0',
                      },
                    },
                  ],
                  total: 1,
                  page: 1,
                  limit: 20,
                  totalPages: 1,
                  timestamp: '2025-06-23T10:30:00Z',
                },
              },
            },
          },
          '400': {
            description: 'Invalid filter',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/conflicts/{id}': {
      get: {
        tags: ['conflicts'],
        operationId: 'getConflict',
        summary: 'Get a conflict alert by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Conflict ID (stable key e.g. alice__bob__engineering__V1)' }],
        responses: {
          '200': {
            description: 'Conflict alert',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GetConflictResponse' } } },
          },
          '404': { description: 'Conflict not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/conflicts/{id}/resolve': {
      post: {
        tags: ['conflicts'],
        operationId: 'resolveConflict',
        summary: 'Manually resolve a conflict alert',
        description:
          'Per PRD: "overload of conflict resolution can be performed manually via conflict resolver." ' +
          'Conflict resolvers record action (acknowledge / resolve / dismiss) with optional note and resolver identity.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Conflict alert ID' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ResolveConflictRequest' },
              examples: {
                resolve: {
                  summary: 'Resolve with note',
                  value: {
                    action: 'resolve',
                    note: 'Negotiated: prioritizing DB scaling due to security requirements. Alice agreed to defer feature X to P1.',
                    resolverUserId: 'charlie',
                  },
                },
                acknowledge: {
                  summary: 'Acknowledge',
                  value: { action: 'acknowledge', resolverUserId: 'manager-1', note: 'Reviewing with both stakeholders tomorrow' },
                },
                dismiss: {
                  summary: 'Dismiss as not relevant',
                  value: { action: 'dismiss', note: 'Different scope despite same team label', resolverUserId: 'lead-2' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Conflict resolved', content: { 'application/json': { schema: { $ref: '#/components/schemas/ResolveConflictResponse' } } } },
          '404': { description: 'Conflict not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/conflicts/rule': {
      get: {
        tags: ['conflicts'],
        operationId: 'getConflictRule',
        summary: 'Get conflict detection rule specification',
        description: 'Returns the formal Conflict Rule Spec — part of the PRD deliverable.',
        responses: {
          '200': {
            description: 'Rule spec',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    rule: { $ref: '#/components/schemas/ConflictRule' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/conflicts/health': {
      get: {
        tags: ['conflicts'],
        operationId: 'healthCheck',
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Service healthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      PriorityLevel: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: 'P0 is highest priority' },
      ConflictStatus: { type: 'string', enum: ['open', 'acknowledged', 'resolved', 'dismissed'] },
      ConflictSeverity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },

      Stakeholder: {
        type: 'object',
        required: ['stakeholderId', 'stakeholderName'],
        properties: {
          stakeholderId: { type: 'string', description: 'Unique stakeholder identifier' },
          stakeholderName: { type: 'string', description: 'Display name — labeling requirement' },
          role: { type: 'string', description: 'Role (e.g. Product Manager)', nullable: true },
          email: { type: 'string', format: 'email', nullable: true },
        },
      },

      Team: {
        type: 'object',
        required: ['teamId', 'teamName'],
        properties: {
          teamId: { type: 'string' },
          teamName: { type: 'string', description: 'Labeling requirement — team name' },
          organization: { type: 'string', nullable: true },
        },
      },

      ConflictKey: {
        type: 'object',
        required: ['stakeholderId1', 'stakeholderId2', 'teamId'],
        description: 'Stable deduplication key — stakeholderId1__stakeholderId2__teamId[__versionId]',
        properties: {
          stakeholderId1: { type: 'string' },
          stakeholderId2: { type: 'string' },
          teamId: { type: 'string' },
          versionId: { type: 'string', nullable: true, description: 'Priority version to which alert is attached' },
        },
      },

      ConflictingPriorities: {
        type: 'object',
        required: ['stakeholder1', 'team', 'priority1', 'priority2'],
        description: 'Structured conflicting items — labeling requirement',
        properties: {
          stakeholder1: { $ref: '#/components/schemas/Stakeholder' },
          stakeholder2: { $ref: '#/components/schemas/Stakeholder', nullable: true },
          stakeholder: { $ref: '#/components/schemas/Stakeholder', nullable: true, description: 'Legacy alias' },
          team: { $ref: '#/components/schemas/Team' },
          priority1: { $ref: '#/components/schemas/PriorityLevel' },
          priority2: { $ref: '#/components/schemas/PriorityLevel' },
        },
      },

      /**
       * Conflict Alert DTO — core deliverable per PRD
       */
      ConflictAlert: {
        type: 'object',
        required: ['id', 'key', 'title', 'description', 'summary', 'severity', 'detectedAt', 'status', 'conflictingPriorities', 'stakeholders', 'versionIds', 'sourceRequestIds', 'conflictCount'],
        description:
          'Conflict Alert DTO — must include: labeling (conflicting items, stakeholders, detection date), summarization (reasoning), attachment to priority version(s).',
        properties: {
          id: { type: 'string', description: 'Unique alert ID (stable key derived from conflict)', example: 'alice__bob__engineering__V1' },
          key: { $ref: '#/components/schemas/ConflictKey' },
          title: { type: 'string', description: 'Human-readable title labeling team and conflict type', example: 'Engineering Team — P0 Priority Conflict: Competing P0 requests' },
          description: { type: 'string', description: 'Full description with labeled conflicting items, stakeholders, detection date' },
          summary: {
            type: 'string',
            description: 'Concise summary explaining reasoning behind conflict (PRD: conflict reasoning summary)',
            example:
              'Conflict: Stakeholder "Alice" assigned P0 and stakeholder "Bob" assigned P0 to team "Engineering" within same review window. Rule violation: distinct stakeholders cannot both set P0 for same team in same window; requires manual resolution. [Version: V1]',
          },
          severity: { $ref: '#/components/schemas/ConflictSeverity' },
          detectedAt: { type: 'string', format: 'date-time', description: 'Detection timestamp — labeling requirement (ISO 8601)' },
          status: { $ref: '#/components/schemas/ConflictStatus' },
          conflictingPriorities: { $ref: '#/components/schemas/ConflictingPriorities' },
          stakeholders: { type: 'array', items: { $ref: '#/components/schemas/Stakeholder' }, description: 'Involved stakeholders — labeling requirement' },
          versionIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Attached priority version(s) — alert is attached to relevant priority version(s) per PRD',
            example: ['V1'],
          },
          sourceRequestIds: { type: 'array', items: { type: 'string' }, description: 'Source priority request IDs that triggered conflict' },
          conflictCount: { type: 'integer', description: 'Number of unique conflicting source requests' },
          resolutionNote: { type: 'string', nullable: true, description: 'Set when resolved/dismissed' },
          resolvedBy: { type: 'string', nullable: true, description: 'Resolver user ID' },
          resolvedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },

      PriorityRequest: {
        type: 'object',
        required: ['id', 'title', 'priority', 'stakeholderId', 'stakeholder', 'teamId', 'team', 'createdAt'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          priority: { $ref: '#/components/schemas/PriorityLevel' },
          stakeholderId: { type: 'string' },
          stakeholder: {
            type: 'object',
            properties: {
              name: { type: 'string', nullable: true },
              role: { type: 'string', nullable: true },
              email: { type: 'string', nullable: true },
            },
          },
          teamId: { type: 'string' },
          team: {
            type: 'object',
            properties: {
              name: { type: 'string', nullable: true },
              organization: { type: 'string', nullable: true },
            },
          },
          versionId: { type: 'string', nullable: true, description: 'Priority version / review window id' },
          reviewWindowStart: { type: 'string', nullable: true, description: 'ISO 8601' },
          reviewWindowEnd: { type: 'string', nullable: true, description: 'ISO 8601' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
          sourceSystem: { type: 'string', nullable: true },
        },
      },

      DetectConflictsRequest: {
        type: 'object',
        required: ['requests'],
        properties: {
          requests: { type: 'array', items: { $ref: '#/components/schemas/PriorityRequest' }, minItems: 2, description: 'At least 2 requests needed' },
          versionId: { type: 'string', nullable: true, description: 'Scope to version / review window' },
          windowThresholdDays: { type: 'integer', nullable: true, minimum: 1, description: 'Review window size in days, default 7' },
        },
      },

      DetectConflictsResponse: {
        type: 'object',
        required: ['success', 'conflicts', 'duplicatesFound', 'timestamp'],
        properties: {
          success: { type: 'boolean' },
          conflicts: { type: 'array', items: { $ref: '#/components/schemas/ConflictAlert' } },
          duplicatesFound: { type: 'integer', description: 'Number of duplicate conflicts suppressed by deduplication' },
          error: { type: 'string', nullable: true },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },

      ListConflictsResponse: {
        type: 'object',
        required: ['conflicts', 'total', 'page', 'limit', 'totalPages', 'timestamp'],
        properties: {
          conflicts: { type: 'array', items: { $ref: '#/components/schemas/ConflictAlert' } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          totalPages: { type: 'integer' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },

      GetConflictResponse: {
        type: 'object',
        required: ['success', 'conflict', 'timestamp'],
        properties: {
          success: { type: 'boolean' },
          conflict: { $ref: '#/components/schemas/ConflictAlert' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },

      ResolveConflictRequest: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['acknowledge', 'resolve', 'dismiss'], description: 'Manual resolution action by conflict resolver' },
          note: { type: 'string', maxLength: 2000, nullable: true, description: 'Resolver reasoning / decision notes' },
          resolverUserId: { type: 'string', nullable: true },
        },
      },

      ResolveConflictResponse: {
        type: 'object',
        required: ['success', 'conflict', 'timestamp'],
        properties: {
          success: { type: 'boolean' },
          conflict: { $ref: '#/components/schemas/ConflictAlert' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },

      ConflictRule: {
        type: 'object',
        required: ['name', 'description', 'severityLevels', 'stakeholderConstraints', 'priorityConstraints', 'teamConstraints', 'windowConstraints'],
        description: 'Formal Conflict Rule Spec — PRD deliverable: Conflict Rule Spec',
        properties: {
          name: { type: 'string', example: 'team-p0-multi-stakeholder-conflict' },
          description: { type: 'string', description: 'Formal rule prose' },
          severityLevels: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                level: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                condition: { type: 'string' },
                threshold: { type: 'integer', nullable: true },
              },
            },
          },
          stakeholderConstraints: {
            type: 'object',
            properties: {
              mustBeDistinct: { type: 'boolean', description: 'Rule requires distinct stakeholders' },
              maxConcurrentRequestsPerStakeholder: { type: 'integer', nullable: true },
            },
          },
          priorityConstraints: {
            type: 'object',
            properties: {
              minThreshold: { $ref: '#/components/schemas/PriorityLevel' },
              maxThreshold: { $ref: '#/components/schemas/PriorityLevel' },
              exactMatch: { type: 'boolean', nullable: true },
            },
          },
          teamConstraints: {
            type: 'object',
            properties: {
              allowMultipleTeams: { type: 'boolean' },
              teamScope: { type: 'string', nullable: true },
            },
          },
          windowConstraints: {
            type: 'object',
            properties: {
              defaultDays: { type: 'integer' },
              maxWindowDays: { type: 'integer' },
              allowOverlap: { type: 'boolean' },
            },
          },
        },
      },

      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['healthy', 'unhealthy', 'degraded'] },
          service: { type: 'string', example: 'conflict-detection' },
          version: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          rule: { type: 'string', nullable: true },
        },
      },

      ErrorResponse: {
        type: 'object',
        required: ['success', 'error', 'timestamp'],
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string' },
          details: { type: 'array', items: { type: 'object' }, nullable: true },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

export default openApiSpec;
