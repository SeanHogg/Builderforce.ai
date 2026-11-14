/**
 * Claude Code auto-memory (markdown) parsing + compaction — the second file format the
 * Evermind console's "Import from builderforce-memory" action accepts.
 *
 * Where the MCP server's snapshot is ONE JSON file holding every entry, Claude Code's
 * auto-memory is a DIRECTORY: a `MEMORY.md` index plus one `*.md` file per fact, each
 * opening with a YAML frontmatter block:
 *
 *     ---
 *     name: canvas-device-frame-rule
 *     description: "Canvas previews frame the real published document…"
 *     metadata:
 *       node_type: memory
 *       type: project
 *     ---
 *     <the fact itself, markdown>
 *
 * So a memory here is `key = name` (or the filename stem), `text = body`, and
 * `prompt = description` — the same learnable shape `memorySnapshot.ts` yields, which is
 * why the importer needed no second pipeline, only per-entry SOURCE PATHS (each fact is
 * its own file, so compaction rewrites N files rather than one).
 *
 * `MEMORY.md` itself is deliberately NOT learnable: it is a table of contents of links
 * into the per-fact files, so absorbing it teaches nothing new and stubbing it would
 * destroy the index the rest of the directory is navigated by.
 *
 * Stub text, idempotency, the recall probe and the archive come from the memory server's
 * `compaction` rules — ONE marker across both formats, so re-importing a mixed set never
 * double-stubs anything, and a fact is never stubbed without its original archived.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { defaultArchiveFile, isStub, planLosslessCompaction, } from "@seanhogg/builderforce-memory-mcp/compaction";
/** The index file at the root of a Claude Code memory directory. */
export const MEMORY_INDEX_FILE = "MEMORY.md";
/** Extensions treated as markdown memory files. */
const MARKDOWN_EXTS = new Set([".md", ".markdown"]);
/** Strip matching surrounding quotes from a YAML scalar. */
function unquote(value) {
    const v = value.trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
        return v.slice(1, -1);
    }
    return v;
}
/**
 * Split a markdown memory file into frontmatter + body.
 *
 * Only TOP-LEVEL scalar keys are read: a key with an empty value opens a nested block
 * (`metadata:`) whose indented lines are skipped. That is everything this importer needs
 * (`name`, `description`) and it keeps a YAML dependency out of the extension bundle.
 */
export function parseFrontmatter(text) {
    const normalized = text.replace(/^\uFEFF/, "");
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalized);
    if (!match)
        return { frontmatter: "", attrs: {}, body: normalized.replace(/^(?:\r?\n)+/, "") };
    const attrs = {};
    for (const line of match[1].split(/\r?\n/)) {
        if (/^\s/.test(line) || !line.trim())
            continue; // nested block line or blank
        const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
        if (!kv)
            continue;
        const value = unquote(kv[2]);
        if (value)
            attrs[kv[1]] = value;
    }
    return {
        frontmatter: normalized.slice(0, match[0].length).replace(/\r?\n$/, ""),
        attrs,
        body: normalized.slice(match[0].length).replace(/^(?:\r?\n)+/, ""),
    };
}
/** True when `filePath` is a markdown file (per-fact or the index). */
export function isMarkdownMemoryPath(filePath) {
    return MARKDOWN_EXTS.has(path.extname(filePath).toLowerCase());
}
/** True when `filePath` is the directory's `MEMORY.md` index rather than a fact. */
export function isMemoryIndexPath(filePath) {
    return path.basename(filePath).toLowerCase() === MEMORY_INDEX_FILE.toLowerCase();
}
/** A per-fact file's memory key: its frontmatter `name`, else the filename stem. */
function markdownKey(attrs, filePath) {
    return attrs.name?.trim() || path.basename(filePath).replace(/\.(md|markdown)$/i, "");
}
/**
 * Turn one markdown memory file's text into a learnable entry, or `null` when there is
 * nothing to learn — an empty body, or a body that is already a compaction stub (so
 * re-importing a directory is idempotent, exactly as the JSON path is).
 */
export function markdownEntry(text, filePath) {
    const { attrs, body } = parseFrontmatter(text);
    const key = markdownKey(attrs, filePath);
    if (!key || !body.trim() || isStub(body))
        return null;
    const prompt = attrs.description?.trim();
    return { key, text: body, path: filePath, ...(prompt ? { prompt } : {}) };
}
/**
 * The archive a memory DIRECTORY's compacted facts are kept in: one sidecar beside the
 * `MEMORY.md` index (`MEMORY.archive.json`, the snapshot's `defaultArchiveFile`
 * convention), never a `*.md` — so it is not itself read back as a fact.
 */
export function markdownArchiveFile(filePath) {
    return defaultArchiveFile(path.join(path.dirname(filePath), MEMORY_INDEX_FILE.replace(/\.md$/i, ".json")));
}
/**
 * Plan the LOSSLESS rewrite of a markdown memory file's BODY to a terse stub, keeping its
 * frontmatter intact (the `name` is the entry's key and the index links to the file by
 * name — losing either would orphan the pointer). The memory server's rules apply
 * (`planLosslessCompaction`): the body is stubbed only once `probe` answers the question
 * generated from it, and the caller writes `archive` to {@link markdownArchiveFile}
 * BEFORE `next`. A fact left whole — no body, already a stub, a stub no smaller, or an
 * absorption the probe did not prove — comes back as `skipped`, with the reason.
 */
export async function compactMarkdownMemory(text, filePath, version, probe) {
    const { frontmatter, attrs, body } = parseFrontmatter(text);
    const plan = await planLosslessCompaction([{ key: markdownKey(attrs, filePath), content: body }], { version, probe });
    const write = plan.writes[0];
    if (!write)
        return { skipped: plan.skipped[0] ?? { key: markdownKey(attrs, filePath), reason: "not_found" } };
    const next = frontmatter ? `${frontmatter}\n\n${write.content}\n` : `${write.content}\n`;
    return { next, bytesSaved: write.bytesSaved, archive: write.archive };
}
/** Read every learnable per-fact entry in a memory directory, sorted by file name. */
export async function readMemoryDirectory(dir) {
    const names = (await fs.readdir(dir)).filter((n) => isMarkdownMemoryPath(n) && !isMemoryIndexPath(n)).sort();
    const entries = [];
    for (const name of names) {
        const filePath = path.join(dir, name);
        let text;
        try {
            text = await fs.readFile(filePath, "utf8");
        }
        catch {
            continue; // a directory that happens to end in .md, or an unreadable file
        }
        const entry = markdownEntry(text, filePath);
        if (entry)
            entries.push(entry);
    }
    return entries;
}
/**
 * Resolve whatever the user picked into markdown memory entries, or `null` when the
 * target is not markdown at all (the caller then tries the JSON snapshot path).
 *
 * Accepts a memory DIRECTORY, its `MEMORY.md` index (the file a file-picker can reach),
 * or a single per-fact `*.md`.
 */
export async function readMarkdownMemorySource(target) {
    let isDirectory = false;
    try {
        isDirectory = (await fs.stat(target)).isDirectory();
    }
    catch {
        return null;
    }
    if (isDirectory)
        return readMemoryDirectory(target);
    if (!isMarkdownMemoryPath(target))
        return null;
    if (isMemoryIndexPath(target))
        return readMemoryDirectory(path.dirname(target));
    const entry = markdownEntry(await fs.readFile(target, "utf8"), target);
    return entry ? [entry] : [];
}
//# sourceMappingURL=markdownMemory.js.map