/**
 * ProjectContextPush — push local project context (governance, architecture)
 * to Builderforce so the portal and other agentNodes can access it.
 */

import { logDebug } from "../logger.js";

export type ProjectContextPushOptions = {
  baseUrl: string;
  agentNodeId: string;
  apiKey: string;
};

/**
 * Push project governance and architecture context to Builderforce.
 */
export async function pushProjectContextToBuilderforce(
  opts: ProjectContextPushOptions,
  context: {
    projectId?: number;
    governance?: string;
  },
): Promise<boolean> {
  if (!context.governance) {
    return true;
  }
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/agent-hosts/${opts.agentNodeId}/project-context`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(context),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logDebug(`[project-context-push] failed: HTTP ${res.status}`);
      return false;
    }
    logDebug(`[project-context-push] pushed governance context for project ${context.projectId}`);
    return true;
  } catch (err) {
    logDebug(`[project-context-push] error: ${String(err)}`);
    return false;
  }
}
