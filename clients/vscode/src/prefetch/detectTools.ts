/**
 * Which deterministic tools the open workspace HAS, for the PreFetch gate — a registry
 * row that `requires` a tool is offered only when it was detected
 * (docs/design/deterministic-prefetch.md). The detection itself is shared
 * (`@builderforce/agent-tools/prefetch` `detectTools` over the Node probe: `package.json`
 * dependencies and devDependencies, the workspace's `node_modules/.bin`, lockfiles and the
 * PATH, all read in-process — nothing is spawned); this module MEMOISES it per workspace
 * root and forgets a root when its `package.json` or a lockfile changes.
 *
 * No runtime `vscode` import: the file watcher's factory is handed in, so the memo is
 * tested without an editor.
 */

import type * as vscode from "vscode";
import { detectTools, type DetectedTools, type ToolProbe } from "@builderforce/agent-tools/prefetch";
import { nodeToolProbe } from "@builderforce/agent-tools/node-prefetch";

export interface ToolDetector {
  /** The memoised tools for `root`, or undefined until a detection finished. Never blocks. */
  current(root: string): DetectedTools | undefined;
  /** The tools for `root` — memoised; one detection in flight per root. */
  ensure(root: string): Promise<DetectedTools>;
  /** Forget `root` (every root when omitted): the next `ensure` detects again. */
  invalidate(root?: string): void;
}

export function createToolDetector(probeFor: (root: string) => ToolProbe = nodeToolProbe): ToolDetector {
  const done = new Map<string, DetectedTools>();
  const pending = new Map<string, Promise<DetectedTools>>();
  /** Bumped per root on invalidate, so a detection started before a change is not memoised after it. */
  const epoch = new Map<string, number>();
  return {
    current: (root) => done.get(root),
    ensure(root) {
      const hit = done.get(root);
      if (hit) return Promise.resolve(hit);
      const inFlight = pending.get(root);
      if (inFlight) return inFlight;
      const started = epoch.get(root) ?? 0;
      const work = detectTools(probeFor(root))
        .catch((): DetectedTools => new Map())
        .then((tools) => {
          if ((epoch.get(root) ?? 0) === started) done.set(root, tools);
          return tools;
        })
        .finally(() => {
          if (pending.get(root) === work) pending.delete(root);
        });
      pending.set(root, work);
      return work;
    },
    invalidate(root) {
      const roots = root === undefined ? [...new Set([...done.keys(), ...pending.keys()])] : [root];
      for (const r of roots) {
        done.delete(r);
        pending.delete(r);
        epoch.set(r, (epoch.get(r) ?? 0) + 1);
      }
    },
  };
}

/** The editor's ONE detector — every PreFetch port in this window reads it. */
export const workspaceTools: ToolDetector = createToolDetector();

/** The files whose change can change what is installed. */
export const TOOL_MANIFEST_GLOB = "**/{package.json,package-lock.json,npm-shrinkwrap.json,pnpm-lock.yaml}";

/**
 * Forget the detection when a manifest or lockfile changes (every root: a nested
 * package's manifest can be hoisted into the root's tools). Wired once at activation.
 */
export function watchToolManifests(
  workspace: Pick<typeof vscode.workspace, "createFileSystemWatcher">,
  subscriptions: { push(d: { dispose(): unknown }): unknown },
  detector: ToolDetector = workspaceTools,
): void {
  const watcher = workspace.createFileSystemWatcher(TOOL_MANIFEST_GLOB);
  const forget = (uri: vscode.Uri): void => {
    if (!/[\\/]node_modules[\\/]/.test(uri.fsPath)) detector.invalidate();
  };
  watcher.onDidChange(forget);
  watcher.onDidCreate(forget);
  watcher.onDidDelete(forget);
  subscriptions.push(watcher);
}
