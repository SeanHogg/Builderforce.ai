/**
 * What the editor shows of a file of a knowledge root, as the `knowledge.editor` frame (the code band follows it).
 * Pure over the slice of `vscode.TextEditor` it reads, so it is tested without an editor.
 */

import * as path from "node:path";
import type { KnowledgeEditorFrame } from "./knowledgeProtocol";
import { inside, same, slash, type KnowledgeRoot } from "./knowledgeRoots";

interface Position { line: number }

/** The `vscode.TextEditor` slice the frame reads (0-based lines, as VS Code's). */
export interface EditorSlice {
  document: { uri: { scheme: string; fsPath: string } };
  visibleRanges: readonly { start: Position; end: Position }[];
  selection?: { active: Position };
}

/** The frame for `editor` when its file lies under `root` (on disk, not the root itself); null otherwise. Lines become 1-based. */
export function editorFrameOf(editor: EditorSlice | undefined, root: KnowledgeRoot | undefined): KnowledgeEditorFrame | null {
  if (!editor || !root || editor.document.uri.scheme !== "file") return null;
  const file = slash(path.resolve(editor.document.uri.fsPath));
  if (!inside(file, root.rootPath) || same(file, root.rootPath)) return null;
  const cursorLine = editor.selection ? editor.selection.active.line + 1 : null;
  const first = editor.visibleRanges[0];
  const last = editor.visibleRanges[editor.visibleRanges.length - 1];
  const firstLine = first ? first.start.line + 1 : cursorLine ?? 1;
  const lastLine = last ? last.end.line + 1 : firstLine;
  return { rootId: root.rootId, path: file.slice(root.rootPath.length + 1), firstLine, lastLine, cursorLine };
}

/** Two frames say the same (a repeat is not posted again). */
export const sameFrame = (a: KnowledgeEditorFrame | null, b: KnowledgeEditorFrame | null): boolean =>
  a === b || (!!a && !!b && a.rootId === b.rootId && a.path === b.path && a.firstLine === b.firstLine && a.lastLine === b.lastLine && a.cursorLine === b.cursorLine);
