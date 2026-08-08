/**
 * Dependency Resolution Service
 *
 * Implements Critical Path Method (CPM) to identify the longest chain of dependent tasks,
 * detects blockers on the critical path, and generates ranked resolution suggestions.
 */

import { drizzle } from 'drizzle-orm/postgres-js/http';
import { eq, and, sql, desc } from 'drizzle-orm';
import * as schema from '@builderforce/db';
import type { Task } from '@builderforce/db';
import {
  TaskNode,
  CriticalPath,
  DependencyBlocker,
  ResolutionSuggestion,
  DependencyImpactScore,
  DependencyReport,
  Config,
  DEFAULT_CONFIG,
  HARD_BLOCKER_STATUSES,
  BUSINESS_DAY_HOURS,
} from './types';

export class DependencyResolutionService {
  private db: ReturnType<typeof drizzle>;

  constructor(db: ReturnType<typeof drizzle>) {
    this.db = db;
  }

  /**
   * Build the task graph from the database
   */
  private async buildTaskGraph(projectId: number): Promise<TaskNode[]> {
    const tasks = await this.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .orderBy(schema.tasks.id);

    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status!,
      ownerId: task.assignedUserId,
      estimateDays: task.estimateDays ?? null,
      assignedTo: task.assignedUserId,
      projectId: task.projectId,
      dueDate: task.dueDate ?? null,
      createdAt: task.createdAt,
      createdBy: (task as any).createdBy || 'system',
      dependencies: [],
      downstream: [],
    }));
  }

  /**
   * Maximum recursion depth for CPM
   */
  private maxDepth = 1000;

  /**
   * Compute the critical path using CPM algorithm
   */
  async computeCriticalPath(projectId: number): Promise<CriticalPath | null> {
    const tasks = await this.buildTaskGraph(projectId);

    if (tasks.length === 0) {
      return null;
    }

    const taskMap = new Map<number, TaskNode>();
    for (const task of tasks) {
      taskMap.set(task.id, task);
    }

    const cycleDetected = this.detectCycle(taskMap);

    if (cycleDetected) {
      throw new Error('Dependency cycle detected in task graph');
    }

    const longestPathTo = new Map<number, number>();

    const getLongestPath = async (
      taskId: number,
      pathAccumulator: number
    ): Promise<number> => {
      if (pathAccumulator > this.maxDepth) {
        return 0;
      }

      const task = taskMap.get(taskId);
      if (!task) {
        return 0;
      }

      const taskPath = task.estimateDays ?? 0;
      let maxPath = taskPath === 0 ? 0 : 1; // Add at least 1 day baseline

      for (const depId of task.dependencies) {
        const depPath = await getLongestPath(depId, pathAccumulator + 1);
        const newPath = maxPath + (depPath > 0 ? 1 : 0);
        if (newPath > maxPath) {
          maxPath = newPath;
        }
      }

      longestPathTo.set(taskId, maxPath);
      return maxPath;
    };

    // Find all roots (no dependencies)
    const roots = tasks.filter((t) => t.dependencies.length === 0);

    let criticalPathEnd: number | null = null;
    let maxDuration = 0;

    for (const task of roots) {
      const path = await getLongestPath(task.id, 0);
      if (path > maxDuration) {
        maxDuration = path;
        criticalPathEnd = task.id;
      }
    }

    if (criticalPathEnd === null) {
      return {
        tasks: [],
        totalDurationDays: 0,
        startIndex: 0,
      };
    }

    // Reconstruct critical path backwards
    const criticalPathIds: number[] = [];
    let currentId = criticalPathEnd;
    const visited = new Set<number>();

    while (currentId !== null) {
      if (visited.has(currentId)) {
        criticalPathEnd = null;
        break;
      }
      visited.add(currentId);
      criticalPathIds.unshift(currentId);

      const task = taskMap.get(currentId);
      if (!task || task.dependencies.length === 0) {
        currentId = null;
      } else {
        // Find predecessor with longest path
        let maxPredPath = 0;
        let found = false;
        for (const predId of task.dependencies) {
          if (currentId === predId) continue;
          const predPath = longestPathTo.get(predId);
          if (predPath !== undefined && predPath > maxPredPath) {
            maxPredPath = predPath;
            found = true;
          }
        }
        currentId = found ? Array.from(taskMap.entries()).find(([id, t]) => t.dependencies.includes(currentId))?.[0] ?? null : null;
      }
    }

    if (criticalPathEnd === null || criticalPathIds.length === 0) {
      return {
        tasks: [],
        totalDurationDays: 0,
        startIndex: 0,
      };
    }

    const criticalPath = criticalPathIds.map((id) => taskMap.get(id)!);
    return {
      tasks: criticalPath,
      totalDurationDays: criticalPath.length * 2, // Baseline 2 days per task unit
      startIndex: 0,
    };
  }

  /**
   * Detect cycles in the dependency graph (returns true if cycle exists)
   */
  private detectCycle(taskMap: Map<number, TaskNode>): boolean {
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    const hasCycle = (taskId: number): boolean => {
      if (recursionStack.has(taskId)) {
        return true;
      }
      if (visited.has(taskId)) {
        return false;
      }

      visited.add(taskId);
      recursionStack.add(taskId);

      const task = taskMap.get(taskId);
      if (task) {
        for (const depId of task.dependencies) {
          if (hasCycle(depId)) {
            return true;
          }
        }
      }

      recursionStack.delete(taskId);
      return false;
    };

    for (const taskId of taskMap.keys()) {
      if (hasCycle(taskId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect blockers on the critical path
   */
  async detectBlockers(
    projectId: number,
    criticalPath: CriticalPath,
    stalenessDays: number = DEFAULT_CONFIG.stalenessDays
  ): Promise<DependencyBlocker[]> {
    const { tasks } = criticalPath;
    const now = new Date();
    const stalenessThreshold = new Date(Date.now() - stalenessDays * BUSINESS_DAY_HOURS * 3600000);

    const taskById = new Map(tasks.map(t => [t.id, t]));

    const blockers: DependencyBlocker[] = [];

    for (const task of tasks) {
      let upstreamBlocker: TaskNode | null = null;

      for (const depId of task.dependencies) {
        const dep = taskById.get(depId);
        if (!dep || dep.status === 'done' || dep.status === 'complete') {
          continue;
        }

        const stalenessInBusinessDays = Math.max(0, Math.floor(
          (now.getTime() - dep.updatedAt.getTime()) / BUSINESS_DAY_HOURS / 3600000
        ));

        const hasDeadline = dep.dueDate !== null;
        const isOverdue = hasDeadline && dep.dueDate < new Date();
        const isUnassigned = dep.ownerId === null;

        if (
          HARD_BLOCKER_STATUSES.includes(dep.status) ||
          isOverdue ||
          isUnassigned ||
          stalenessInBusinessDays >= stalenessDays
        ) {
          upstreamBlocker = dep;
          break;
        }
      }

      if (upstreamBlocker) {
        const stalenessInBusinessDays = Math.max(0, Math.floor(
          (now.getTime() - upstreamBlocker.updatedAt.getTime()) / BUSINESS_DAY_HOURS / 3600000
        ));

        let affectedTaskCount = 0;
        let totalSlipDays = 0;

        for (const candidateTask of tasks) {
          const candidateUpstream = candidateTask.upstreamBlocker;
          if (candidateUpstream === undefined || candidateUpstream.id !== upstreamBlocker.id) continue;

          // Reuse existing computed downstream baseline from generateReport if available, otherwise approximate
          const existingSlip: number | undefined = (candidateTask as any).estimatedScheduleSlipDays;
          const newSlip =
            existingSlip ??
            Math.max(0, (candidateTask.estimateDays ?? 2) * candidateDownstreamCount(candidateTask.dependencies.length));

          affectedTaskCount++;
          totalSlipDays += newSlip;

          (candidateTask as any).estimatedScheduleSlipDays = newSlip;
        }

        blockers.push({
          task,
          upstreamBlocker,
          isHard: HARD_BLOCKER_STATUSES.includes(upstreamBlocker.status) || (upstreamBlocker as any).isOverdue,
          stalenessDays: stalenessInBusinessDays,
          affectedTaskCount,
          estimatedScheduleSlipDays: Math.round(totalSlipDays),
        });
      }
    }

    return blockers;
  }

  // Helper to approximate downstream count from dependency depth for slip estimation
  function candidateDownstreamCount(depth: number): number {
    if (depth < 1) return 0;
    return Math.min(depth * 2, 10); // Upper-bound estimate: depth * 2, capping at 10
  }

  /**
   * Generate resolution suggestions for a blocker
   */
  generateResolutionSuggestions(blocker: DependencyBlocker): ResolutionSuggestion[] {
    const suggestions: ResolutionSuggestion[] = [];
    const upstream = blocker.upstreamBlocker!;

    if (blocker.isHard) {
      suggestions.push({
        category: 'reassignment',
        description: `Assign "${upstream.title}" to a team member with relevant skills to unblock critical path`,
        suggestedOwner: 'Available team member with relevant skills',
        estimatedTimeToUnblockMinutes: 60,
        confidence: 'medium' as const,
        rationale: 'Reassignment is the fastest way to resolve a hard blocker when the task is unassigned',
      });
    }

    if (blocker.stalenessDays >= stalenessDays) {
      suggestions.push({
        category: 'escalation',
        description: `Escalate "${upstream.title}" to [owner's manager] — stale for ${blocker.stalenessDays} days`,
        suggestedOwner: upstream.ownerId,
        estimatedTimeToUnblockMinutes: 120,
        confidence: 'high' as const,
        rationale: 'Escalation ensures senior leadership visibility for prolonged blocking',
      });
    }

    suggestions.push({
      category: 'parallelization',
      description: `Tasks ${upstream.id} and other downstream tasks can proceed in parallel; reorder to remove sequential constraint`,
      suggestedOwner: 'Project Manager',
      estimatedTimeToUnblockMinutes: 240,
      confidence: 'medium' as const,
      rationale: 'Parallelization can increase flow through multiple tasks without fixing the upstream dependency',
    });

    const myDownstreamCount = blocker.task.downstream.length;
    if (myDownstreamCount > 1) {
      suggestions.push({
        category: 'scope_reduction',
        description: 'Deliver minimal interface/stub for upstream task to unblock downstream; defer full implementation',
        suggestedOwner: 'Team Lead',
        estimatedTimeToUnblockMinutes: 180,
        confidence: 'high' as const,
        rationale: 'Reducing scope can unblock downstream without requiring full completion upstream',
      });
    }

    suggestions.push({
      category: 'external_coordination',
      description: `Schedule sync with external team/vendor for "${upstream.title}"`,
      suggestedOwner: 'Cross-functional owner',
      estimatedTimeToUnblockMinutes: 300,
      confidence: 'medium' as const,
      rationale: 'Some dependencies require coordination outside the team',
    });

    suggestions.push({
      category: 'risk_acceptance',
      description: `Accept risk; proceed with documented assumption while "${upstream.title}" remains unresolved`,
      suggestedOwner: 'Engineering Lead',
      estimatedTimeToUnblockMinutes: 0,
      confidence: 'low' as const,
      rationale: 'Only appropriate when business context allows risk acceptance',
    });

    suggestions.sort((a, b) => a.estimatedTimeToUnblockMinutes - b.estimatedTimeToUnblockMinutes);
    return suggestions;
  }

  /**
   * Calculate Dependency Impact Score for a blocker
   */
  calculateDependencyImpactScore(blocker: DependencyBlocker): DependencyImpactScore {
    const { affectedTaskCount, estimatedScheduleSlipDays, task } = blocker;

    const priority = (task.metadata?.priority || 'normal') as keyof typeof DEFAULT_CONFIG.businessPriorityWeights;
    const weight = DEFAULT_CONFIG.businessPriorityWeights[priority] ?? DEFAULT_CONFIG.businessPriorityWeights.normal;

    let score:
      number =
        affectedTaskCount * 10 +
        estimatedScheduleSlipDays * 5 +
        weight;

    return {
      blockSize: affectedTaskCount,
      totalSlipDays: estimatedScheduleSlipDays,
      businessPriorityWeight: weight,
      score,
    };
  }

  /**
   * Generate the full dependency resolution report
   */
  async generateReport(projectId: number, stalenessDays: number = DEFAULT_CONFIG.stalenessDays): Promise<DependencyReport> {
    const criticalPath = await this.computeCriticalPath(projectId);
    if (!criticalPath || criticalPath.tasks.length === 0) {
      return {
        projectId,
        totalBlockers: 0,
        criticalPathTasksAtRisk: 0,
        projectedScheduleSlipDays: 0,
        rankedBlockers: [],
        mermaidDiagram: 'digraph G { nodesep=0.5; rankdir=LR; }',
        countedTasks: 0,
      };
    }

    // Mark upstreamBlocker temporarily during detection for simplified slip estimation
    for (const t of criticalPath.tasks) {
      (t as any).upstreamBlocker = undefined;
    }

    const blockers = await this.detectBlockers(projectId, criticalPath, stalenessDays);
    for (const b of blockers) {
      (b.task as any).upstreamBlocker = b.upstreamBlocker;
    }

    const rankedBlockers = blockers.map((b) => {
      const impactScore = this.calculateDependencyImpactScore(b);
      const suggestions = this.generateResolutionSuggestions(b);
      return {
        blocker: b,
        dependencyImpactScore: impactScore,
        resolutionSuggestions: suggestions,
      };
    }).sort((a, b) => {
      if (b.dependencyImpactScore.score !== a.dependencyImpactScore.score) {
        return b.dependencyImpactScore.score - a.dependencyImpactScore.score;
      }
      const aFastest = a.resolutionSuggestions[0].estimatedTimeToUnblockMinutes;
      const bFastest = b.resolutionSuggestions[0].estimatedTimeToUnblockMinutes;
      return aFastest - bFastest;
    });

    const totalBlockers = blockers.length;
    const criticalPathTasksAtRisk = totalBlockers;
    const projectedScheduleSlipDays = rankedBlockers.reduce((sum, b) => sum + b.dependencyImpactScore.totalSlipDays, 0);

    return {
      projectId,
      totalBlockers,
      criticalPathTasksAtRisk,
      projectedScheduleSlipDays,
      rankedBlockers,
      mermaidDiagram: this.generateMermaidDiagram(criticalPath, blockers),
      countedTasks: criticalPath.tasks.length,
    };
  }

  /**
   * Generate Mermaid diagram with blocker status
   */
  private generateMermaidDiagram(criticalPath: CriticalPath, blockers: DependencyBlocker[]): string {
    const tasks = criticalPath.tasks;
    let mermaid = 'digraph DependencyPath {\n';
    mermaid += '  nodesep=0.5;\n';
    mermaid += '  rankdir=LR;\n';
    mermaid += '  node[shape=box, style=rounded];\n\n';

    for (const task of tasks) {
      const isBlocked = blockers.some((b) => b.task.id === task.id);
      const statusColor = isBlocked ? 'fill=red, style=filled' : 'fill=lightgreen';
      const title = task.title.length > 30 ? task.title.substring(0, 27) + '...' : task.title;
      mermaid += `  task_${task.id}[label="${title}", ${statusColor}];\n`;
    }

    mermaid += '\n';

    for (const task of tasks) {
      for (const downstreamId of task.downstream) {
        mermaid += `  task_${task.id} -> task_${downstreamId}[label="depends on"];\n`;
      }
    }

    mermaid += '}';
    return mermaid;
  }

  /**
   * Record resolution in history
   */
  async recordResolution(
    taskId: number,
    blockerTaskId: number,
    solutionEffortMinutes: number,
    confidence: 'low' | 'medium' | 'high',
    resolutionDurationMinutes: number
  ): Promise<void> {
    await this.db.insert(schema.dependencyResolutionHistory).values({
      taskId,
      blockerTaskId,
      impactedTaskId: null,
      dependencyPath: [],
      solutionEffortMinutes,
      confidenceLevel: confidence,
      resolutionDurationMinutes,
      resolvedAt: new Date(),
      notes: 'Resolution recorded for dependency resolution report',
    });
  }

  /**
   * Clear expired cache entries
   */
  async clearExpiredCache(): Promise<number> {
    // TODO: Implement based on critical_path_cache.expires_at column logic
    return 0;
  }
}

/**
 * Singleton instance
 */
let instance: DependencyResolutionService | null = null;

export function getDependencyResolutionService(db: ReturnType<typeof drizzle>): DependencyResolutionService {
  if (!instance) {
    instance = new DependencyResolutionService(db);
  }
  return instance;
}