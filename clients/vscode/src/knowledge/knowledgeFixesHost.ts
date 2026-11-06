/**
 * The editor-bound half of the knowledge fix ports (`knowledgeFixes.ts`): which editors hold
 * unsaved changes under the root, and which files the person SAVES while a fix runs.
 *
 * Saves are recorded from `onDidSaveTextDocument`. A file-system watcher is deliberately not
 * used: knip's own writes fire it too, so a watcher event cannot tell the person's save from the
 * fix's edit - and treating every edit as the person's would keep every stray change.
 */

import * as path from "path";
import * as vscode from "vscode";
import { nodeFixPorts, type FixPorts } from "./knowledgeFixes";

const slash = (p: string): string => p.replace(/\\/g, "/");

/** The root-relative path of `fsPath`, or undefined when it is outside the root. */
export function rootRelative(rootPath: string, fsPath: string): string | undefined {
  const rel = slash(path.relative(rootPath, fsPath));
  return rel === "" || rel.startsWith("..") || path.isAbsolute(rel) ? undefined : rel;
}

export function vscodeFixPorts(rootPath: string): FixPorts & ReturnType<typeof nodeFixPorts> {
  const under = (doc: vscode.TextDocument): string | undefined => (doc.uri.scheme === "file" ? rootRelative(rootPath, doc.uri.fsPath) : undefined);
  return {
    ...nodeFixPorts(rootPath),
    dirtyBuffers() {
      return vscode.workspace.textDocuments.filter((d) => d.isDirty).flatMap((d) => {
        const rel = under(d);
        return rel ? [rel] : [];
      });
    },
    watchSaves() {
      const saved = new Set<string>();
      const sub = vscode.workspace.onDidSaveTextDocument((doc) => {
        const rel = under(doc);
        if (rel) saved.add(rel);
      });
      return { stop: () => { sub.dispose(); return [...saved]; } };
    },
  };
}
