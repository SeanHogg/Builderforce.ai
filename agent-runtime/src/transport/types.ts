/**
 * Transport abstraction layer types for the distributed runtime
 * Enables distributed AI runtime without protocol dependencies
 */

/**
 * Task submission request
 */
export type TaskSubmitRequest = {
  agentId?: string;
  description: string;
  input: string;
  model?: string;
  thinking?: string;
  sessionId?: string;
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
  /**
   * Estimated effort for the task (e.g. story points, hours, or a complexity
   * score). Lower means less effort. Tasks without a valid (finite, >= 0)
   * estimate are excluded from the "quick wins" ranking.
   */
  estimatedEffort?: number;
  /**
   * Optional task priority used as a tie-breaker when effort estimates are
   * equal. Higher priority is preferred first.
   */
  priority?: TaskPriority;
};

/**
 * Task priority, from highest to lowest urgency. Used as a tie-breaker in the
 * quick-wins ranking when two tasks share the same estimated effort.
 */
export type TaskPriority = "critical" | "high" | "medium" | "low";

/**
 * Task status enumeration for state machine
 */
export type TaskStatus =
  | "pending"
  | "planning"
  | "running"
  | "waiting"
  | "failed"
  | "completed"
  | "cancelled";

/**
 * Task state representation
 */
export type TaskState = {
  id: string;
  status: TaskStatus;
  agentId?: string;
  description: string;
  sessionId?: string;
  parentTaskId?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  output?: string;
  error?: string;
  progress?: number;
  metadata?: Record<string, unknown>;
  /**
   * Estimated effort for the task (e.g. story points, hours, or a complexity
   * score). Lower means less effort. Tasks without a valid estimate are
   * excluded from the "quick wins" ranking.
   */
  estimatedEffort?: number;
  /** Optional priority used as a tie-breaker in the quick-wins ranking. */
  priority?: TaskPriority;
};

/**
 * A single entry in the "Top N Quick Wins" list: the smallest-effort tasks a
 * user can close fastest. Carries just enough for display and navigation.
 */
export type QuickWinTask = {
  /** Task id, used to navigate to the full task details. */
  id: string;
  /** Task title/summary shown in the quick-wins list. */
  description: string;
  /** The estimated effort that qualified this task as a quick win. */
  estimatedEffort: number;
  /** Current status of the task. */
  status: TaskStatus;
  /** Optional priority, when set. */
  priority?: TaskPriority;
  /** When the task was created (used for stable ordering). */
  createdAt: Date;
};

/**
 * Task update event
 */
export type TaskUpdateEvent = {
  taskId: string;
  status: TaskStatus;
  timestamp: Date;
  message?: string;
  progress?: number;
  data?: unknown;
};

/**
 * Agent information
 */
export type AgentInfo = {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  model?: string;
  thinking?: string;
};

/**
 * Skill information
 */
export type SkillInfo = {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
};

/**
 * Transport adapter interface
 * All communication flows through this abstraction
 */
export interface TransportAdapter {
  /**
   * Submit a new task for execution
   */
  submitTask(request: TaskSubmitRequest): Promise<TaskState>;

  /**
   * Stream updates for a task
   * Returns an async iterator of task updates
   */
  streamTaskUpdates(taskId: string): AsyncIterableIterator<TaskUpdateEvent>;

  /**
   * Query current task state
   */
  queryTaskState(taskId: string): Promise<TaskState | null>;

  /**
   * Cancel a running task
   */
  cancelTask(taskId: string): Promise<boolean>;

  /**
   * List available agents
   */
  listAgents(): Promise<AgentInfo[]>;

  /**
   * List available skills
   */
  listSkills(): Promise<SkillInfo[]>;

  /**
   * Optional helper: fetch the next queued task from a remote queue.
   * Implementations may omit this if the remote system does not support it.
   */
  fetchNextQueuedTask?(): Promise<TaskState | null>;

  /**
   * Close the transport connection
   */
  close(): Promise<void>;
}

/**
 * Runtime interface contract
 * This is what builderForceAgents exposes for orchestration
 */
export interface RuntimeInterface {
  /**
   * Submit a task to the runtime
   */
  submitTask(request: TaskSubmitRequest): Promise<TaskState>;

  /**
   * Get task state
   */
  getTaskState(taskId: string): Promise<TaskState | null>;

  /**
   * Stream task updates
   */
  streamTaskUpdates(taskId: string): AsyncIterableIterator<TaskUpdateEvent>;

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): Promise<boolean>;

  /**
   * List available agents
   */
  listAgents(): Promise<AgentInfo[]>;

  /**
   * List available skills
   */
  listSkills(): Promise<SkillInfo[]>;

  /**
   * Get runtime status
   */
  getStatus(): Promise<RuntimeStatus>;
}

/**
 * Runtime status information
 */
export type RuntimeStatus = {
  version: string;
  uptime: number;
  activeTasks: number;
  totalTasks: number;
  mode: "local-only" | "remote-enabled" | "distributed-cluster";
  healthy: boolean;
};

/**
 * Transport configuration
 */
export type TransportConfig = {
  type: string;
  enabled: boolean;
  options?: Record<string, unknown>;
};

/**
 * Configuration for the Builderforce transport adapter.
 * Points BuilderForceAgents at the Builderforce orchestration API (api.builderforce.ai).
 */
export type BuilderforceConfig = {
  /** Base URL of the Builderforce API, e.g. "https://api.builderforce.ai" */
  baseUrl: string;
  /** Optional tenant JWT used for authenticated API routes */
  authToken?: string;
  /** Optional agentNode instance id for execution attribution */
  agentNodeId?: number;
  /** Optional user ID to attach to the session */
  userId?: string;
  /** Optional device ID to attach to the session */
  deviceId?: string;
  /** How often (ms) to poll for task state updates. Default: 1000 */
  pollIntervalMs?: number;
  /** Request timeout in ms. Default: 30000 */
  timeoutMs?: number;
};
