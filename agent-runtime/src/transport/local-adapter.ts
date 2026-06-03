/**
 * Local transport adapter - reference implementation
 * Provides in-process task execution
 */

import type { SpawnSubagentContext } from "../agents/subagent-spawn.js";
import { spawnSubagentDirect } from "../agents/subagent-spawn.js";
import { loadConfig } from "../config/config.js";
import { listAgentsForGateway } from "../gateway/session-utils.js";
import { awaitLocalSubagentResult } from "../infra/local-result-broker.js";
import { getLoadedSkills } from "../infra/skill-registry.js";
import { globalTaskEngine } from "./task-engine.js";
import type {
  AgentInfo,
  SkillInfo,
  TaskState,
  TaskSubmitRequest,
  TaskUpdateEvent,
  TransportAdapter,
} from "./types.js";

/**
 * Local transport adapter implementation
 * Executes tasks in the same process
 */
export class LocalTransportAdapter implements TransportAdapter {
  private context: SpawnSubagentContext;

  constructor(context: SpawnSubagentContext) {
    this.context = context;
  }

  /**
   * Submit a task for local execution
   */
  async submitTask(request: TaskSubmitRequest): Promise<TaskState> {
    // Create task in engine
    const task = await globalTaskEngine.createTask(request);

    // Start execution asynchronously
    this.executeTask(task, request).catch((error) => {
      void globalTaskEngine.setTaskError(task.id, error.message || String(error));
    });

    return task;
  }

  /**
   * Execute a task locally
   */
  private async executeTask(task: TaskState, request: TaskSubmitRequest): Promise<void> {
    try {
      // Transition to planning
      await globalTaskEngine.updateTaskStatus(task.id, "planning");

      // Transition to running
      await globalTaskEngine.updateTaskStatus(task.id, "running");

      // Spawn subagent for execution
      const result = await spawnSubagentDirect(
        {
          task: request.input,
          label: request.description,
          agentId: request.agentId,
          model: request.model,
          thinking: request.thinking,
        },
        this.context,
      );

      if (result.status === "accepted") {
        const output = await awaitLocalSubagentResult(
          result.runId ?? "",
          result.childSessionKey ?? "",
          600_000,
        );
        await globalTaskEngine.setTaskOutput(task.id, output || "Task completed");
        await globalTaskEngine.updateTaskStatus(task.id, "completed");
      } else {
        // Task failed
        await globalTaskEngine.setTaskError(task.id, result.error || "Failed to spawn subagent");
      }
    } catch (error) {
      await globalTaskEngine.setTaskError(
        task.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Stream task updates
   */
  async *streamTaskUpdates(taskId: string): AsyncIterableIterator<TaskUpdateEvent> {
    yield* globalTaskEngine.streamTaskUpdates(taskId);
  }

  /**
   * Query task state
   */
  async queryTaskState(taskId: string): Promise<TaskState | null> {
    return globalTaskEngine.getTask(taskId);
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    return globalTaskEngine.cancelTask(taskId);
  }

  /**
   * List available agents from the local config registry.
   */
  async listAgents(): Promise<AgentInfo[]> {
    const cfg = loadConfig();
    const { agents } = listAgentsForGateway(cfg);
    return agents.map((a) => ({
      id: a.id,
      name: a.identity?.name ?? a.name ?? a.id,
      description: "",
      capabilities: [],
    }));
  }

  /**
   * List skills loaded from the Builderforce skill registry at startup.
   */
  async listSkills(): Promise<SkillInfo[]> {
    return getLoadedSkills().map((s) => ({
      id: s.skillSlug,
      name: s.name,
      description: s.description ?? "",
      version: "1.0.0",
      enabled: true,
    }));
  }

  /**
   * Close the adapter
   */
  async close(): Promise<void> {
    // Nothing to clean up for local adapter
  }
}
