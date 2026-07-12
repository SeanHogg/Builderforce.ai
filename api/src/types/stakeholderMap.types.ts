/**
 * Stakeholder Map Types
 * 
 * Defines the data structures for stakeholder maps, including:
 * - The stakeholder map entity
 * - DTOs for creation, listing, and updates
 * - Schema and validation rules
 */

/**
 * Core Stakeholder Map entity
 */
export interface StakeholderMap {
  id: string;
  tenantId: string;
  initiativeId: string;
  projectId?: string | null;
  approverIds: string[];
  informedPartyIds: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

/**
 * Create Stakeholder Map request DTO
 * Used when creating a new stakeholder map via API
 */
export interface CreateStakeholderMapDto {
  initiativeId: string;
  projectId?: string | null;
  approverIds: string[];
  informedPartyIds: string[];
}

/**
 * Update Stakeholder Map request DTO
 * Used when updating an existing stakeholder map via API
 */
export interface UpdateStakeholderMapDto {
  approverIds: string[];
  informedPartyIds: string[];
}

/**
 * List Stakeholder Maps query DTO
 * Supports loose matching by initiativeId or projectId
 */
export interface ListStakeholderMapsQuery {
  initiativeId?: string;
  projectId?: string | null;
}

/**
 * List Stakeholder Maps response DTO
 */
export interface ListStakeholderMapsDto {
  stakeholderMaps: StakeholderMap[];
}

/**
 * JSON Schema for stakeholder map validation
 */
export const STAKEHOLDER_MAP_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    initiativeId: { type: 'string' },
    projectId: { type: ['string', 'null'] },
    approverIds: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      minItems: 1,
    },
    informedPartyIds: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      minItems: 1,
    },
    version: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
    updatedBy: { type: 'string' },
  },
  required: [
    'id',
    'tenantId',
    'initiativeId',
    'approverIds',
    'informedPartyIds',
    'version',
    'createdAt',
    'updatedAt',
    'createdBy',
    'updatedBy',
  ],
  additionalProperties: false,
} as const;

/**
 * OpenAPI Schema for stakeholder map endpoints
 */
export const OPENAPI_SCHEMAS = {
  stakeholders: {
    createRequest: {
      type: 'object',
      required: ['initiativeId', 'approverIds', 'informedPartyIds'],
      properties: {
        initiativeId: { type: 'string', description: 'The unique identifier for the initiative' },
        projectId: { type: ['string', 'null'], description: 'Optional project ID for loose project matching' },
        approverIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of user IDs who are required approvers for this initiative',
          uniqueItems: true,
        },
        informedPartyIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of user IDs who are informed parties for this initiative',
          uniqueItems: true,
        },
      },
    },
    updateRequest: {
      type: 'object',
      required: ['approverIds', 'informedPartyIds'],
      properties: {
        approverIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated list of approver user IDs',
          uniqueItems: true,
        },
        informedPartyIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated list of informed party user IDs',
          uniqueItems: true,
        },
      },
    },
    updateResponse: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        stakeholderMap: { $ref: '#/components/schemas/StakeholderMap' },
        message: { type: 'string' },
      },
    },
    listRequest: {
      type: 'object',
      properties: {
        initiativeId: { type: 'string', description: 'Filter by initiative ID (optional)' },
        projectId: { type: ['string', 'null'], description: 'Filter by project ID (optional, loose matching)' },
      },
    },
    listResponse: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        stakeholderMaps: {
          type: 'array',
          items: { $ref: '#/components/schemas/StakeholderMap' },
        },
      },
    },
  },
} as const;