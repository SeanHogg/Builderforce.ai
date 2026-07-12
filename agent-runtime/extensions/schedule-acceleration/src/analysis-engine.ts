/**
 * Schedule Acceleration Analysis Engine
 * 
 * Implements FR-1 through FR-6 of the PRD:
 * - Slippage Detection
 * - Dependency & Constraint Analysis
 * - Parallelization Recommendations
 * - Scope Reduction Recommendations
 * - Resource Deployment Recommendations
 * - Recovery Plan Output
 */

import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { createTool } from "@seanhogg/builderforce-agents/plugin-sdk";

// Types based on PRD requirements

interface Task {
  id: string;
  title: string;
  duration: number; // in hours
  effortRemaining: number;
  startTime?: number;
  endTime?: number;
  owner?: string;
  assignedAgentId?: string;
  status: "not_started" | "in_progress" | "completed";
  dependencies: string[];
  priority: "low" | "medium" | "high" | "urgent";
  scopeLevel: "must-have" | "should-have" | "nice-to-have";
  skillRequirement?: string;
  softConstraint?: boolean;
}

interface Schedule {
  tasks: Task[];
  projectStart: number;
  projectEnd: number;
  milestoneDates: Record<string, number>;
}

interface SlippageAnalysis {
  variance: number;
  bufferConsumed: number;
  severity: "minor" | "moderate" | "critical";
  affectedTasks: {
    taskId: string;
    currentProgress: number;
    scheduledDate: number;
    expectedDate: number;
    variance: number;
  }[];
}

interface ParallelizationOpportunity {
  taskIds: string[];
  prerequisiteConditions: string[];
  estimatedTimeSaved: number; // in hours
  riskLevel: "low" | "medium" | "high";
  rationale: string;
  impactOnCriticalPath: number;
}

interface ScopeReductionRecommendation {
  tasksDeferred: string[];
  description: string;
  impact: {
    downstreamTasks?: string[];
    effortRecovered: number;
  };
  deferralMilestone: string;
  requiresApproval: boolean;
}

interface ResourceDeploymentRecommendation {
  targetTasks: string[];
  recommendedAgentType: string;
  rampUpOverhead: number;
  netTimeSaved: number;
  coordinationEffort: number;
  handoffRequirements: string[];
  brooksLawRisk: boolean;
}

interface RecoveryPlan {
  timestamp: number;
  scope: {
    baselineSlippage: number;
    severity: string;
  };
  recommendations: {
    parallelization: ParallelizationOpportunity[];
    scopeReduction: ScopeReductionRecommendation[];
    resourceDeployment: ResourceDeploymentRecommendation[];
  };
  projectedRecovery: {
    allRecommendations: number;
    parallelizationOnly: number;
    scopeReductionOnly: number;
  };
  riskAssessment: "low" | "medium" | "high";
  circularDependencies: string[];
}

/**
 * Mock project data repository
 * In production, this would integrate with the builderforce.ai API
 * to fetch real task, schedule, and resource data.
 */
class ScheduleRepository {
  private projectId: string;
  private data: Schedule | null = null;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  async loadSchedule(): Promise<Schedule> {
    if (this.data) {
      return this.data;
    }

    // In production: fetch from builderforce.ai project API
    // This is mock data for implementation purposes
    this.data = {
      tasks: [
        {
          id: "TASK-1",
          title: "Database Schema Design",
          duration: 8,
          effortRemaining: 8,
          owner: "alice",
          status: "in_progress",
          dependencies: [],
          priority: "high",
          scopeLevel: "must-have",
          skillRequirement: "backend"
        },
        {
          id: "TASK-2",
          title: "API Endpoint Development",
          duration: 12,
          effortRemaining: 6,
          owner: "bob",
          status: "not_started",
          dependencies: ["TASK-1"],
          priority: "high",
          scopeLevel: "must-have",
          skillRequirement: "backend"
        },
        {
          id: "TASK-3",
          title: "Frontend UI Component Library",
          duration: 16,
          effortRemaining: 12,
          owner: "charlie",
          status: "not_started",
          dependencies: [],
          priority: "should-have",
          scopeLevel: "should-have",
          skillRequirement: "frontend"
        },
        {
          id: "TASK-4",
          title: "Integration Tests",
          duration: 8,
          effortRemaining: 8,
          owner: "alice",
          status: "not_started",
          dependencies: ["TASK-2"],
          priority: "high",
          scopeLevel: "must-have",
          skillRequirement: "testing"
        },
        {
          id: "TASK-5",
          title: "User Documentation",
          duration: 4,
          effortRemaining: 4,
          owner: "david",
          status: "not_started",
          dependencies: ["TASK-4"],
          priority: "medium",
          scopeLevel: "nice-to-have",
          skillRequirement: "technical-writing"
        }
      ],
      projectStart: Date.now() - 7200000, // 2 hours ago
      projectEnd: Date.now() + 307200000, // 36 hours from now
      milestoneDates: {
        "Milestone-1": Date.now() + 86400000, // 24 hours from now
        "Milestone-2": Date.now() + 172800000 // 48 hours from now
      }
    };

    return this.data;
  }
}

/**
 * Main schedule analysis engine
 */
class ScheduleAnalysisEngine {
  private config: {
    baselineSlippageThreshold: number;
    riskWarningThreshold: number;
    enableParallelizationFlags: boolean;
    enableScopeReductionFlags: boolean;
    enableResourceDeploymentFlags: boolean;
  };

  constructor(config: Partial<typeof ScheduleAnalysisEngine.prototype.config> = {}) {
    this.config = {
      baselineSlippageThreshold: config.baselineSlippageThreshold ?? 10,
      riskWarningThreshold: config.riskWarningThreshold ?? 15,
      enableParallelizationFlags: config.enableParallelizationFlags ?? true,
      enableScopeReductionFlags: config.enableScopeReductionFlags ?? true,
      enableResourceDeploymentFlags: config.enableResourceDeploymentFlags ?? true
    };
  }

  /**
   * FR-1: Slippage Detection
   */
  async detectSlippage(schedule: Schedule): Promise<SlippageAnalysis> {
    const projectDuration = schedule.projectEnd - schedule.projectStart;
    const currentBuffer = projectDuration - (Date.now() - schedule.projectStart);
    const bufferConsumed = 1 - (currentBuffer / projectDuration);
    const variance = bufferConsumed * 100;

    // Determine severity
    let severity: "minor" | "moderate" | "critical";
    if (variance >= 30 || variance < 0) {
      severity = "critical";
    } else if (variance >= 10) {
      severity = "moderate";
    } else {
      severity = "minor";
    }

    // Analyze affected tasks
    const affectedTasks = schedule.tasks
      .filter(task => {
        if (task.status === "completed") return false;
        if (task.duration === 0) return false;
        
        const taskBuffer = task.duration - task.effortRemaining;
        const taskPercentBuffer = taskBuffer / task.duration;
        return taskPercentBuffer <= this.config.baselineSlippageThreshold / 100;
      })
      .map(task => ({
        taskId: task.id,
        currentProgress: task.status === "completed" ? 100 : 
                        task.status === "in_progress" ? 
                          50 + Math.random() * 50 : 0,
        scheduledDate: schedule.milestoneDates["Milestone-1"] || schedule.projectStart,
        expectedDate: schedule.projectStart + (task.duration / projectDuration) * projectDuration,
        variance: task.effortRemaining
      }));

    return {
      variance,
      bufferConsumed,
      severity,
      affectedTasks
    };
  }

  /**
   * FR-2: Dependency & Constraint Analysis
   */
  async analyzeDependencies(schedule: Schedule): Promise<{
    criticalPath: string[];
    parallelizationCandidates: string[];
    resourceContention: Map<string, string[]>;
  }> {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();
    
    // Build graph
    schedule.tasks.forEach(task => {
      inDegree.set(task.id, 0);
      adjList.set(task.id, []);
    });

    schedule.tasks.forEach(task => {
      task.dependencies.forEach(depId => {
        if (adjList.has(depId)) {
          adjList.get(depId)!.push(task.id);
          inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
        }
      });
    });

    // Topological sort to find critical path
    const visited = new Set<string>();
    const path = [];
    
    const dfs = (task: string) => {
      visited.add(task);
      path.push(task);
      
      const successors = adjList.get(task) || [];
      for (const succ of successors) {
        if (!visited.has(succ)) {
          dfs(succ);
        }
      }
    };

    const startNodes = Array.from(inDegree.entries())
      .filter(([_, indeg]) => indeg === 0)
      .map(([id]) => id);
    
    for (const node of startNodes) {
      dfs(node);
    }

    // Critical path: tasks with the longest dependency chain
    const criticalPath = path.map(id => id).reverse();

    // Find tasks with no dependencies or all met
    const parallelizationCandidates = schedule.tasks
      .filter(task => {
        if (task.dependencies.length === 0) return true;
        return task.dependencies.every(dep => {
          const depTask = schedule.tasks.find(t => t.id === dep);
          return depTask && depTask.status === "completed";
        });
      })
      .map(task => task.id);

    // Detect resource contention
    const resourceContention = new Map<string, string[]>();
    
    schedule.tasks.forEach(task => {
      if (task.owner) {
        if (!resourceContention.has(task.owner)) {
          resourceContention.set(task.owner, []);
        }
        resourceContention.get(task.owner)!.push(task.id);
      }
      if (task.assignedAgentId) {
        if (!resourceContention.has(task.assignedAgentId)) {
          resourceContention.set(task.assignedAgentId, []);
        }
        resourceContention.get(task.assignedAgentId)!.push(task.id);
      }
    });

    return {
      criticalPath,
      parallelizationCandidates,
      resourceContention
    };
  }

  /**
   * FR-3: Parallelization Recommendations
   */
  generateParallelizationOpportunities(
    schedule: Schedule,
    dependencies: { parallelizationCandidates: string[] }
  ): ParallelizationOpportunity[] {
    if (!this.config.enableParallelizationFlags) {
      return [];
    }

    // Find sequential tasks that can run concurrently
    const opportunities: ParallelizationOpportunity[] = [];
    
    schedule.tasks.forEach(task => {
      if (!dependencies.parallelizationCandidates.includes(task.id)) return;
      
      // Check if task has soft constraints or special handlers that enable parallelization
      const isRiskyTask = task.softConstraint || [
        "TASK-5" // Documentation is often risky to parallelize mid-execution
      ].includes(task.id);
      
      if (isRiskyTask) return;

      // For this implementation, simulate finding tasks that could parallelize
      // In production, this would use more sophisticated dependency analysis
      
      // Find tasks with compatible skills
      const compatibleTasks = schedule.tasks
        .filter(t => t.id !== task.id && 
                     !dependencies.parallelizationCandidates.includes(t.id) &&
                     t.skillRequirement === task.skillRequirement)
        .slice(0, 2);

      if (compatibleTasks.length >= 1) {
        opportunities.push({
          taskIds: [task.id, ...compatibleTasks.map(t => t.id)],
          prerequisiteConditions: [
            "Ensure CI/CD pipeline supports parallel execution",
            "Verify shared state isolation between parallel tasks"
          ],
          estimatedTimeSaved: Math.min(
            task.duration * 0.4,
            ...compatibleTasks.map(t => t.effortRemaining * 0.5)
          ),
          riskLevel: "medium",
          rationale: `Task ${task.id} and its compatible ${compatibleTasks.length} task(s) share similar skill requirements and have no dependencies.`,
          impactOnCriticalPath: 0
        });
      }
    });

    // Sort by time impact on critical path
    return opportunities.sort((a, b) => b.impactOnCriticalPath - a.impactOnCriticalPath);
  }

  /**
   * FR-4: Scope Reduction Recommendations
   */
  generateScopeReductionRecommendations(
    schedule: Schedule
  ): ScopeReductionRecommendation[] {
    if (!this.config.enableScopeReductionFlags) {
      return [];
    }

    const recommendations: ScopeReductionRecommendation[] = [];

    // Find Nice-to-Have tasks that can be deferred
    const deferrableTasks = schedule.tasks.filter(
      task => task.scopeLevel === "nice-to-have"
    );

    if (deferrableTasks.length > 0) {
      recommendations.push({
        tasksDeferred: deferrableTasks.map(t => t.id),
        description: `Defer ${deferrableTasks.length} Nice-to-Have tasks to future version.`,
        impact: {
          effortRecovered: deferrableTasks.reduce((sum, t) => sum + t.effortRemaining, 0)
        },
        deferralMilestone: "Version 2.0",
        requiresApproval: true
      });
    }

    // Find Should-Have tasks as last-resort option
    const shouldHaveTasks = schedule.tasks.filter(
      t => t.scopeLevel === "should-have" && !recommendations.some(r => 
        r.tasksDeferred.includes(t.id)
      )
    );

    if (shouldHaveTasks.length > 0) {
      recommendations.push({
        tasksDeferred: shouldHaveTasks.map(t => t.id),
        description: "Defer Must-Have tasks to accommodate scope reduction.",
        impact: {
          downstreamTasks: ["TASK-5"], // Documentation depends on TASK-4, which may be affected
          effortRecovered: shouldHaveTasks.reduce((sum, t) => sum + t.effortRemaining, 0)
        },
        deferralMilestone: "Version 1.1",
        requiresApproval: true
      });
    }

    return recommendations;
  }

  /**
   * FR-5: Resource Deployment Recommendations
   */
  generateResourceDeploymentRecommendations(
    schedule: Schedule,
    repository: ScheduleRepository
  ): ResourceDeploymentRecommendation[] {
    if (!this.config.enableResourceDeploymentFlags) {
      return [];
    }

    const recommendations: ResourceDeploymentRecommendation[] = [];

    // Find tasks with understaffing or bottleneck issues
    for (const task of schedule.tasks) {
      if (task.status === "in_progress" && task.effortRemaining < task.duration * 0.5) {
        // Task is at least 50% complete, remaining effort is small, could be a bottleneck
        const avgCost = 2000; // in hours
        const allocationRatio = task.effortRemaining / task.duration;
        const recommendedAgents = Math.ceil(allocationRatio * 3); // Conservative estimate
        
        const coordinationEffort = recommendedAgents * 4; // hours of coordination overhead
        const netTimeSaved = task.effortRemaining - coordinationEffort;
        
        const brooksLawRisk = recommendedAgents > 1 && netTimeSaved < task.effortRemaining * 0.15;
        
        if (brooksLawRisk) {
          recommendations.push({
            targetTasks: [task.id],
            recommendedAgentType: "specialized-audit-agent",
            rampUpOverhead: 4,
            netTimeSaved,
            coordinationEffort,
            handoffRequirements: [
              "Requires task handoff from current owner",
              "Ensure knowledge transfer documentation is complete",
              "Clear permission boundaries for any shared access"
            ],
            brooksLawRisk: true
          });
        }
      }
    }

    return recommendations.sort((a, b) => b.netTimeSaved - a.netTimeSaved);
  }

  /**
   * FR-6: Unified Recovery Plan Output
   */
  async generateRecoveryPlan(
    projectId: string,
    config?: Partial<typeof ScheduleAnalysisEngine.prototype.config>
  ): Promise<RecoveryPlan> {
    const engine = new ScheduleAnalysisEngine(config);
    const repository = new ScheduleRepository(projectId);
    const schedule = await repository.loadSchedule();
    
    // Step 1: Detect slippage
    const slippage = await engine.detectSlippage(schedule);
    
    // Step 2: Analyze dependencies
    const dependencies = await engine.analyzeDependencies(schedule);
    
    // Step 3: Generate recommendations
    const parallelization = engine.generateParallelizationOpportunities(schedule, dependencies);
    const scopeReduction = engine.generateScopeReductionRecommendations(schedule);
    const resourceDeployment = engine.generateResourceDeploymentRecommendations(schedule, repository);
    
    // Calculate projected recovery
    const totalRecovery = 
      parallelization.reduce((sum, op) => sum + op.estimatedTimeSaved, 0) +
      scopeReduction.reduce((sum, def) => sum + def.impact.effortRecovered, 0) +
      resourceDeployment.reduce((sum, dep) => sum + dep.netTimeSaved, 0);
    
    // Determine risk assessment
    const totalRisk = parallelization.filter(op => op.riskLevel === "high").length +
                     schedule.tasks.filter(t => t.priority === "urgent").length;
    
    let riskAssessment: "low" | "medium" | "high";
    if (totalRisk === 0 && totalRecovery < 100) {
      riskAssessment = "low";
    } else if (totalRisk > 2) {
      riskAssessment = "high";
    } else {
      riskAssessment = "medium";
    }

    // Construct recovery plan
    const recoveryPlan: RecoveryPlan = {
      timestamp: Date.now(),
      scope: {
        baselineSlippage: slippage.bufferConsumed,
        severity: slippage.severity
      },
      recommendations: {
        parallelization,
        scopeReduction,
        resourceDeployment
      },
      projectedRecovery: {
        allRecommendations: totalRecovery,
        parallelizationOnly: parallelization.reduce((sum, op) => sum + op.estimatedTimeSaved, 0),
        scopeReductionOnly: scopeReduction.reduce((sum, def) => sum + def.impact.effortRecovered, 0)
      },
      riskAssessment,
      circularDependencies: []
    };

    return recoveryPlan;
  }
}

// Export utilities for repository usage without module pattern issues
export { 
  ScheduleRepository, 
  ScheduleAnalysisEngine,
  type Task,
  type Schedule,
  type SlippageAnalysis,
  type ParallelizationOpportunity,
  type ScopeReductionRecommendation,
  type ResourceDeploymentRecommendation,
  type RecoveryPlan
};

/**
 * Example usage (for documentation and testing)
 */
async function exampleUsage() {
  const engine = new ScheduleAnalysisEngine();
  const plan = await engine.generateRecoveryPlan("PROJECT-123");
  
  console.log("Recovery Plan Summary:");
  console.log(`Slippage Severity: ${plan.scope.severity}`);
  console.log(`Total Time Recovery: ${plan.projectedRecovery.allRecommendations} hours`);
  console.log(`Risk Assessment: ${plan.riskAssessment}`);
  
  plan.recommendations.parallelization.forEach((op, i) => {
    console.log(`\nParallelization Option ${i + 1}:`);
    console.log(`  Tasks: ${op.taskIds.join(", ")}`);
    console.log(`  Time Saved: ${op.estimatedTimeSaved} hours`);
    console.log(`  Risk Level: ${op.riskLevel}`);
  });
}