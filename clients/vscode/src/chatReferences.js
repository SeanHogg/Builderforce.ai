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
import { ingressBlock } from "./contextIngress";
const isUri = (v) => !!v && typeof v === "object" && typeof v.scheme === "string" && typeof v.path === "string";
const isLocation = (v) => !!v && typeof v === "object" && isUri(v.uri) && !!v.range;
const withinCap = (text) => text.length <= MAX_INLINE_TEXT_BYTES;
/** The references' texts, in order; unreadable and over-large ones are left out. */
export async function readChatReferences(refs, reader) {
    const out = [];
    for (const ref of refs) {
        const value = ref.value;
        if (isLocation(value)) {
            const text = await reader.readRange(value.uri, value.range).catch(() => null);
            // Named `path:start-end`; `contextIngress` classifies it by the path alone.
            if (text && withinCap(text))
                out.push({ name: `${reader.relativePath(value.uri)}:${value.range.start.line + 1}-${value.range.end.line + 1}`, text });
        }
        else if (isUri(value)) {
            const text = await reader.readFile(value).catch(() => null);
            if (text != null && withinCap(text))
                out.push({ name: reader.relativePath(value), text });
        }
        else if (typeof value === "string" && value.trim() && withinCap(value)) {
            out.push({ name: ref.name ?? ref.id, text: value });
        }
    }
    return out;
}
/** The participant's reader: the workspace file system and open documents. */
export function workspaceReferenceReader() {
    return {
        async readFile(uri) {
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type & vscode.FileType.Directory || stat.size > MAX_INLINE_TEXT_BYTES)
                    return null;
                return (await vscode.workspace.openTextDocument(uri)).getText();
            }
            catch {
                return null;
            }
        },
        async readRange(uri, range) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                // Measured before the text is copied out: a whole-file range of a huge document.
                if (doc.offsetAt(range.end) - doc.offsetAt(range.start) > MAX_INLINE_TEXT_BYTES)
                    return null;
                return doc.getText(range);
            }
            catch {
                return null;
            }
        },
        relativePath: (uri) => vscode.workspace.asRelativePath(uri),
    };
}
/**
 * The participant's references as the turn's inlined block, read and compressed LAZILY:
 * nothing is read for a turn answered without a model, and nothing more once the request
 * is cancelled. '' when there is nothing to inline.
 */
export async function referencesTurnBlock(refs, opts) {
    if (refs.length === 0 || opts.cancelled())
        return "";
    if (opts.deterministicAnswer && (await opts.deterministicAnswer().catch(() => undefined)))
        return "";
    if (opts.cancelled())
        return "";
    const texts = await readChatReferences(refs, opts.reader);
    if (texts.length === 0 || opts.cancelled())
        return "";
    return ingressBlock(texts, await opts.budget(), opts.deps);
}
//# sourceMappingURL=chatReferences.js.map