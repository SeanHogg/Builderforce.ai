import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { createTool } from "@seanhogg/builderforce-agents/plugin-sdk";
import {
  ScheduleRepository,
  ScheduleAnalysisEngine,
  type RecoveryPlan
} from "./src/analysis-engine";

// Schedule Acceleration Assistant Extension
const scheduleAccelerationPlugin = {
  id: "schedule-acceleration",
  name: "Schedule Acceleration Assistant",
  description: "Detects schedule slippage and recommends recovery actions: task parallelization, scope reduction, and agent/resource deployment",
  kind: "schedule",
  version: "1.0.0",
  
  async register(api: BuilderForceAgentsPluginApi) {
    // Register tools for schedule analysis
    api.registerTool(
      () => {
        // Get plugin config
        const config = api.config;
        const baselineSlippageThreshold = config?.baselineSlippageThreshold ?? 10;
        const enableParallelizationFlags = config?.enableParallelizationFlags ?? true;
        const enableScopeReductionFlags = config?.enableScopeReductionFlags ?? true;
        const enableResourceDeploymentFlags = config?.enableResourceDeploymentFlags ?? true;

        const engine = new ScheduleAnalysisEngine({
          baselineSlippageThreshold,
          enableParallelizationFlags,
          enableScopeReductionFlags,
          enableResourceDeploymentFlags
        });

        const analyzeScheduleTool = createTool({
          name: "analyze_schedule",
          description: "Detects schedule slippage and generates recovery recommendations. FR-1 to FR-6 are implemented.",
          parameters: {
            type: "object",
            properties: {
              projectId: { type: "string", description: "Project ID to analyze" },
              forceAnalysis: { 
                type: "boolean", 
                description: "Force analysis even if slippage threshold is not met" 
              }
            },
            required: ["projectId"]
          },
          handler: async (ctx) => {
            try {
              const projectId = ctx.args.projectId;
              
              // Generate recovery plan
              const plan: RecoveryPlan = await engine.generateRecoveryPlan(projectId);
              
              // Format for human-readable output
              const summary = await formatRecoveryPlanSummary(plan);
              
              return {
                status: "success",
                message: "Schedule analysis complete",
                data: plan,
                summary
              };
            } catch (error) {
              return {
                status: "error",
                error: error instanceof Error ? error.message : "Unknown error during schedule analysis"
              };
            }
          }
        });
        
        const getRecoveryPlanTool = createTool({
          name: "get_recovery_plan",
          description: "Retrieves the latest schedule recovery plan for a project. FR-6 specifies output formats.",
          parameters: {
            type: "object",
            properties: {
              projectId: { type: "string", description: "Project ID" }
            },
            required: ["projectId"]
          },
          handler: async (ctx) => {
            try {
              const projectId = ctx.args.projectId;
              const repository = new ScheduleRepository(projectId);
              const engine = new ScheduleAnalysisEngine(config as Record<string, unknown>);
              
              return {
                status: "success",
                data: await engine.generateRecoveryPlan(projectId, config as Record<string, unknown>)
              };
            } catch (error) {
              return {
                status: "error",
                error: error instanceof Error ? error.message : "Unknown error retrieving recovery plan"
              };
            }
          }
        });
        
        // Export tool function for direct invocation
        (api.runtime.tools as any).scheduleAnalysis = {
          analyze: (projectId: string, force?: boolean) => 
            analyzeScheduleTool.handler({ args: { projectId, forceAnalysis: force } }, {}, {}),
          getPlan: (projectId: string) => 
            getRecoveryPlanTool.handler({ args: { projectId } }, {}, {})
        };

        return [analyzeScheduleTool, getRecoveryPlanTool];
      },
      { names: ["analyze_schedule", "get_recovery_plan"] }
    );
  }
};

/**
 * Format recovery plan for human-readable output
 * Supports FR-6.4: Markdown and JSON export formats
 */
async function formatRecoveryPlanSummary(plan: RecoveryPlan): Promise<
  | string
> {
  const lines: string[] = [];
  
  lines.push(`# Schedule Acceleration Recovery Plan`);
  lines.push(`Generated: ${new Date(plan.timestamp).toLocaleString()}`);
  lines.push(``);
  lines.push(`## Scope`);
  lines.push(`- **Baseline Slippage**: ${plan.scope.baselineSlippage.toFixed(2)}%`);
  lines.push(`- **Severity**: ${plan.scope.severity.toUpperCase()}`);
  lines.push(``);
  lines.push(`## Projected Recovery`);
  lines.push(`- **Total Time Saved (All Recommendations)**: ~${Math.round(plan.projectedRecovery.allRecommendations)} hours`);
  lines.push(`- **Parallelization Only**: ~${Math.round(plan.projectedRecovery.parallelizationOnly)} hours`);
  lines.push(`- **Scope Reduction Only**: ~${Math.round(plan.projectedRecovery.scopeReductionOnly)} hours`);
  lines.push(``);
  lines.push(`## Recommendations`);
  lines.push(``);
  
  // Parallelization recommendations
  lines.push(`### 🔄 Parallelization Opportunities (${plan.recommendations.parallelization.length})`);
  plan.recommendations.parallelization.forEach((op, idx) => {
    lines.push(`**Option ${idx + 1}:** ${op.taskIds.join(", ")}`);
    lines.push(`- Time Saved: ${op.estimatedTimeSaved.toFixed(1)} hours`);
    lines.push(`- Risk Level: ${op.riskLevel.toUpperCase()}`);
    lines.push(`- Impact on Critical Path: ${op.impactOnCriticalPath.toFixed(1)} hours`);
    lines.push(`- Rationale: ${op.rationale.substring(0, 150)}...`);
    lines.push(``);
  });
  
  // Scope reduction recommendations
  lines.push(`### 📉 Scope Reduction (${plan.recommendations.scopeReduction.length})`);
  plan.recommendations.scopeReduction.forEach((rec, idx) => {
    lines.push(`**Option ${idx + 1}:** ${rec.description}`);
    lines.push(`- Tasks Deferred: ${rec.tasksDeferred.length}`);
    lines.push(`- Effort Recovered: ${rec.impact.effortRecovered.toFixed(1)} hours`);
    lines.push(`- Deferral Milestone: ${rec.deferralMilestone}`);
    lines.push(`- Requires Approval: ${rec.requiresApproval}`);
    lines.push(``);
  });
  
  // Resource deployment recommendations
  lines.push(`### ⚡ Resource Deployment (${plan.recommendations.resourceDeployment.length})`);
  plan.recommendations.resourceDeployment.forEach((dep, idx) => {
    lines.push(`**Option ${idx + 1}:** Target agent: ${dep.recommendedAgentType}`);
    lines.push(`- Tasks: ${dep.targetTasks.join(", ")}`);
    lines.push(`- Net Time Saved: ${dep.netTimeSaved.toFixed(1)} hours`);
    lines.push(`- Brooks' Law Risk: ${dep.brooksLawRisk ? "🔴 HIGH" : "🟢 LOW"}`);
    lines.push(``);
  });
  
  lines.push(`## Risk Assessment: ${plan.riskAssessment.toUpperCase()}`);
  lines.push(``);
  lines.push(`## JSON Export (FR-6.4)`);
  lines.push(`\`\`\`json`);
  lines.push(JSON.stringify(plan, null, 2));
  lines.push(`\`\`\``);
  
  return lines.join("\n");
}

export default scheduleAccelerationPlugin;