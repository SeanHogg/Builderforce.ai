/**
 * rules/quality/namedPaths.ts — the planned paths of C8.3, derived from what a run already carries: its plan
 * and ticket TEXT (the task prompt, a linked ticket's title and description). Pure and deterministic.
 *
 *  1. {@link pathCandidates}: path-LIKE tokens — they contain a `/` or end in a file extension; globs (`*`)
 *     included; URLs, absolute paths, npm scopes (`@x/y`) and prose words never. Normalized (`./` and
 *     backslashes), deduplicated, sorted, capped at {@link MAX_CANDIDATES}.
 *  2. {@link resolveNamedPaths}: each candidate is KEPT only when it resolves in the repository listing — an
 *     exact file, or a folder (emitted with a trailing `/`); a glob is kept when its static prefix folder
 *     exists. "The billing module" is prose and never a path; `billing/` is one only when that folder exists.
 *
 * The host decides what the listing is (a `stat` of the few candidates, a git listing, the changed files).
 * An empty result means "no plan named a path": the host then passes no `plannedPaths`, and
 * `out-of-scope-change` reports `no-plan` instead of guessing.
 */

/** At most this many path-like tokens are considered per run (a pasted log never floods the plan). */
export const MAX_CANDIDATES = 64;
/** At most this many planned paths are returned. */
export const MAX_NAMED_PATHS = 64;

/** What the extractor asks of the repository. */
export interface PathListing {
    isFile(path: string): boolean;
    isFolder(path: string): boolean;
}

const TOKEN = /[A-Za-z0-9_.@~*\-/\\]+/g;
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

/** A token longer than this is not a path anyone wrote by hand (and bounds every later regex). */
export const MAX_TOKEN_LENGTH = 200;
/** A glob with more stars than this is noise, not a plan. */
export const MAX_TOKEN_STARS = 4;

/** `Files:` / `Scope:` / `Plan:` — the line that opens an explicit plan section of a task prompt. */
const SECTION_HEAD = /^\s*(?:files|scope|plan)\s*:(.*)$/i;
/** A list item or an indented continuation line under a section head. */
const SECTION_ITEM = /^(?:\s*(?:[-*•+]|\d+[.)])\s+|\s{2,}\S)/;

/**
 * The explicit plan sections of a task prompt: each line starting `Files:`, `Scope:` or `Plan:` (any case), the rest
 * of that line, and the list under it (bullets, numbered items or indented lines) up to the first blank or ordinary
 * line. Everything else in the prompt — prose, a pasted stack trace — is not a plan. `''` when there is none.
 */
export function planSection(text: string): string {
    const out: string[] = [];
    let inSection = false;
    for (const line of text.split(/\r?\n/)) {
        const head = SECTION_HEAD.exec(line);
        if (head) { inSection = true; out.push(head[1]!); continue; }
        if (inSection && line.trim() !== '' && SECTION_ITEM.test(line)) { out.push(line); continue; }
        inSection = false;
    }
    return out.join('\n').trim();
}

function normalize(raw: string): string | undefined {
    if (raw.length > MAX_TOKEN_LENGTH || (raw.match(/\*/g)?.length ?? 0) > MAX_TOKEN_STARS) return undefined;
    // Sentence punctuation around a token goes; a leading `./` or `../` is path syntax and is kept for the checks below.
    let t = raw.replace(/\\/g, '/').replace(/^[,;:()'"`]+|[.,;:()'"`]+$/g, '');
    if (t === '' || t.includes('://') || t.startsWith('/') || t.startsWith('@') || t.startsWith('~')) return undefined;
    if (t.startsWith('../') || t === '.' || t === '..') return undefined;
    t = t.replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/');
    // A dot-path (`.github/…`, `.eslintrc.js`) is a path; stray dots (`...`) are not.
    if (t === '' || (t.startsWith('.') && !/^\.[\w-]/.test(t))) return undefined;
    // Path-like: a folder separator, or a file name with an extension (not a version like `v1.2` or a bare `e.g`);
    // a glob's stem may be all wildcard (`*.md`).
    const stem = t.replace(EXTENSION, '');
    const pathLike = t.includes('/') || (EXTENSION.test(t) && (/[A-Za-z_]/.test(stem) || /^\*+$/.test(stem)));
    if (!pathLike || /^\d+(?:\.\d+)+$/.test(t)) return undefined;
    return t;
}

/** Every path-like token of the text, normalized, sorted, capped. */
export function pathCandidates(text: string): string[] {
    const out = new Set<string>();
    for (const m of text.matchAll(TOKEN)) {
        const t = normalize(m[0]);
        if (t) out.add(t);
    }
    return [...out].sort().slice(0, MAX_CANDIDATES);
}

/** The folder a glob's static part sits in (`src/a/**\/*.ts` → `src/a`); `''` = the repository root. */
export const globBase = (glob: string): string => {
    const head = glob.slice(0, glob.indexOf('*'));
    return head.slice(0, head.lastIndexOf('/') + 1).replace(/\/$/, '');
};

/** The candidates that resolve in the listing: exact files, folders (as `dir/`), globs over an existing folder. */
export function resolveNamedPaths(candidates: readonly string[], listing: PathListing): string[] {
    const out = new Set<string>();
    for (const c of candidates) {
        if (c.includes('*')) {
            const base = globBase(c);
            if (base === '' || listing.isFolder(base)) out.add(c);
            continue;
        }
        const bare = c.replace(/\/$/, '');
        if (!c.endsWith('/') && listing.isFile(bare)) out.add(bare);
        else if (listing.isFolder(bare)) out.add(`${bare}/`);
    }
    return [...out].sort().slice(0, MAX_NAMED_PATHS);
}

export function extractNamedPaths(text: string, listing: PathListing): string[] {
    return resolveNamedPaths(pathCandidates(text), listing);
}

/** A {@link PathListing} over a list of repository files (every ancestor folder of a file is a folder). */
export function listingOf(files: Iterable<string>): PathListing {
    const fileSet = new Set<string>(), folders = new Set<string>();
    for (const f of files) {
        fileSet.add(f);
        for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) folders.add(f.slice(0, i));
    }
    return { isFile: (p) => fileSet.has(p), isFolder: (p) => folders.has(p) };
}
