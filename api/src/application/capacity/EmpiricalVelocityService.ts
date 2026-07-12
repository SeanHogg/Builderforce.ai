/**
 * Empirical Velocity Service
 * 
 * Collects, calculates, and manages agent velocity with actual sprint data.
 * Used by: capacity calibration, projection updates, gap micro-estimation
 */

import { db } from '@/infra/drizzle';
import {
  empiricalVelocity,
  agentUtilizationProfile,
  projectEmpiricalVelocity,
} from '@/infra/schema/files/capacity';
import { tasks } from '@/infra/schema/files/tasks';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { internalLogger } from '@/infra/logger';

export interface CreateVelocityEntryInput {
  tenantId: string;
  projectId: string;
  agentId: string;
  sprintNum: number;
  sprintStartDate: string;
  sprintEndDate: string;
  storyPointsCompleted: number;
  utilizationHours?: number;
}

export interface VelocityQueryFilters {
  tenantId: string;
  projectId?: string;
  agentId?: string;
  minSprintNum?: number;
  maxSprintNum?: number;
}

export interface AgentVelocitySummary {
  agentId: string;
  totalSprints: number;
  totalStoryPointsCompleted: number;
  avgVelocitySpPerSprint: number;
  minVelocitySpPerSprint: number;
  maxVelocitySpPerSprint: number;
  velocityStabilityScore: number;
}

const createVelocityEntrySchema = z.object({
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
  sprintNum: z.number().int().positive(),
  sprintStartDate: z.string().datetime(),
  sprintEndDate: z.string().datetime(),
  storyPointsCompleted: z.number().int().nonnegative(),
  utilizationHours: z.number().positive().optional(),
});

/**
 * Create a new empirical velocity entry for a completed sprint
 */
export async function createVelocityEntry(
  input: CreateVelocityEntryInput
): Promise<any> {
  const validated = createVelocityEntrySchema.parse(input);

  const result = await db
    .insert(empiricalVelocity)
    .values({
      tenant_id: validated.tenantId,
      project_id: validated.projectId,
      agent_id: validated.agentId,
      sprint_num: validated.sprintNum,
      sprint_start_date: validated.sprintStartDate,
      sprint_end_date: validated.sprintEndDate,
      story_points_completed: validated.storyPointsCompleted,
      utilization_hours: validated.utilizationHours,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflictDoNothing({
      target: [
        empiricalVelocity.project_id,
        empiricalVelocity.agent_id,
        empiricalVelocity.sprint_num,
        empiricalVelocity.tenant_id,
      ],
    })
    .returning();

  if (result.length === 0) {
    internalLogger.info('Velocity entry skipped (duplicate)', {
      projectId: validated.projectId,
      agentId: validated.agentId,
      sprintNum: validated.sprintNum,
    });
    return null;
  }

  internalLogger.info('Velocity entry created', {
    entry: result[0],
  });

  // Recalculate project-level velocity after each entry
  await recalculateProjectVelocity(validated.projectId, validated.tenantId);

  return result[0];
}

/**
 * Get velocity entries with filters
 */
export async function getVelocityEntries(
  filters: VelocityQueryFilters
): Promise<any[]> {
  const query = db
    .select()
    .from(empiricalVelocity)
    .where(eq(empiricalVelocity.tenant_id, filters.tenantId));

  if (filters.projectId) {
    query.where(
      and(
        eq(empiricalVelocity.tenant_id, filters.tenantId),
        eq(empiricalVelocity.project_id, filters.projectId)
      )
    );
  }

  if (filters.agentId) {
    query.where(eq(empiricalVelocity.agent_id, filters.agentId));
  }

  // Default filter for last 2 sprints
  if (!filters.minSprintNum && !filters.maxSprintNum) {
    // Get latest entries
    query.orderBy(empiricalVelocity.sprint_num desc).limit(100);
  }

  return query;
}

/**
 * Calculate empirical velocity for an agent
 */
export async function calculateAgentVelocity(
  filters: VelocityQueryFilters
): Promise<AgentVelocitySummary | null> {
  const entries = await getVelocityEntries(filters);

  if (entries.length === 0) {
    return null;
  }

  const totalSprints = entries.length;
  const totalStoryPoints = entries.reduce((sum, e) => sum + e.story_points_completed, 0);
  const velocities = entries.map((e) => e.story_points_completed);
  const avgVelocity = totalStoryPoints / totalSprints;
  const minVelocity = Math.min(...velocities);
  const maxVelocity = Math.max(...velocities);

  // Calculate velocity stability score (coefficient of variation)
  // Score of 1.0 = very stable (low variation), Score of 0.0 = unstable (high variation)
  const mean = avgVelocity;
  const variance =
    velocities.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / velocities.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;

  // Normalize to 0-1 range: cv ↦ (1 - cv / max_cv) where max_cv ≈ 0.3 (30% CV is max acceptable)
  const maxAcceptableCV = 0.3;
  const velocityStabilityScore = Math.max(0, Math.min(1, 1 - cv / maxAcceptableCV));

  return {
    agentId: filters.agentId || entries[0].agent_id,
    totalSprints,
    totalStoryPointsCompleted: totalStoryPoints,
    avgVelocitySpPerSprint: Math.round(avgVelocity * 100) / 100,
    minVelocitySpPerSprint: Math.round(minVelocity * 100) / 100,
    maxVelocitySpPerSprint: Math.round(maxVelocity * 100) / 100,
    velocityStabilityScore: Math.round(velocityStabilityScore * 100) / 100,
  };
}

/**
 * Recalculate project-level empirical velocity
 */
export async function recalculateProjectVelocity(
  projectId: string,
  tenantId: string
): Promise<ProjectEmpiricalVelocity | null> {
  // Get all agents in project with velocity data
  const entries = await getVelocityEntries({
    tenantId,
    projectId,
  });

  // Group by agent
  const agentVelocities = new Map<string, number[]>();
  for (const entry of entries) {
    if (!agentVelocities.has(entry.agent_id)) {
      agentVelocities.set(entry.agent_id, []);
    }
    agentVelocities.get(entry.agent_id)!.push(entry.story_points_completed);
  }

  // Calculate aggregate metrics
  let allVelocities: number[] = [];
  let totalSprints = 0;

  for (const [agentId, velocities] of agentVelocities.entries()) {
    allVelocities.push(...velocities);
    totalSprints += velocities.length;
  }

  if (allVelocities.length === 0) {
    return null;
  }

  const sortedVelocities = allVelocities.sort((a, b) => a - b);
  const minV = sortedVelocities[0];
  const maxV = sortedVelocities[sortedVelocities.length - 1];

  // For median (avoiding outliers in project-level aggregate):
  const mid = Math.floor(sortedVelocities.length / 2);
  const medianV = sortedVelocities.length % 2 === 0
    ? (sortedVelocities[mid - 1] + sortedVelocities[mid]) / 2
    : sortedVelocities[mid];

  const avgV = sortedVelocities.reduce((a, b) => a + b, 0) / sortedVelocities.length;

  const result = await db
    .insert(projectEmpiricalVelocity)
    .values({
      tenant_id: tenantId,
      project_id: projectId,
      total_sprints: totalSprints,
      avg_velocity_sp_per_sprint: Math.round(avgV * 100) / 100,
      min_velocity_sp_per_sprint: Math.round(minV * 100) / 100,
      max_velocity_sp_per_sprint: Math.round(maxV * 100) / 100,
      velocity_stability_score: Math.round(avgV * 100) / 100, // Simplified for project
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: projectEmpiricalVelocity.project_id,
      set: {
        total_sprints: totalSprints,
        avg_velocity_sp_per_sprint: Math.round(avgV * 100) / 100,
        min_velocity_sp_per_sprint: Math.round(minV * 100) / 100,
        max_velocity_sp_per_sprint: Math.round(maxV * 100) / 100,
        velocity_stability_score: Math.round(avgV * 100) / 100,
        updated_at: new Date(),
      },
    })
    .returning();

  return result[0];
}

/**
 * Invalidate project velocity (used after sprint data correction)
 */
export async function invalidateProjectVelocity(
  projectId: string,
  tenantId: string
): Promise<void> {
  await db
    .delete(projectEmpiricalVelocity)
    .where(
      and(
        eq(projectEmpiricalVelocity.project_id, projectId),
        eq(projectEmpiricalVelocity.tenant_id, tenantId)
      )
    );

  internalLogger.info('Project velocity invalidated', {
    projectId,
    tenantId,
  });
}