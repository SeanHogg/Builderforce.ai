/**
 * The ON-PREM PreFetch port (docs/design/deterministic-prefetch.md) — the SAME shared
 * rows and executors the editor runs (`@builderforce/agent-tools/prefetch`), over this
 * runtime's own seams, never a copy:
 *
 *   - files through the on-prem disk provider (`buildNodeCapabilityProvider`);
 *   - commands through the native exec runtime (`runExecProcess`, what the `exec` tool
 *     runs) — killed by the action's deadline or the run's abort;
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
import { runExecProcess } from "../../agents/bash-tools.exec-runtime.js";
import { resolveShellCwd } from "../../run/nodeShell.js";
import { onPremRootId, onPremWorkspaceKnowledgeIndex } from "../../agents/knowledge/index/onPremKnowledgeIndex.js";

/** `knowledge.ask` (the workspace's knowledge index), then the shared rows — validated once. */
export const ONPREM_PREFETCH_REGISTRY: readonly PrefetchAction[] = defineRegistry([KNOWLEDGE_ASK_ROW, ...SHARED_PREFETCH_ROWS]);

/** The longest one PreFetch command may run (each action's own budget is usually shorter). */
const COMMAND_TIMEOUT_SEC = 300;
/** Output kept per command before the executor caps it again. */
const COMMAND_OUTPUT_CHARS = 200_000;

/** The exec runtime as a `ShellCapability`: one foreground command in `root`, killed on abort. */
export function onPremShell(root: string): ShellCapability {
  return {
    async run(command, opts) {
      const where = resolveShellCwd(root, opts?.cwd);
      if (!where.ok) return { ok: false, error: where.error };
      const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"));
      const handle = await runExecProcess({
        command,
        workdir: where.dir,
        env,
        usePty: false,
        warnings: [],
        maxOutput: COMMAND_OUTPUT_CHARS,
        pendingMaxOutput: COMMAND_OUTPUT_CHARS,
        notifyOnExit: false,
        timeoutSec: COMMAND_TIMEOUT_SEC,
      });
      const kill = (): void => handle.kill();
      if (opts?.signal?.aborted) kill();
      opts?.signal?.addEventListener("abort", kill, { once: true });
      try {
        const outcome = await handle.promise;
        if (opts?.signal?.aborted) return { ok: false, aborted: true, stdout: outcome.aggregated };
        return {
          ok: outcome.status === "completed" && (outcome.exitCode ?? 0) === 0,
          ...(typeof outcome.exitCode === "number" ? { exitCode: outcome.exitCode } : {}),
          stdout: outcome.aggregated,
          ...(outcome.timedOut ? { error: "timed out" } : outcome.reason ? { error: outcome.reason } : {}),
        };
      } finally {
        opts?.signal?.removeEventListener("abort", kill);
      }
    },
  };
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
