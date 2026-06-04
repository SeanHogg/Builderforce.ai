/**
 * Runtime interface implementation
 * Main entry point for builderForceAgents distributed runtime
 */

import { VERSION } from "../version.js";
import { globalTaskEngine } from "./task-engine.js";
import type {
  AgentInfo,
  RuntimeInterface,
  RuntimeStatus,
  SkillInfo,
  TaskState,
  TaskSubmitRequest,
  TaskUpdateEvent,
  TransportAdapter,
} from "./types.js";

/**
 * Runtime deployment mode
 */
export type RuntimeMode = "local-only" | "remote-enabled" | "distributed-cluster";

/**
 * BuilderForceAgents runtime implementation
 */
export class BuilderForceAgentsRuntime implements RuntimeInterface {
  private adapter: TransportAdapter;
  private mode: RuntimeMode;
  private startTime: Date;
  private totalTasks = 0;

  constructor(adapter: TransportAdapter, mode: RuntimeMode = "local-only") {
    this.adapter = adapter;
    this.mode = mode;
    this.startTime = new Date();
  }

  /**
   * Submit a task to the runtime
   */
  async submitTask(request: TaskSubmitRequest): Promise<TaskState> {
    this.totalTasks++;
    return this.adapter.submitTask(request);
  }

  /**
   * Get task state
   */
  async getTaskState(taskId: string): Promise<TaskState | null> {
    return this.adapter.queryTaskState(taskId);
  }

  /**
   * Stream task updates
   */
  async *streamTaskUpdates(taskId: string): AsyncIterableIterator<TaskUpdateEvent> {
    yield* this.adapter.streamTaskUpdates(taskId);
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    return this.adapter.cancelTask(taskId);
  }

  /**
   * List available agents
   */
  async listAgents(): Promise<AgentInfo[]> {
    return this.adapter.listAgents();
  }

  /**
   * List available skills
   */
  async listSkills(): Promise<SkillInfo[]> {
    return this.adapter.listSkills();
  }

  /**
   * Get runtime status
   */
  async getStatus(): Promise<RuntimeStatus> {
    const uptime = Date.now() - this.startTime.getTime();
    const activeTasks = await globalTaskEngine.listTasks({
      status: "running",
    });

    return {
      version: VERSION,
      uptime: Math.floor(uptime / 1000),
      activeTasks: activeTasks.length,
      totalTasks: this.totalTasks,
      mode: this.mode,
      healthy: true,
    };
  }

  /**
   * Close the runtime
   */
  async close(): Promise<void> {
    await this.adapter.close();
  }
}
