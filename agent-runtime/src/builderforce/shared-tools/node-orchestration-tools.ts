/**
 * Node-native orchestration + session tool backends (`run*` functions).
 *
 * `orchestrate` / `agent_fleet` / `workflow_status` and `save_session_handoff` reach
 * module-level singletons (`globalOrchestrator`), the tenant fleet endpoint, and the
 * project's `.builderForceAgents` session store — all Node-only. The pure logic lives
 * here in the `run*` functions; the live native `create*Tool` `AgentTool`s delegate to
 * the SAME implementation (DRY). 100% pi-free. (The earlier duplicate `*Tool`
 * `ToolDefinition` wrappers + `NODE_ORCHESTRATION_TOOLS` array were deleted with the
 * `builderforce-local` engine — PRD 11 §5.5(a).)
 */

import { randomUUID } from "node:crypto";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { loadHiredAgentsCached } from "../../infra/hired-agents-sync.js";
import { fetchFleetEntries } from "../../infra/remote-subagent.js";
import { pushSpec } from "../../infra/spec-sync.js";
import { findAgentRole } from "../agent-roles.js";
import {
  createAdversarialReviewWorkflow,
  createBugFixWorkflow,
  createFeatureWorkflow,
  createPlanningWorkflow,
  createRefactorWorkflow,
  createSecurityAuditWorkflow,
  globalOrchestrator,
  type SpawnSubagentContext,
  type WorkflowStep,
} from "../orchestrator.js";
import { loadProjectContext, saveSessionHandoff } from "../project-context.js";

/** Per-run orchestration context (channel/session routing for spawned subagents) +
 *  optional ticket linkage. Consumed by {@link runOrchestrate}. */
export type OrchestrationContext = SpawnSubagentContext & { taskId?: number };

// ── orchestrate ──────────────────────────────────────────────────────────────────

const WORKFLOW_REGISTRY: Record<string, (description: string) => WorkflowStep[]> = {
  feature: createFeatureWorkflow,
  bugfix: createBugFixWorkflow,
  refactor: createRefactorWorkflow,
  security_audit: createSecurityAuditWorkflow,
  planning: createPlanningWorkflow,
  adversarial: createAdversarialReviewWorkflow,
};

export interface OrchestrateOpts {
  workflow: string;
  description: string;
  customSteps?: Array<{ role: string; task: string; dependsOn?: string[] }>;
}

/**
 * Refresh hired-agent roles (read-through cache) so a hired agent's roleKey/id
 * resolves at orchestration start. Cheap when warm; degrades silently to built-ins
 * only when the API key/agentNode is absent or the endpoint is unreachable.
 */
async function refreshHiredAgentRoles(): Promise<void> {
  const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
  const agentNodeId = readSharedEnvVar("BUILDERFORCE_AGENT_NODE_ID");
  const baseUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
  if (!apiKey || !agentNodeId) {
    return;
  }
  try {
    await loadHiredAgentsCached({ baseUrl, agentNodeId, apiKey });
  } catch {
    // Never block orchestration on hired-agent discovery.
  }
}

/**
 * Validate a step's role against the registry (built-ins + personas + hired
 * agents). Prefixed targets (`remote:` / `node:`) are dispatch directives, not
 * registry roles, so they pass through. Returns an error message for an unknown
 * role, or null when valid.
 */
function validateRole(role: string): string | null {
  if (role.startsWith("remote:") || role.startsWith("node:")) {
    return null;
  }
  if (findAgentRole(role)) {
    return null;
  }
  return (
    `Unknown agent role: "${role}". Use a built-in role ` +
    `(code-creator, code-reviewer, test-generator, bug-analyzer, refactor-agent, ` +
    `documentation-agent, architecture-advisor) or a hired-agent roleKey/id.`
  );
}

export async function runOrchestrate(opts: OrchestrateOpts, context: OrchestrationContext): Promise<Record<string, unknown>> {
  const { workflow, description, customSteps } = opts;
  try {
    // Pull hired agents into the role registry before resolving any role.
    await refreshHiredAgentRoles();

    let steps: WorkflowStep[];
    if (workflow === "custom") {
      if (!customSteps || customSteps.length === 0) {
        return { error: "Custom workflow requires customSteps to be provided" };
      }
      steps = customSteps;
    } else {
      const factory = WORKFLOW_REGISTRY[workflow];
      if (!factory) {
        const known = [...Object.keys(WORKFLOW_REGISTRY), "custom"].join("', '");
        return { error: `Unknown workflow type: ${workflow}. Use '${known}'.` };
      }
      steps = factory(description);
    }

    // Validate every step's role against the registry (built-in OR hired). Returns
    // a clear error for an unknown role rather than failing deep in dispatch.
    for (const step of steps) {
      const roleError = validateRole(step.role);
      if (roleError) {
        return { error: roleError };
      }
    }

    const wf = globalOrchestrator.createWorkflow(steps);
    try {
      const results = await globalOrchestrator.executeWorkflow(wf.id, context);
      if (workflow === "planning") {
        const resultValues = Array.from(results.values());
        const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
        const agentNodeId = readSharedEnvVar("BUILDERFORCE_AGENT_NODE_ID");
        const baseUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
        if (apiKey && agentNodeId) {
          void pushSpec(
            { baseUrl, agentNodeId, apiKey },
            {
              goal: description,
              status: "draft",
              prd: resultValues[0] ?? undefined,
              archSpec: resultValues[1] ?? undefined,
              taskList: resultValues[2] ?? undefined,
              ...(context.taskId != null ? { taskId: context.taskId } : {}),
            },
          );
        }
      }
      return {
        workflowId: wf.id,
        status: "completed",
        taskCount: wf.tasks.size,
        results: Array.from(results.entries()).map(([taskId, result]) => ({ taskId, result })),
        note: "Workflow completed successfully.",
      };
    } catch (executionError) {
      return {
        error: `Workflow execution failed: ${executionError instanceof Error ? executionError.message : String(executionError)}`,
      };
    }
  } catch (error) {
    return { error: `Failed to create workflow: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── agent_fleet ────────────────────────────────────────────────────────────────

export interface AgentFleetOpts {
  onlineOnly?: boolean;
  requireCapabilities?: string[];
}

export async function runAgentFleet(projectRoot: string, opts: AgentFleetOpts): Promise<Record<string, unknown>> {
  const { onlineOnly = false, requireCapabilities } = opts;
  try {
    const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
    const baseUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
    if (!apiKey) {
      return { ok: false, error: "BUILDERFORCE_API_KEY not configured. Set it in ~/.builderforce/.env to enable fleet discovery." };
    }
    const ctx = await loadProjectContext(projectRoot);
    const agentNodeId = ctx?.builderforce?.instanceId;
    if (!agentNodeId) {
      return { ok: false, error: "builderforce.instanceId not found in .builderforce/context.yaml. Run 'builderforce init' and register this agentNode first." };
    }
    const allEntries = await fetchFleetEntries({ baseUrl, myAgentNodeId: String(agentNodeId), apiKey });
    let filtered = onlineOnly ? allEntries.filter((c) => c.online) : allEntries;
    if (requireCapabilities && requireCapabilities.length > 0) {
      filtered = filtered.filter((c) => requireCapabilities.every((cap) => c.capabilities.includes(cap)));
    }
    const autoTip =
      requireCapabilities && requireCapabilities.length > 0
        ? `Use 'remote:auto[${requireCapabilities.join(",")}]' to auto-select a agentNode with these capabilities.`
        : "Use 'remote:<id>' or 'remote:auto' as the agentRole in an orchestrate workflow step.";
    return {
      ok: true,
      fleet: filtered,
      total: allEntries.length,
      online: allEntries.filter((c) => c.online).length,
      filtered: filtered.length,
      tip: autoTip,
    };
  } catch (error) {
    return { error: `Failed to query fleet: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── workflow_status ──────────────────────────────────────────────────────────────

export function runWorkflowStatus(workflowId?: string): Record<string, unknown> {
  const requestedWorkflowId = typeof workflowId === "string" && workflowId.trim().length > 0 ? workflowId.trim() : undefined;
  try {
    const workflow = requestedWorkflowId
      ? globalOrchestrator.getWorkflowStatus(requestedWorkflowId)
      : (globalOrchestrator.getLatestWorkflow({ activeOnly: true }) ?? globalOrchestrator.getLatestWorkflow());
    if (!workflow) {
      return requestedWorkflowId ? { error: `Workflow ${requestedWorkflowId} not found` } : { error: "No workflows found" };
    }
    const runnableTasks = globalOrchestrator.getRunnableTasks(workflow.id);
    return {
      workflowId: workflow.id,
      status: workflow.status,
      totalTasks: workflow.tasks.size,
      requestedWorkflowId,
      source: requestedWorkflowId ? "explicit" : "latest",
      taskStatus: {
        pending: Array.from(workflow.tasks.values()).filter((t) => t.status === "pending").length,
        running: Array.from(workflow.tasks.values()).filter((t) => t.status === "running").length,
        completed: Array.from(workflow.tasks.values()).filter((t) => t.status === "completed").length,
        failed: Array.from(workflow.tasks.values()).filter((t) => t.status === "failed").length,
      },
      nextTasks: runnableTasks.map((task) => ({ id: task.id, role: task.agentRole, description: task.description })),
      tasks: Array.from(workflow.tasks.values()).map((task) => ({
        id: task.id,
        role: task.agentRole,
        description: task.description,
        status: task.status,
        error: task.error,
        createdAt: task.createdAt.toISOString(),
        startedAt: task.startedAt?.toISOString(),
        completedAt: task.completedAt?.toISOString(),
      })),
    };
  } catch (error) {
    return { error: `Failed to check workflow status: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── save_session_handoff ─────────────────────────────────────────────────────────

export interface SaveHandoffOpts {
  sessionId?: string;
  summary: string;
  decisions?: string[];
  nextSteps?: string[];
  openQuestions?: string[];
  artifacts?: string[];
}

export async function runSaveSessionHandoff(projectRoot: string, opts: SaveHandoffOpts): Promise<Record<string, unknown>> {
  try {
    const handoff = {
      sessionId: opts.sessionId ?? randomUUID(),
      timestamp: new Date().toISOString(),
      summary: opts.summary,
      decisions: opts.decisions ?? [],
      nextSteps: opts.nextSteps ?? [],
      openQuestions: opts.openQuestions ?? [],
      artifacts: opts.artifacts ?? [],
    };
    const filePath = await saveSessionHandoff(projectRoot, handoff);
    return {
      ok: true,
      message: "Session handoff saved. The next session will resume from this point.",
      filePath,
      sessionId: handoff.sessionId,
      timestamp: handoff.timestamp,
    };
  } catch (error) {
    return { error: `Failed to save session handoff: ${error instanceof Error ? error.message : String(error)}` };
  }
}

