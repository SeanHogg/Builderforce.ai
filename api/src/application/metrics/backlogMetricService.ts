/**
 * Backlog Metric Service
 *
 * Calculates the size of a project's current backlog:
 * - task_count: items where status = 'backlog' and sprintId IS NULL (not in an active or future sprint)
 * - story_points_total: SUM(storyPoints) where storyPoints IS NOT NULL
 * - unpointed_count: COUNT(*) where storyPoints IS NULL
 *
 * The service supports optional team filtering (via assignedUserId).
 */
import { sql } from 'drizzle-orm'; // Import if needed for SQL queries
import { tasks } from '../../infrastructure/database/schema';

// Types for the backend metric (internal computation)
export interface BacklogMetric {
	taskCount: number;
	storyPointsTotal: number;
	unpointedCount: number;
	lastSnapshotAt: Date;
}

export interface BacklogMetricWithFilters {
	taskCount: number;
	storyPointsTotal: number;
	unpointedCount: number;
	lastSnapshotAt: Date;
}

export interface BacklogMetricSnapshot {
	taskCount: number;
	storyPointsTotal: number;
	capturedAt: Date;
	filterScope: string; // 'project' | 'team' | 'workspace'
	filterId?: number | null; // projectId if filterScope='project'; team/disciplineId if filterScope='team'; null if workspace-wide
}

/**
 * Computes the backlog metric for a given project, optional team.
 */
export function computeBacklogMetric(
	projectId: number,
	teamId?: number | null,
) {
	// NOTE: Actual implementation should use the repository/pattern from sources like workforceMetrics.ts:
	//   - Use drizzle/repositories or a generic query builder
	//   - Ensure row-level security filters by tenantId (via tenant context)
	//   - Return computed metric DTO
	// Example structure:
	//   SELECT tasks.{id, story_points, sprint_id} FROM tasks JOIN projects ON tasks.project_id = projects.id
	//     WHERE tasks.project_id = $1
	//       AND tasks.archived = false
	//       AND tasks.status = 'backlog'
	//       AND (tasks.sprint_id IS NULL OR sprints.state != 'active' AND sprints.state != 'future')
	//       AND (teamId IS NULL OR tasks.assigned_user_id = teamId)

	// This is a whitespace-not-in-place placeholder method:
	const metric: BacklogMetric = {
		taskCount: 0,
		storyPointsTotal: 0,
		unpointedCount: 0,
		lastSnapshotAt: new Date(),
	};

	return metric;
}

/**
 * Computes backlog metric with historical snapshot params.
 * This function is used by the dailySeries worker to record snapshots —
 * it returns the values capturing the backlog size for that day.
 */
export function captureBacklogSnapshot(
	projectId: number,
	teamId?: number | null,
): BacklogMetricSnapshot {
	const capturedAt = new Date();

	// Recompute as per computeBacklogMetric (same query)
	const metric = computeBacklogMetric(projectId, teamId);

	return {
		taskCount: metric.taskCount,
		storyPointsTotal: metric.storyPointsTotal,
		capturedAt,
		filterScope: teamId ? 'team' : 'project',
		filterId: teamId ?? null,
	};
}

/**
 * Retrieves the most recent backlog metric snapshot for a project.
 */
export function getBacklogMetricSnapshotHistory(
	projectId: number,
	daysBack: number = 90,
) {
	// Filter historical snapshots (take from dailySeries worker output)
	const snapshot = {
		taskCount: 0,
		storyPointsTotal: 0,
		capturedAt: new Date(),
		filterScope: 'project',
		filterId: null,
	};

	// Example structure:
	//   SELECT task_count, story_points_total, captured_at FROM backlog_snapshots
	//     WHERE filter_scope = 'project' AND filter_id = $1 AND captured_at >= $2
	//     ORDER BY captured_at DESC LIMIT 1

	return snapshot;
}

/**
 * Starts a background worker (internal) to record daily snapshots.
 * This function is for the PMO / pmo.ts background job to call:
 *   - Capture snapshot for each project (optionally each team)
 *   - Insert into database via backlog_snapshots table
 */
export async function scheduleBacklogSnapshotWorker(
	projectIds: number[],
	teamIds?: number[],
	intervalMinutes: number = 24 * 60, // default 24h
) {
	// NOTE: This worker is not yet implemented; placeholder for PMO dailySeries integration.
	// The dailySeries engine is the canonical place for snapshotting (like workforceMetricsHistory.ts).
	// For now, the metric is served via public /backlog-metric endpoint cached by client/clientPolicy.
	return { scheduled: true };
}