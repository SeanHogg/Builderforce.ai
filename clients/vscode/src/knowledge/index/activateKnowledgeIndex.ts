/**
 * Activation of the editor's knowledge index (`hostKnowledgeIndex.ts`): the workspace
 * folders and the workspace fs it persists through, and the save / delete events that
 * re-seed the workspace repository's code cards (debounced by the registry).
 */

import * as vscode from "vscode";
import type { KnowledgeIndexFiles } from "@builderforce/agent-tools/knowledge-index";
import { logLine } from "../../errorReporter";
import { getLocalModelsConfig } from "../../gateway";
import { configureEditorEmbedder } from "./embedderPort";
import { configureHostKnowledgeIndex, markKnowledgeFileChanged } from "./hostKnowledgeIndex";

const uriOf = (path: string): vscode.Uri => vscode.Uri.file(path);

/** The index's files through `vscode.workspace.fs` (bytes; an atomic rename over the old index). */
export function workspaceIndexFiles(): KnowledgeIndexFiles {
  const fs = vscode.workspace.fs;
  return {
    async read(path) {
      try {
        return await fs.readFile(uriOf(path));
      } catch {
        return undefined;
      }
    },
    write: (path, bytes) => Promise.resolve(fs.writeFile(uriOf(path), bytes)),
    rename: (from, to) => Promise.resolve(fs.rename(uriOf(from), uriOf(to), { overwrite: true })),
    mkdir: (dir) => Promise.resolve(fs.createDirectory(uriOf(dir))),
    remove: (path) => Promise.resolve(fs.delete(uriOf(path), { useTrash: false })),
  };
}

export function activateKnowledgeIndex(): vscode.Disposable[] {
  // The Ollama embedder reads the local-model settings (and their endpoint) per call.
  configureEditorEmbedder({ localModels: getLocalModelsConfig });
  configureHostKnowledgeIndex({
    workspaceRoots: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    files: workspaceIndexFiles(),
    onError: (e) => logLine(`[knowledge-index] ${e instanceof Error ? e.message : String(e)}`),
  });
  return [
    vscode.workspace.onDidSaveTextDocument((doc) => markKnowledgeFileChanged(doc.uri.fsPath)),
    vscode.workspace.onDidDeleteFiles((e) => e.files.forEach((uri) => markKnowledgeFileChanged(uri.fsPath))),
  ];
}
