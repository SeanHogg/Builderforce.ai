/**
 * Prose-only compression — `compressProse(text, kind)` — the ONE rule for "may this text
 * be token-compressed": prose (docs, notes, logs) may, code never. An edit needs the exact
 * bytes of a code file, and LLMLingua-2 drops tokens, so a code kind is returned untouched
 * whatever the caller asks. Shared by `read_compressed` and context ingress (attachments).
 *
 * Pure and runtime-agnostic: the compressor is injected (the Desktop semantic capability's
 * `compress`), and {@link compressLargeContext} still keeps fenced code verbatim inside
 * prose and falls back to the original on any failure.
 */
import { compressLargeContext } from "./compress.js";
const PROSE_BY_EXT = {
    md: "markdown", mdx: "markdown", markdown: "markdown", rst: "markdown", adoc: "markdown", asciidoc: "markdown", org: "markdown",
    txt: "text", text: "text",
    log: "log",
};
/** The prose extensions `read_compressed` accepts, for its description and refusals. */
export const PROSE_EXTENSIONS = Object.keys(PROSE_BY_EXT).map((e) => `.${e}`);
/** The kind a path's extension names — anything that is not a known prose extension is code. */
export function proseKindOf(path) {
    const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
    return PROSE_BY_EXT[ext] ?? "code";
}
/** Compress prose; return code (and anything without a compressor) unchanged. */
export async function compressProse(text, kind, opts = {}) {
    if (kind === "code" || !opts.compress)
        return { text, compressed: false, originalTokens: 0, keptTokens: 0 };
    return compressLargeContext(text, {
        compress: opts.compress,
        ...(opts.minChars !== undefined ? { minChars: opts.minChars } : {}),
        ...(opts.rate !== undefined ? { rate: opts.rate } : {}),
    });
}
//# sourceMappingURL=proseCompress.js.map