/**
 * SpecSync — fetch assigned specs and push new specs to Builderforce.ai.
 */

import { logDebug, logWarn } from "../logger.js";

export type AssignedSpec = {
  id: string;
  goal: string;
  status: string;
  prd: string | null;
  archSpec: string | null;
  taskList: string | null;
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SpecSyncOptions = {
  baseUrl: string;
  agentNodeId: string;
  apiKey: string;
};

/**
 * Fetch the active spec assigned to this agentNode's primary project.
 * Returns null if no spec is found or the endpoint is unavailable.
 */
export async function fetchAssignedSpec(opts: SpecSyncOptions): Promise<AssignedSpec | null> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/agent-hosts/${opts.agentNodeId}/spec`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      logDebug(`[spec-sync] fetch failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { spec: AssignedSpec | null };
    return data.spec ?? null;
  } catch (err) {
    logDebug(`[spec-sync] fetch error: ${String(err)}`);
    return null;
  }
}

/**
 * Fetch the PRD(s) linked to a specific task (primary first). Returns [] when
 * none are linked or the endpoint is unavailable. This is the task-scoped context
 * the executing agent should read — falls back to {@link fetchAssignedSpec} (the
 * project default) when a task has no linked PRD.
 */
export async function fetchAssignedSpecsForTask(
  opts: SpecSyncOptions,
  taskId: number,
): Promise<AssignedSpec[]> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/agent-hosts/${opts.agentNodeId}/tasks/${taskId}/specs`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logDebug(`[spec-sync] task-specs fetch failed: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { specs: AssignedSpec[] };
    return data.specs ?? [];
  } catch (err) {
    logDebug(`[spec-sync] task-specs fetch error: ${String(err)}`);
    return [];
  }
}

/**
 * Push a spec (PRD / arch spec / task list) to Builderforce.
 * Used by the /spec command to persist the generated spec in the cloud. When
 * `taskId` is set, the spec is linked to that task as its primary PRD.
 */
export async function pushSpec(
  opts: SpecSyncOptions,
  spec: {
    id?: string;
    projectId?: number;
    goal: string;
    status?: "draft" | "ready" | "in_progress" | "complete";
    prd?: string;
    archSpec?: string;
    taskList?: unknown;
    taskId?: number;
  },
): Promise<AssignedSpec | null> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/specs`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        "X-AgentHost-From": opts.agentNodeId,
      },
      body: JSON.stringify({ ...spec, agentNodeId: Number(opts.agentNodeId) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logWarn(`[spec-sync] push failed: HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as AssignedSpec;
  } catch (err) {
    logWarn(`[spec-sync] push error: ${String(err)}`);
    return null;
  }
}
