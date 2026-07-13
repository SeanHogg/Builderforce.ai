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
  /** Account ID that owns this task. Required for Hen task notification. */
  accountId?: string;
  metadata?: Record<string, unknown>;
};

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
  /** Account ID that owns this task. Used to group Hen tasks per account. */
  accountId?: string;
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

// ---------------------------------------------------------------------------
// Notification domain types (Hen task completion)
// ---------------------------------------------------------------------------

/**
 * Port: Retrieves the primary email address for an account holder.
 * Single Responsibility — only account → email resolution.
 */
export interface AccountEmailResolver {
  /**
   * @returns The primary email for the account, or `null` if unknown.
   */
  getPrimaryEmail(accountId: string): Promise<string | null>;
}

/**
 * Port: Sends an email notification.
 * Single Responsibility — only email dispatch.
 */
/**
 * Port: Sends an email notification.
 * Single Responsibility — only email dispatch.
 *
 * Implementations:
 * - ResendEmailNotifier (infrastructure adapter) in agent-runtime/extensions/llm-task/src/hen-task-completion-notifier.ts
 * - MockEmailNotifier (for testing)
 *
 * Used by:
 * - HenTaskCompletionNotifier (domain service) for email delivery
 */
export interface EmailNotifier {
  /**
   * Send an email notification.
   * @returns `true` if the send succeeded, `false` otherwise.
   */
  send(to: string, subject: string, html: string): Promise<boolean>;
}

/**
 * Notification log entry for auditing (FR.5).
 *
 * Used by:
 * - HenTaskCompletionNotifier (domain service) for logging attempts
 */
export type NotificationLogEntry = {
  accountId: string;
  email: string;
  subject: string;
  sentAt: Date;
  success: boolean;
  errorMessage?: string;
};
