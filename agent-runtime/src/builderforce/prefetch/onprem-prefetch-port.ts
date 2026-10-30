/**
 * The ON-PREM PreFetch port (docs/design/deterministic-prefetch.md) — the SAME shared
 * rows and executors the editor runs (`@builderforce/agent-tools/prefetch`), over this
 * runtime's own seams, never a copy:
 *
 *   - files through the on-prem disk provider (`buildNodeCapabilityProvider`);
 *   - commands through the on-prem shell (`buildNodeShell`, what `run_command` runs) —
 *     killed by the action's deadline or the run's abort;
 *   - tools detected in the workspace (`detectTools` over the Node probe), memoised per
 *     root and finished by `prepare` before the gate reads them;
 *   - WRITE actions confirmed through the approval gate the portal answers
 *     (`requestHumanInput`); anything but an approval declines;
 *   - `knowledge.ask` over the workspace's knowledge index (`agents/knowledge/index/`).
 *
 * Wired by `attempt.ts` for non-sandboxed runs (the disk provider writes the host's tree).
 */

import type { CapabilityProvider, ShellCapability } from "@builderforce/agent-tools";
import {
  SHARED_PREFETCH_ROWS,
  detectTools,
  offeredToolIds,
  sharedPrefetchExecutors,
  type DetectedTools,
} from "@builderforce/agent-tools/prefetch/index.js";
import { nodeToolProbe } from "@builderforce/agent-tools/node-prefetch.js";
import { KNOWLEDGE_ASK, KNOWLEDGE_ASK_ROW, knowledgeAskExecutor } from "@builderforce/agent-tools/knowledge-index.js";
import { defineRegistry, type PrefetchAction, type PrefetchPort } from "@builderforce/prefetch";
import { repoMapPort } from "@builderforce/repo-map";
import { resolve } from "node:path";
import { requestHumanInput } from "../../infra/approval-gate.js";
import { withOnPremKnowledgeRows } from "../../agents/knowledge/onPremKnowledge.js";
import { buildNodeCapabilityProvider } from "../../agents/node-capability-provider.js";
import { buildNodeShell } from "../../run/nodeShell.js";
import { onPremRootId, onPremWorkspaceKnowledgeIndex } from "../../agents/knowledge/index/onPremKnowledgeIndex.js";

/** `knowledge.ask` (the workspace's knowledge index), then the shared rows — validated once. */
export const ONPREM_PREFETCH_REGISTRY: readonly PrefetchAction[] = defineRegistry([KNOWLEDGE_ASK_ROW, ...SHARED_PREFETCH_ROWS]);

/** The longest one PreFetch command may run (each action's own budget is usually shorter). */
const COMMAND_TIMEOUT_MS = 300_000;

/**
 * One foreground command in `root`, killed on abort: THE on-prem shell (`buildNodeShell`), so the
 * working directory, the interpreter routing and the kill are the same rules `run_command` runs
 * under - not a third implementation. Only the ceiling is this port's own.
 */
export function onPremShell(root: string): ShellCapability {
  return buildNodeShell({ cwd: root, timeoutMs: COMMAND_TIMEOUT_MS });
}

/** One detection per workspace root, for the process's life. */
const detected = new Map<string, Promise<DetectedTools>>();
const ready = new Map<string, DetectedTools>();

function ensureTools(root: string): Promise<DetectedTools> {
  let work = detected.get(root);
  if (!work) {
    work = detectTools(nodeToolProbe(root)).catch((): DetectedTools => new Map());
    void work.then((tools) => ready.set(root, tools));
    detected.set(root, work);
  }
  return work;
}

export function onPremPrefetchPort(workspaceRoot: string): PrefetchPort {
  const root = resolve(workspaceRoot);
  const disk = buildNodeCapabilityProvider({ workspaceRoot: root });
  const caps: CapabilityProvider = { ...disk, capabilities: disk.capabilities, shell: onPremShell(root) };
  const port: PrefetchPort = {
    registry: ONPREM_PREFETCH_REGISTRY,
    executors: {
      ...sharedPrefetchExecutors({ caps, tools: () => ready.get(root), rootId: onPremRootId(root), repoGraph: repoMapPort }),
      [KNOWLEDGE_ASK]: knowledgeAskExecutor({ index: async () => onPremWorkspaceKnowledgeIndex(root) }),
    },
    ports: {
      surface: "onprem",
      get tools() {
        return offeredToolIds(ready.get(root));
      },
    },
    prepare: async () => {
      await ensureTools(root);
    },
    confirm: async (action, request, detail) => {
      const answer = await requestHumanInput({
        kind: "approval",
        actionType: `prefetch.${action.id}`,
        description: `Run ${action.id}? It changes files in the workspace. Request: ${request.slice(0, 240)}${detail ? ` — ${detail}` : ""}`,
        metadata: { prefetch: true, actionId: action.id, labelKey: action.labelKey, ...(detail ? { detail } : {}) },
      });
      return answer.decision === "approved";
    },
  };
  // The knowledge-graph rows (`/review`, `/graph`, PRD 38 §4.9), when linked to a project.
  return withOnPremKnowledgeRows(port, { workspaceRoot: root, caps });
}
