/**
 * The native chat participant's `#file` / `#selection` references (`ChatRequest.references`)
 * read into texts for the turn's inlined block (`contextIngress.ts` — the same budget and
 * C8 step as the panel's attachments). The participant used to ignore them: the model saw
 * `#file:foo.ts` in the prompt and nothing of the file.
 *
 *   • a `Uri` → the file's text (a directory, a binary, or anything over
 *     `MAX_INLINE_TEXT_BYTES` is skipped — the prompt still names it);
 *   • a `Location` → the text of that range, named `path:start-end`;
 *   • a string value (a variable a tool resolved) → that string, named by the reference.
 *
 * No text over `MAX_INLINE_TEXT_BYTES` is read in, whatever its source.
 * {@link referencesTurnBlock} reads them only for a turn that will reach a model, and not
 * at all once the request is cancelled.
 */

import * as vscode from "vscode";
import { MAX_INLINE_TEXT_BYTES } from "@seanhogg/builderforce-brain-embedded";
import type { MentionBudget } from "@builderforce/tool-output-policy";
import { ingressBlock, type IngressDeps, type IngressText } from "./contextIngress";

/** A reference's value, as the participant receives it (`ChatPromptReference.value`). */
export interface ChatReferenceLike {
  id: string;
  name?: string;
  value: unknown;
}

/** How the references are read — `vscode` in the participant, a fake in tests. */
export interface ReferenceReader {
  /** The text of the file at `uri`; null for a directory, a binary, an over-large or unreadable file. */
  readFile(uri: vscode.Uri): Promise<string | null>;
  /** The text of `range` in the file at `uri`; null when unreadable. */
  readRange(uri: vscode.Uri, range: vscode.Range): Promise<string | null>;
  /** The workspace-relative name of `uri`. */
  relativePath(uri: vscode.Uri): string;
}

const isUri = (v: unknown): v is vscode.Uri =>
  !!v && typeof v === "object" && typeof (v as { scheme?: unknown }).scheme === "string" && typeof (v as { path?: unknown }).path === "string";

const isLocation = (v: unknown): v is { uri: vscode.Uri; range: vscode.Range } =>
  !!v && typeof v === "object" && isUri((v as { uri?: unknown }).uri) && !!(v as { range?: unknown }).range;

const withinCap = (text: string): boolean => text.length <= MAX_INLINE_TEXT_BYTES;

/** The references' texts, in order; unreadable and over-large ones are left out. */
export async function readChatReferences(refs: readonly ChatReferenceLike[], reader: ReferenceReader): Promise<IngressText[]> {
  const out: IngressText[] = [];
  for (const ref of refs) {
    const value = ref.value;
    if (isLocation(value)) {
      const text = await reader.readRange(value.uri, value.range).catch(() => null);
      // Named `path:start-end`; `contextIngress` classifies it by the path alone.
      if (text && withinCap(text)) out.push({ name: `${reader.relativePath(value.uri)}:${value.range.start.line + 1}-${value.range.end.line + 1}`, text });
    } else if (isUri(value)) {
      const text = await reader.readFile(value).catch(() => null);
      if (text != null && withinCap(text)) out.push({ name: reader.relativePath(value), text });
    } else if (typeof value === "string" && value.trim() && withinCap(value)) {
      out.push({ name: ref.name ?? ref.id, text: value });
    }
  }
  return out;
}

/** The participant's reader: the workspace file system and open documents. */
export function workspaceReferenceReader(): ReferenceReader {
  return {
    async readFile(uri) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type & vscode.FileType.Directory || stat.size > MAX_INLINE_TEXT_BYTES) return null;
        return (await vscode.workspace.openTextDocument(uri)).getText();
      } catch {
        return null;
      }
    },
    async readRange(uri, range) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        // Measured before the text is copied out: a whole-file range of a huge document.
        if (doc.offsetAt(range.end) - doc.offsetAt(range.start) > MAX_INLINE_TEXT_BYTES) return null;
        return doc.getText(range);
      } catch {
        return null;
      }
    },
    relativePath: (uri) => vscode.workspace.asRelativePath(uri),
  };
}

/** What {@link referencesTurnBlock} needs. */
export interface ReferencesTurnOptions {
  reader: ReferenceReader;
  /** The mention budget of the turn's route. Asked only when there is something to fit. */
  budget(): Promise<MentionBudget>;
  deps: IngressDeps;
  /** The turn's answer without a model ("where is X defined?"), when it has one — the
   *  SAME memoized call the run makes, so asking it here costs nothing twice. */
  answerWithoutModel?: () => Promise<string | undefined>;
  /** Whether the request was cancelled. */
  cancelled(): boolean;
}

/**
 * The participant's references as the turn's inlined block, read and compressed LAZILY:
 * nothing is read for a turn answered without a model, and nothing more once the request
 * is cancelled. '' when there is nothing to inline.
 */
export async function referencesTurnBlock(refs: readonly ChatReferenceLike[], opts: ReferencesTurnOptions): Promise<string> {
  if (refs.length === 0 || opts.cancelled()) return "";
  if (opts.answerWithoutModel && (await opts.answerWithoutModel().catch(() => undefined))) return "";
  if (opts.cancelled()) return "";
  const texts = await readChatReferences(refs, opts.reader);
  if (texts.length === 0 || opts.cancelled()) return "";
  return ingressBlock(texts, await opts.budget(), opts.deps);
}
