/**
 * The Node executable to launch JS CLIs (`npx-cli.js`, an analyzer entry, a bare `node`) with.
 *
 * WHY. Inside VS Code `process.execPath` is `Code.exe` — a GUI-subsystem binary. Spawning it (with
 * `ELECTRON_RUN_AS_NODE`) works, but `windowsHide` / CREATE_NO_WINDOW give a GUI process NO console. When
 * that console-less process then launches a console program WITHOUT `windowsHide` (npx → `cmd.exe /c vitest`,
 * knip → `git config`), Windows gives the grandchild a NEW, VISIBLE console: a terminal window pops up on
 * every commit. A real `node.exe` is a console program, so `windowsHide` gives it a hidden console that its
 * children inherit — no windows.
 *
 * So, on Windows only: the running executable when it already IS node; otherwise the `node` found on PATH
 * (NO-HIJACK rules, {@link whichOnPathCached}) when it is at least {@link MIN_NODE_MAJOR}; `process.execPath`
 * as the last resort — with ONE warning per reason in the extension log, so a `node scripts/…` silently
 * running on Electron's Node is visible. Elsewhere `process.execPath` unchanged — the window problem is
 * Windows-only, and a macOS/Linux PATH `node` is often a version-manager shim.
 *
 * The choice itself is made per call: the PATH lookup is memoized on the current search folders (which
 * already reflect the excluded repository roots) and the version on the file's identity
 * (src/process/nodeVersionProbe.ts), so a later exclusion or `nvm use` is honoured.
 */

import * as path from "node:path";
import { probeNodeMajor } from "./nodeVersionProbe";
import { whichOnPathCached } from "./programSearch";

/** The oldest Node major the bundled CLIs (knip, vitest) are launched with. */
export const MIN_NODE_MAJOR = 20;

/** Why the choice fell back to `execPath` on Windows although the host is not node. */
export type ConsoleNodeFallback = "no-node-on-path" | "node-too-old" | "node-probe-failed";

export interface ConsoleNodeChoice {
  file: string;
  fallback?: ConsoleNodeFallback;
}

/** True when `file` names a node executable (`node` / `node.exe`), judged by `platform`'s path rules. */
export function isNodeExecutable(file: string, platform: NodeJS.Platform = process.platform): boolean {
  const base = (platform === "win32" ? path.win32.basename(file) : path.posix.basename(file)).toLowerCase();
  return base === "node" || base === "node.exe";
}

/** True when `file` is the host's own non-node executable (Electron), which must be told to run as Node. */
export function needsRunAsNode(file: string, execPath: string = process.execPath, platform: NodeJS.Platform = process.platform): boolean {
  return file === execPath && !isNodeExecutable(file, platform);
}

/**
 * The decision, pure. Not win32 → `execPath`. A node `execPath` → itself. Else `find("node")` when its
 * major version (`majorOf`, undefined when it could not be probed) is at least {@link MIN_NODE_MAJOR};
 * else `execPath` with the reason.
 */
export function chooseConsoleNode(
  execPath: string,
  platform: NodeJS.Platform,
  find: (name: string) => string | undefined,
  majorOf: (file: string) => number | undefined,
): ConsoleNodeChoice {
  if (platform !== "win32" || isNodeExecutable(execPath, platform)) return { file: execPath };
  const found = find("node");
  if (!found) return { file: execPath, fallback: "no-node-on-path" };
  const major = majorOf(found);
  if (major === undefined) return { file: execPath, fallback: "node-probe-failed" };
  return major >= MIN_NODE_MAJOR ? { file: found } : { file: execPath, fallback: "node-too-old" };
}

/**
 * The node for a program the user named as bare `node` (e.g. `node scripts/run-checks.mjs`), pure: no version floor —
 * the floor guards OUR bundled CLIs, not the user's scripts. Not win32 or already node → `execPath`; else any
 * `find("node")`; else `execPath`.
 */
export function chooseAnyNode(execPath: string, platform: NodeJS.Platform, find: (name: string) => string | undefined): string {
  if (platform !== "win32" || isNodeExecutable(execPath, platform)) return execPath;
  return find("node") ?? execPath;
}

/** {@link chooseAnyNode} for this process. */
export function anyNodePath(): string {
  return chooseAnyNode(process.execPath, process.platform, (name) => whichOnPathCached(name));
}

const warned = new Set<ConsoleNodeFallback>();

/** The Node executable whose children inherit a (hidden) console. */
export function consoleNodePath(): string {
  const choice = chooseConsoleNode(process.execPath, process.platform, (name) => whichOnPathCached(name), probeNodeMajor);
  if (choice.fallback && !warned.has(choice.fallback)) {
    warned.add(choice.fallback);
    console.warn(`[builderforce] node CLIs run on the editor's own executable (${choice.fallback}); install Node ${MIN_NODE_MAJOR}+ on PATH to avoid console windows and version drift.`);
  }
  return choice.file;
}
