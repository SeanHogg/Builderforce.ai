/**
 * GENERATED FILE — do not edit by hand.
 *
 * Compiled from `packages/agent-tools/src` (edit.ts) into one dependency-free ESM
 * module for the Cloudflare Container, which has no build step.
 *
 * Regenerate with `node scripts/gen-container-shared.mjs` (from `api/`).
 * `--check` fails the build when the source no longer matches the hash below.
 *
 * @source-sha256 18553a62053a296e5ffefc616cdcddd08c4e54c247b1e35d4fa002decf39bd88
 */
// ── edit.ts ──
/**
 * Line-ending-tolerant, EOL-PRESERVING in-place string edit — the shared core of the
 * `edit_file` tool for the disk-backed capability providers (VS Code local + cloud).
 *
 * Why this exists: agents routinely emit `\n` line endings in `oldString` even when the
 * file on disk uses `\r\n` (Windows / CRLF). A naive `content.indexOf(oldString)` then
 * never matches and the edit fails with "oldString not found in file" — the "it tried
 * to change code and couldn't" failure seen when an agent repeatedly re-attempts the
 * same surgical edit against a CRLF file and gives up.
 *
 * Unlike the on-prem node provider's `applyEdit` (which normalizes the WHOLE file to LF
 * before writing — fine for a throwaway sandbox, but it would rewrite every line ending
 * in a user's working tree and produce a massive spurious diff), this matches tolerantly
 * yet writes back with the file's ORIGINAL line endings untouched: only the edited span
 * changes, using whichever EOL style actually matched.
 */
const toLF = (s) => s.replace(/\r\n/g, "\n");
const toCRLF = (s) => toLF(s).replace(/\n/g, "\r\n");
const countNewlines = (s) => s.split("\n").length - 1;
/** Shortest needle the "contains" fallback of {@link findNearest} will try — shorter
 *  text (`}`, `return;`) matches everywhere and would point at noise. */
const MIN_CONTAINS_NEEDLE = 8;
const EXCERPT_RADIUS = 3;
/** Context lines either side of an edited span in a success excerpt. */
const EDIT_EXCERPT_CONTEXT = 2;
/** Longest success excerpt; a bigger edit shows its head and tail around a `…` line. */
const EDIT_EXCERPT_MAX_LINES = 40;
/** `lines[from, to)` as `n: text`, numbered 1-based. */
function numberedLines(lines, from, to) {
    return lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
}
/**
 * What the file says around an edit, after it — see {@link StringEditResult.excerpt}.
 *
 * Observed (VS Code chat #133): seven edits to one file and thirteen reads of it, each
 * read checking what the edit before it had done, because a success said only
 * `{ ok: true, replaced: 1 }`.
 */
function excerptAfterEdit(content, region) {
    const lines = content.split(/\r?\n/);
    const from = Math.max(0, region.startLine - 1 - EDIT_EXCERPT_CONTEXT);
    const to = Math.min(lines.length, region.endLine + EDIT_EXCERPT_CONTEXT);
    if (to - from <= EDIT_EXCERPT_MAX_LINES)
        return numberedLines(lines, from, to);
    const half = Math.floor(EDIT_EXCERPT_MAX_LINES / 2);
    return `${numberedLines(lines, from, from + half)}\n…\n${numberedLines(lines, to - half, to)}`;
}
/** The 1-based line span of a replacement at `offset` in `content`, `newS` being what was written there. */
function regionAt(content, offset, newS) {
    const startLine = countNewlines(content.slice(0, offset)) + 1;
    return { startLine, endLine: startLine + countNewlines(newS) };
}
/** Where `oldString` most likely lives when it did not match — see {@link StringEditResult.nearest}. */
function findNearest(content, oldString) {
    const needle = oldString.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
    if (!needle)
        return undefined;
    const lines = content.split(/\r?\n/);
    let index = lines.findIndex((l) => l.trim() === needle);
    if (index === -1 && needle.length >= MIN_CONTAINS_NEEDLE)
        index = lines.findIndex((l) => l.includes(needle));
    if (index === -1)
        return undefined;
    const from = Math.max(0, index - EXCERPT_RADIUS);
    const to = Math.min(lines.length, index + EXCERPT_RADIUS + 1);
    return { line: index + 1, excerpt: numberedLines(lines, from, to) };
}
/**
 * Replace `oldString` with `newString` in `content`. Tries the literal text first, then
 * (only when the literal misses) EOL-normalized variants so an LF `oldString` still
 * matches a CRLF file and vice-versa. `newString` is rewritten to the SAME EOL style as
 * the variant that matched, so the edited region stays consistent with the file and the
 * rest of the file is left byte-for-byte intact. Pure/testable.
 *
 * Uniqueness is enforced on the matched variant: without `replaceAll`, a non-unique
 * `oldString` is an error (the caller must add context) — identical to the native edit
 * tool semantics the other providers use.
 *
 * A success carries `region` (where the first replacement landed); a miss carries
 * `nearest` (the most similar line and its neighbourhood) when one exists — the hint an
 * agent needs to stop re-sending the same wrong `oldString`.
 */
function applyStringEdit(content, oldString, newString, replaceAll = false) {
    if (typeof oldString !== "string" || oldString.length === 0) {
        return { ok: false, error: "oldString is required" };
    }
    // Candidate (search, replacement) pairs, most-specific first: the literal text, then
    // the file's dominant EOL style, then the other. Deduped so a single-line edit (no
    // newlines → every variant equal) collapses to exactly one literal attempt.
    const fileIsCRLF = content.includes("\r\n");
    const ordered = fileIsCRLF
        ? [
            { oldS: oldString, newS: newString },
            { oldS: toCRLF(oldString), newS: toCRLF(newString) },
            { oldS: toLF(oldString), newS: toLF(newString) },
        ]
        : [
            { oldS: oldString, newS: newString },
            { oldS: toLF(oldString), newS: toLF(newString) },
            { oldS: toCRLF(oldString), newS: toCRLF(newString) },
        ];
    const candidates = ordered.filter((c, i) => ordered.findIndex((d) => d.oldS === c.oldS) === i);
    for (const { oldS, newS } of candidates) {
        const first = content.indexOf(oldS);
        if (first === -1)
            continue;
        if (!replaceAll && content.indexOf(oldS, first + oldS.length) !== -1) {
            return {
                ok: false,
                error: "oldString is not unique; add more surrounding context or set replaceAll",
            };
        }
        const next = replaceAll ? content.split(oldS).join(newS) : content.replace(oldS, newS);
        const replaced = replaceAll ? content.split(oldS).length - 1 : 1;
        const region = regionAt(content, first, newS);
        return { ok: true, content: next, replaced, region, excerpt: excerptAfterEdit(next, region) };
    }
    const nearest = findNearest(content, oldString);
    return {
        ok: false,
        error: "oldString not found in file — read_file and copy the exact text (including indentation)",
        ...(nearest ? { nearest } : {}),
    };
}
/**
 * The ONE mapping from {@link applyStringEdit}'s result to what a provider returns.
 *
 * The core computed `nearest` on a miss and `region` on a hit, and two of the three
 * providers dropped both on the floor (`{ ok: false, error }` / `{ ok: true, replaced }`),
 * so the hint built to stop an agent re-sending the same wrong `oldString` never reached
 * one. Every provider spreads this instead of picking fields by hand.
 */
function editFacts(edit) {
    return {
        ...(edit.replaced != null ? { replaced: edit.replaced } : {}),
        ...(edit.region ? { region: edit.region } : {}),
        ...(edit.excerpt ? { excerpt: edit.excerpt } : {}),
        ...(edit.error ? { error: edit.error } : {}),
        ...(edit.nearest ? { nearest: edit.nearest } : {}),
    };
}

export { applyStringEdit, editFacts };
