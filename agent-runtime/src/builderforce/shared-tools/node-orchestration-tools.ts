/**
 * Node-native orchestration + session tools, as shared {@link ToolDefinition}s.
 *
 * `orchestrate` / `agent_fleet` / `workflow_status` (cap `orchestrate`) and
 * `save_session_handoff` (cap `memory`) reach module-level singletons
 * (`globalOrchestrator`), the tenant fleet endpoint, and the project's
 * `.builderForceAgents` session store — all Node-only, so they live HERE (not in the
 * runtime-agnostic core) and read the working tree via `ctx.workspaceRoot`.
 *
 * The pure logic lives in the `run*` functions so the legacy pi-wrapped tools
 * delegate to the SAME implementation (DRY) until pi is removed — this module stays
 * 100% pi-free.
 */

import { randomUUID } from "node:crypto";
import { defineTool, type ToolContext, type ToolDefinition, type ToolResult } from "@builderforce/agent-tools";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { fetchFleetEntries } from "../../infra/remote-subagent.js";
import { pushSpec } from "../../infra/spec-sync.js";
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
import { buildGithubIssueWorkflowToolDef } from "../tools/github-issue-workflow-tool.js";

/** Per-run orchestration context (channel/session routing for spawned subagents) +
 *  optional ticket linkage. Injected at registry-build time on surfaces that have it;
 *  the local engine registers with an empty context (workflow still runs). */
export type OrchestrationContext = SpawnSubagentContext & { taskId?: number };

function rootFrom(ctx: ToolContext, args: Record<string, unknown>): string {
  const fromCtx = typeof ctx.workspaceRoot === "string" ? ctx.workspaceRoot.trim() : "";
  if (fromCtx) return fromCtx;
  const fromArg = typeof args.projectRoot === "string" ? args.projectRoot.trim() : "";
  return fromArg;
}

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

export async function runOrchestrate(opts: OrchestrateOpts, context: OrchestrationContext): Promise<Record<string, unknown>> {
  const { workflow, description, customSteps } = opts;
  try {
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

// ── Native shared ToolDefinitions ────────────────────────────────────────────────

/** Build the `orchestrate` tool bound to a per-run orchestration context. */
export function createOrchestrateToolDef(context: OrchestrationContext = {}): ToolDefinition {
  return defineTool({
    name: "orchestrate",
    description:
      "Create and execute multi-agent workflows for complex development tasks. Coordinates multiple specialized agents (code-creator, code-reviewer, test-generator, etc.) to work together.",
    parameters: {
      type: "object",
      properties: {
        workflow: { type: "string", description: "Workflow type: 'feature', 'bugfix', 'refactor', 'security_audit', 'planning', 'adversarial', or 'custom'." },
        description: { type: "string", description: "Description of the task." },
        customSteps: {
          type: "array",
          description: "Custom workflow steps (required if workflow='custom').",
          items: {
            type: "object",
            properties: {
              role: { type: "string", description: "Agent role, e.g. 'code-creator', 'code-reviewer', 'test-generator'." },
              task: { type: "string", description: "Task description for this step." },
              dependsOn: { type: "array", items: { type: "string" }, description: "Task descriptions this step depends on." },
            },
            required: ["role", "task"],
          },
        },
      },
      required: ["workflow", "description"],
    },
    requires: ["orchestrate"],
    async execute(args): Promise<ToolResult> {
      const workflow = typeof args.workflow === "string" ? args.workflow : "";
      const description = typeof args.description === "string" ? args.description : "";
      if (!workflow || !description) return { data: { error: "workflow and description are required" } };
      const customSteps = Array.isArray(args.customSteps)
        ? (args.customSteps as Array<{ role: string; task: string; dependsOn?: string[] }>)
        : undefined;
      return { data: await runOrchestrate({ workflow, description, customSteps }, context) };
    },
  });
}

export const agentFleetTool: ToolDefinition = defineTool({
  name: "agent_fleet",
  description:
    "List peer BuilderForceAgents instances in the same tenant (id, name, connection status, capabilities). Use the agentNode id with 'remote:<id>' to delegate tasks, or 'remote:auto' / 'remote:auto[cap1,cap2]' in an orchestrate step.",
  parameters: {
    type: "object",
    properties: {
      onlineOnly: { type: "boolean", description: "If true, return only currently-connected agentNodes. Default false." },
      requireCapabilities: { type: "array", items: { type: "string" }, description: "Filter to agentNodes with all listed capabilities, e.g. ['gpu','high-memory']." },
    },
  },
  requires: ["orchestrate"],
  async execute(args, ctx): Promise<ToolResult> {
    const root = rootFrom(ctx, args);
    if (!root) return { data: { error: "no workspace root available for this tool" } };
    return {
      data: await runAgentFleet(root, {
        onlineOnly: args.onlineOnly === true,
        requireCapabilities: Array.isArray(args.requireCapabilities) ? (args.requireCapabilities as string[]) : undefined,
      }),
    };
  },
});

export const workflowStatusTool: ToolDefinition = defineTool({
  name: "workflow_status",
  description: "Check the status of a multi-agent workflow and its tasks.",
  parameters: {
    type: "object",
    properties: {
      workflowId: { type: "string", description: "ID of the workflow to check. Omit to use the latest active (or latest) workflow." },
    },
  },
  requires: ["orchestrate"],
  async execute(args): Promise<ToolResult> {
    return { data: runWorkflowStatus(typeof args.workflowId === "string" ? args.workflowId : undefined) };
  },
});

export const saveSessionHandoffTool: ToolDefinition = defineTool({
  name: "save_session_handoff",
  description:
    "Save a session handoff document to .builderForceAgents/sessions/ so the next session can resume. Include a clear summary, decisions, next steps, and open questions.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session identifier. If omitted, a new UUID is generated." },
      summary: { type: "string", description: "One-paragraph summary of what was accomplished." },
      decisions: { type: "array", items: { type: "string" }, description: "Key decisions made." },
      nextSteps: { type: "array", items: { type: "string" }, description: "Concrete next steps." },
      openQuestions: { type: "array", items: { type: "string" }, description: "Unresolved questions." },
      artifacts: { type: "array", items: { type: "string" }, description: "Files/docs produced." },
    },
    required: ["summary"],
  },
  requires: ["memory"],
  async execute(args, ctx): Promise<ToolResult> {
    const root = rootFrom(ctx, args);
    if (!root) return { data: { error: "no workspace root available for this tool" } };
    const summary = typeof args.summary === "string" ? args.summary : "";
    if (!summary.trim()) return { data: { error: "summary is required" } };
    const strArr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : undefined);
    return {
      data: await runSaveSessionHandoff(root, {
        sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined,
        summary,
        decisions: strArr(args.decisions),
        nextSteps: strArr(args.nextSteps),
        openQuestions: strArr(args.openQuestions),
        artifacts: strArr(args.artifacts),
      }),
    };
  },
});

/** The Node-native orchestration + session tools. `orchestrate` is built with an
 *  empty context here; a surface with channel/session routing can build its own via
 *  {@link createOrchestrateToolDef} and register that instead. */
export const NODE_ORCHESTRATION_TOOLS: readonly ToolDefinition[] = [
  createOrchestrateToolDef(),
  agentFleetTool,
  workflowStatusTool,
  saveSessionHandoffTool,
  buildGithubIssueWorkflowToolDef(),
];
