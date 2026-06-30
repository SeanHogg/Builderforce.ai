/**
 * Shared Workflow Context
 * 
 * Provides a standardized mechanism for different agents/tasks within a workflow
 * to read and write shared, mutable context and data (FR.6, AC.5).
 * 
 * Each workflow execution gets its own context with a unique ID. Agents can
 * read, write, and merge context entries. Context data is persisted during
 * workflow execution for observability.
 */

export interface WorkflowContextEntry {
  key: string;
  value: any;
  sourceAgent: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface WorkflowContext {
  /** Unique execution ID */
  executionId: string;
  /** Workflow template ID (e.g., 'prd_analysis') */
  workflowType: string;
  /** Human-readable workflow name */
  workflowName: string;
  /** Root scope identifier */
  scope: string;
  /** Context entries keyed by key */
  entries: Map<string, WorkflowContextEntry>;
  /** Timestamp of creation */
  createdAt: Date;
  /** Timestamp of last update */
  updatedAt: Date;
}

/**
 * Create a new workflow context instance
 * 
 * @param executionId - Unique workflow execution identifier
 * @param workflowType - Type of workflow being executed
 * @param workflowName - Human-readable name of the workflow
 * @param scope - Root scope (e.g., project root, team, organization)
 * @returns Initialized workflow context
 */
export function createWorkflowContext(
  executionId: string,
  workflowType: string,
  workflowName: string,
  scope: string,
): WorkflowContext {
  return {
    executionId,
    workflowType,
    workflowName,
    scope,
    entries: new Map(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Write a value to the shared context
 * 
 * @param ctx - Workflow context to write to
 * @param key - Key to store the value under
 * @param value - Value to store
 * @param agentName - Name of the agent writing the value
 * @param metadata - Optional metadata about this entry
 * @returns Updated context
 */
export function writeContextEntry(
  ctx: WorkflowContext,
  key: string,
  value: any,
  agentName: string,
  metadata?: Record<string, any>,
): WorkflowContext {
  ctx.entries.set(key, {
    key,
    value,
    sourceAgent: agentName,
    timestamp: new Date(),
    metadata,
  });
  ctx.updatedAt = new Date();
  return ctx;
}

/**
 * Read a value from the shared context
 * 
 * @param ctx - Workflow context to read from
 * @param key - Key to read
 * @param defaultValue - Value to return if key not found
 * @returns The stored value or default
 */
export function readContextEntry<K>(
  ctx: WorkflowContext,
  key: string,
  defaultValue: K,
): K {
  return (ctx.entries.get(key)?.value ?? defaultValue) as K;
}

/**
 * Check if a key exists in the shared context
 * 
 * @param ctx - Workflow context to check
 * @param key - Key to check
 * @returns True if the key exists and has a value
 */
export function hasContextKey(ctx: WorkflowContext, key: string): boolean {
  return ctx.entries.has(key);
}

/**
 * Delete a key from the shared context
 * 
 * @param ctx - Workflow context to modify
 * @param key - Key to delete
 * @returns True if the key was removed
 */
export function deleteContextEntry(ctx: WorkflowContext, key: string): boolean {
  if (ctx.entries.delete(key)) {
    ctx.updatedAt = new Date();
    return true;
  }
  return false;
}

/**
 * List all keys in the shared context
 * 
 * @param ctx - Workflow context to list keys for
 * @returns Array of key names
 */
export function listContextKeys(ctx: WorkflowContext): string[] {
  return Array.from(ctx.entries.keys());
}

/**
 * Merge a partial context into the target context
 * 
 * This is useful for aggregating results from sub-workflows or branches.
 * New entries overwrite existing ones with the same key.
 * 
 * @param target - Target context to merge into
 * @param source - Source context to merge from
 * @param overwrite - Whether to overwrite existing keys (default true)
 * @returns Updated target context
 */
export function mergeContext(
  target: WorkflowContext,
  source: Omit<WorkflowContext, "entries" | "createdAt" | "updatedAt">,
  overwrite: boolean = true,
): WorkflowContext {
  // Ensure we're working with a real context if source is from merge
  if (!source.entries) {
    source.entries = new Map();
    if (source.createdAt) source.createdAt = new Date();
    if (source.updatedAt) source.updatedAt = new Date();
  }

  for (const [key, entry] of source.entries.entries()) {
    if (overwrite || !target.entries.has(key)) {
      target.entries.set(key, entry);
    }
  }
  target.updatedAt = new Date();
  return target;
}

/**
 * Get all context entries as key-value pairs
 * 
 * @param ctx - Workflow context to extract entries from
 * @returns Array of [key, value] pairs
 */
export function getContextEntries(ctx: WorkflowContext): Array<[string, any]> {
  return Array.from(ctx.entries.entries()).map(([key, entry]) => [key, entry.value]);
}

/**
 * Filter context entries by metadata or timestamp
 * 
 * @param ctx - Workflow context to filter
 * @param filterFn - Function to filter entries
 * @returns Array of filtered entries
 */
export function filterContextEntries(
  ctx: WorkflowContext,
  filterFn: (entry: WorkflowContextEntry) => boolean,
): WorkflowContextEntry[] {
  return Array.from(ctx.entries.values()).filter(filterFn);
}

/**
 * Clear all entries from context and reset timestamp
 * 
 * @param ctx - Workflow context to clear
 * @returns Cleared context
 */
export function clearContext(ctx: WorkflowContext): WorkflowContext {
  ctx.entries.clear();
  ctx.updatedAt = new Date();
  return ctx;
}