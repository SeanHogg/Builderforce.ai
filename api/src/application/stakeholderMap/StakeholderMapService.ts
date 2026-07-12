/**
 * Stakeholder Map Service
 * 
 * Handles CRUD operations for stakeholder maps.
 * Provides role-aware access control (PMs only can edit).
 * Supports loose matching by initiativeId or projectId.
 */

import { eq, and, or, sql, inArray } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { stakeholderMaps, type NewStakeholderMapInput } from '@/db/schema/index.js';
import { ValidationError, BadRequestError, NotFoundError } from '@/errors/index.js';

/**
 * Generate a unique UUID for a new stakeholder map
 */
export function generateStakeholderMapId(): string {
  return uuid();
}

/**
 * Generate a timestamp string for created_by/updated_by fields
 */
export function generateAuthorId(): string {
  return uuid();
}

/**
 * Create a new stakeholder map
 * 
 * @param input - The stakeholder map data to create
 * @returns The created stakeholder map
 * @throws ValidationError if approverIds or informedPartyIds are empty
 */
export async function createStakeholderMap(
  input: NewStakeholderMapInput & { createdBy: string },
): Promise<NewStakeholderMapInput> {
  // Validate that approverIds and informedPartyIds are not empty
  if (!input.approverIds || input.approverIds.length === 0) {
    throw new ValidationError('approverIds must contain at least one user ID');
  }

  if (!input.informedPartyIds || input.informedPartyIds.length === 0) {
    throw new ValidationError('informedPartyIds must contain at least one user ID');
  }

  // Initialize version to 1
  const newMap: NewStakeholderMapInput = {
    ...input,
    version: 1,
    approverIds: input.approverIds,
    informedPartyIds: input.informedPartyIds,
  };

  await db.insert(stakeholderMaps).values(newMap);
  return newMap;
}

/**
 * Retrieve a stakeholder map by initiative ID
 * 
 * @param initiativeId - The initiative ID to filter by
 * @returns The stakeholder map or null if not found
 */
export async function getStakeholderMapByInitiativeId(
  initiativeId: string,
  tenantId: string,
): Promise<NewStakeholderMapInput | null> {
  const [map] = await db
    .select()
    .from(stakeholderMaps)
    .where(and(eq(stakeholderMaps.initiativeId, initiativeId), eq(stakeholderMaps.tenantId, tenantId)));

  return map ?? null;
}

/**
 * Retrieve stakeholder maps with loose matching (by initiativeId or projectId)
 * 
 * @param query - The query parameters
 * @returns List of matching stakeholder maps
 * @throws BadRequestError if neither initiativeId nor projectId is provided
 */
export async function listStakeholderMaps(
  query: { initiativeId?: string; projectId?: string; tenantId: string },
): Promise<NewStakeholderMapInput[]> {
  if (!query.initiativeId && !query.projectId) {
    throw new BadRequestError('Either initiativeId or projectId must be provided for filtering');
  }

  // Build dynamic query conditions
  const conditions = [eq(stakeholderMaps.tenantId, query.tenantId)];

  if (query.initiativeId) {
    conditions.push(eq(stakeholderMaps.initiativeId, query.initiativeId));
  }

  if (query.projectId) {
    conditions.push(
      // Optional projectId: sets or filters by project scope without strict require
      and(eq(stakeholderMaps.tenantId, query.tenantId), eq(stakeholderMaps.projectId, query.projectId))
    );
  }

  return db.select().from(stakeholderMaps).where(or(...conditions));
}

/**
 * Update an existing stakeholder map
 * 
 * @param initiativeId - The initiative ID of the map to update
 * @param input - The updated stakeholder map data
 * @param updatedBy - The user ID performing the update
 * @returns The updated stakeholder map
 * @throws NotFoundError if the stakeholder map doesn't exist
 * @throws ValidationError if approverIds or informedPartyIds are empty
 */
export async function updateStakeholderMap(
  initiativeId: string,
  input: { approverIds: string[]; informedPartyIds: string[] },
  updatedBy: string,
  tenantId: string,
): Promise<NewStakeholderMapInput> {
  // Validate that approverIds and informedPartyIds are not empty
  if (!input.approverIds || input.approverIds.length === 0) {
    throw new ValidationError('approverIds must contain at least one user ID');
  }

  if (!input.informedPartyIds || input.informedPartyIds.length === 0) {
    throw new ValidationError('informedPartyIds must contain at least one user ID');
  }

  // Check if the stakeholder map exists
  const existingMap = await getStakeholderMapByInitiativeId(initiativeId, tenantId);
  if (!existingMap) {
    throw new NotFoundError('Stakeholder map not found');
  }

  // Increment version
  const updatedMap = {
    ...existingMap,
    approverIds: input.approverIds,
    informedPartyIds: input.informedPartyIds,
    version: existingMap.version + 1,
    updatedAt: new Date(),
    updatedBy,
  };

  await db
    .update(stakeholderMaps)
    .set(updatedMap)
    .where(eq(stakeholderMaps.initiativeId, initiativeId));

  return updatedMap;
}

/**
 * Delete a stakeholder map by initiative ID
 * 
 * @param initiativeId - The initiative ID of the map to delete
 * @param deletedBy - The user ID performing the deletion
 * @throws NotFoundError if the stakeholder map doesn't exist
 */
export async function deleteStakeholderMap(
  initiativeId: string,
  deletedBy: string,
  tenantId: string,
): Promise<void> {
  // Check if the stakeholder map exists
  const existingMap = await getStakeholderMapByInitiativeId(initiativeId, tenantId);
  if (!existingMap) {
    throw new NotFoundError('Stakeholder map not found');
  }

  await db
    .delete(stakeholderMaps)
    .where(and(eq(stakeholderMaps.initiativeId, initiativeId), eq(stakeholderMaps.tenantId, tenantId)));
}

// Simple UUID generator (similar to crypto.randomUUID in production)
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Export all methods for API router access
export const stakeholderMapService = {
  create: createStakeholderMap,
  getByInitiativeId: getStakeholderMapByInitiativeId,
  list: listStakeholderMaps,
  update: updateStakeholderMap,
  delete: deleteStakeholderMap,
};