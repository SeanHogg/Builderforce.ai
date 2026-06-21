import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveBuilderForceAgentsDir } from "./project-dir.js";

/**
 * JSON-serializable representation of a workflow task.
 * Dates are stored as ISO strings; Map<string, Task> as Record.
 */
export type PersistedTask = {
  id: string;
  description: string;
  agentRole: string;
  status: string;
  input: string;
  output?: string;
  error?: string;
  childSessionKey?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  dependencies: string[];
  dependents: string[];
  /** Number of dispatch attempts so far (1 = first try; >1 = retried). */
  attempts?: number;
  /** Last error message observed across attempts (retained even after a later retry succeeds). */
  lastError?: string;
};

export type PersistedWorkflow = {
  id: string;
  status: string;
  createdAt: string;
  steps: Array<{ role: string; task: string; dependsOn?: string[] }>;
  tasks: Record<string, PersistedTask>;
  taskResults: Record<string, string>;
};

/**
 * Persist a workflow snapshot to .builderforce/sessions/workflow-<id>.yaml.
 */
export async function saveWorkflowState(
  projectRoot: string,
  workflow: PersistedWorkflow,
): Promise<void> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  await fs.mkdir(dir.sessionsDir, { recursive: true });
  const filePath = path.join(dir.sessionsDir, `workflow-${workflow.id}.yaml`);
  await fs.writeFile(filePath, stringifyYaml(workflow), "utf-8");
}

/**
 * Load a persisted workflow snapshot from .builderforce/sessions/workflow-<id>.yaml.
 * Returns null if not found.
 */
export async function loadWorkflowState(
  projectRoot: string,
  workflowId: string,
): Promise<PersistedWorkflow | null> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  const filePath = path.join(dir.sessionsDir, `workflow-${workflowId}.yaml`);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseYaml(content) as PersistedWorkflow;
  } catch {
    return null;
  }
}

/**
 * List all incomplete workflow IDs (status is "pending" or "running").
 * Used at startup to surface workflows that survived a restart.
 */
export async function listIncompleteWorkflowIds(projectRoot: string): Promise<string[]> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  try {
    const files = await fs.readdir(dir.sessionsDir);
    const ids: string[] = [];
    for (const file of files) {
      if (!file.startsWith("workflow-") || !file.endsWith(".yaml")) {
        continue;
      }
      const content = await fs.readFile(path.join(dir.sessionsDir, file), "utf-8");
      const wf = parseYaml(content) as PersistedWorkflow;
      if (wf.status === "pending" || wf.status === "running") {
        ids.push(wf.id);
      }
    }
    return ids;
  } catch {
    return [];
  }
}
