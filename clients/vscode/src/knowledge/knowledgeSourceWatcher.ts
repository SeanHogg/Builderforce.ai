/**
 * Tells the Knowledge view when a DATA SOURCE's files change (traces, coverage, OpenAPI, CODEOWNERS), so the Server tab's
 * "Not set up" row turns into "Collected" without a reload. One file-system watcher per root, attached on the root's first
 * `syncStatus` read (so it exists whenever the view shows the root, running or not) and disposed with the bridge. A burst of
 * changes settles for {@link SOURCES_DEBOUNCE_MS}, but never waits past {@link SOURCES_MAX_WAIT_MS} while changes keep arriving
 * (an instrumented app appends to its trace continuously); then `emit` posts one `knowledge.sources` frame for the root.
 */

import * as vscode from "vscode";
import { CODEOWNERS_LOCATIONS, COVERAGE_FILES, TRACE_DIR } from "@builderforce/agent-tools/knowledge";
import { OPENAPI_LOCATIONS } from "./knowledgeSyncStatus";

export const SOURCES_DEBOUNCE_MS = 500;
export const SOURCES_MAX_WAIT_MS = 3_000;

/** Top-level alternatives only (VS Code globs do not nest `{}`): trace files, the coverage files, OpenAPI and CODEOWNERS files. */
export const SOURCE_GLOB = `{${[
  `${TRACE_DIR}/**/*.jsonl`,
  ...COVERAGE_FILES.map((name) => `**/coverage/${name}`),
  ...OPENAPI_LOCATIONS,
  ...CODEOWNERS_LOCATIONS,
].join(",")}}`;

const inNodeModules = (path: string): boolean => path.includes("/node_modules/") || path.includes("\\node_modules\\");

interface Watched {
  watcher: vscode.FileSystemWatcher;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** When the first unannounced change arrived (epoch ms); undefined when none is pending. */
  pendingSince: number | undefined;
}

export class KnowledgeSourceWatcher implements vscode.Disposable {
  private readonly roots = new Map<string, Watched>();

  /** `emit` posts the `sources` frame of one root. */
  constructor(private readonly emit: (rootId: string) => void, private readonly now: () => number = Date.now) {}

  /** Watch `rootId`'s sources (whose folder is `rootPath`); a root already watched is left as it is. */
  attach(rootId: string, rootPath: string): void {
    if (this.roots.has(rootId)) return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(rootPath), SOURCE_GLOB));
    const watched: Watched = { watcher, timer: undefined, pendingSince: undefined };
    this.roots.set(rootId, watched);
    const changed = (uri: vscode.Uri): void => {
      if (!inNodeModules(uri.fsPath) && !inNodeModules(uri.path)) this.changed(rootId, watched);
    };
    watcher.onDidCreate(changed);
    watcher.onDidChange(changed);
    watcher.onDidDelete(changed);
  }

  private changed(rootId: string, watched: Watched): void {
    if (this.roots.get(rootId) !== watched) return;
    const now = this.now();
    watched.pendingSince ??= now;
    if (watched.timer) clearTimeout(watched.timer);
    const wait = Math.max(0, Math.min(SOURCES_DEBOUNCE_MS, watched.pendingSince + SOURCES_MAX_WAIT_MS - now));
    watched.timer = setTimeout(() => {
      watched.timer = undefined;
      watched.pendingSince = undefined;
      this.emit(rootId);
    }, wait);
  }

  dispose(): void {
    for (const watched of this.roots.values()) {
      if (watched.timer) clearTimeout(watched.timer);
      watched.watcher.dispose();
    }
    this.roots.clear();
  }
}
