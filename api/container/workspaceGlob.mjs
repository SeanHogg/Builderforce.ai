/**
 * GENERATED FILE — do not edit by hand.
 *
 * Compiled from `packages/agent-tools/src` (glob.ts, skipDirs.ts, workspaceList.ts) into one dependency-free ESM
 * module for the Cloudflare Container, which has no build step.
 *
 * Regenerate with `node scripts/gen-container-shared.mjs` (from `api/`).
 * `--check` fails the build when the source no longer matches the hash below.
 *
 * @source-sha256 414d9df20aa66ac567029605623b38473d693a59d90d38dc0c9516f079d8acaf
 */
import { LIST_MAX_FILES, LIST_RETURN_MAX } from './toolOutputPolicy.mjs';
// ── glob.ts ──
/**
 * A tiny, dependency-free glob matcher shared by every capability provider's
 * list_files so "find a file by name" behaves identically on the cloud Worker,
 * the Container, the on-prem Node agent, and the VS Code editor -- one matcher,
 * not four hand-rolled ones.
 *
 * Semantics (deliberately small, tuned for file discovery):
 *   - a single star matches any run of characters except a slash
 *   - a double star matches any run of characters INCLUDING slashes (crosses dirs)
 *   - `**` followed by a slash may also match ZERO directories, so "src/**\/*.ts"
 *     finds "src/index.ts" as well as "src/a/b.ts" -- the semantics minimatch, bash
 *     globstar, ripgrep --glob and VS Code all use, and the one list_files' own tool
 *     description advertises. Compiling the slash literally would force at least one
 *     intermediate directory and silently hide every file sitting directly in the
 *     scoped dir, which the zero-match note then reports as "no such file".
 *   - a question mark matches a single character except a slash
 *   - matching is CASE-INSENSITIVE, so "Roadmap.md" finds "ROADMAP.md"
 *   - a pattern with NO slash matches the BASENAME anywhere in the tree, so the
 *     bare name "ROADMAP.md" finds "docs/ROADMAP.md" without writing a leading
 *     double-star. A pattern that contains a slash is anchored to the full path.
 */
/** Regex metacharacters (other than the glob operators handled below) that must be
 *  escaped when a literal glob character is spliced into the compiled RegExp. */
const REGEX_SPECIALS = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "/"]);
/**
 * Compile a glob to an anchored, case-insensitive RegExp that cannot backtrack catastrophically: a run of three or
 * more stars is the same as `**`, repeated `**\/` segments are one, and adjacent wildcard tokens collapse into the
 * widest of them (`.*.*` → `.*`, `[^/]*[^/]*` → `[^/]*`, `.*[^/]*` → `.*`). A pattern of N adjacent stars therefore
 * compiles to ONE `.*`, never N nested ones (which backtrack exponentially on a non-matching path).
 */
function globToRegExp(pattern) {
    pattern = pattern.replace(/\*{3,}/g, "**").replace(/(?:\*\*\/){2,}/g, "**/");
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "*") {
            if (pattern[i + 1] === "*") {
                // `**/` is ONE token spanning "any number of directories, including none".
                // Consume the trailing slash with it so the slash is optional too.
                if (pattern[i + 2] === "/") {
                    re += "(?:.*/)?";
                    i += 2;
                }
                else {
                    re += ".*"; // trailing/mid-segment double star -- cross directory boundaries
                    i++;
                }
            }
            else {
                re += "[^/]*"; // single star -- within a path segment
            }
        }
        else if (c === "?") {
            re += "[^/]";
        }
        else {
            re += REGEX_SPECIALS.has(c) ? "\\" + c : c; // escape regex specials
        }
    }
    return new RegExp("^" + collapseWildcards(re) + "$", "i");
}
/** Adjacent compiled wildcards → the widest one, repeatedly (`[^/]*` ⊂ `.*`); see {@link globToRegExp}. */
function collapseWildcards(re) {
    let prev;
    do {
        prev = re;
        re = re.replace(/(?:\.\*|\[\^\/\]\*)(?:\.\*|\[\^\/\]\*)+/g, (run) => (run.includes(".*") ? ".*" : "[^/]*"));
    } while (re !== prev);
    return re;
}
/**
 * Does a repo-relative POSIX path (a/b/c.ts) match the glob? A slash-free pattern
 * is tested against the basename so a bare filename finds it at any depth.
 */
function matchGlob(pathPosix, pattern) {
    const re = globToRegExp(pattern);
    if (!pattern.includes("/")) {
        const base = pathPosix.slice(pathPosix.lastIndexOf("/") + 1);
        return re.test(base);
    }
    return re.test(pathPosix);
}
/** Filter a list of repo-relative paths to those matching the pattern. */
function filterByGlob(paths, pattern) {
    return paths.filter((p) => matchGlob(p, pattern));
}
/**
 * Does a repo-relative POSIX path match the glob RELATIVE TO the scope dir
 * `list_files` was given?
 *
 * A glob is naturally written relative to the folder you asked about — scope
 * `frontend/src/lib` and ask for `**\/*.test.ts` — but every provider filtered the
 * repo-root-relative path instead, so that glob silently matched nothing and the
 * tool's own zero-match note then told the model the files did not exist (223
 * `frontend/src/lib/**\/*.test.ts` files, reported as 0). This resolves the pattern
 * against the path both ways:
 *
 *   - as written (repo-root anchored) — so a root-relative pattern still works, and
 *   - relative to the scope dir — so a scope-relative pattern works.
 *
 * A slash-free pattern keeps the basename-anywhere rule (it matches inside the
 * scope at any depth), and a path outside the scope never matches.
 */
function matchGlobInScope(pathPosix, pattern, scopeDir) {
    const p = toPosixPath(pathPosix);
    const scope = normalizeScopeDir(scopeDir);
    if (!scope)
        return matchGlob(p, pattern);
    if (!isUnderScopeDir(p, scope))
        return false;
    if (matchGlob(p, pattern))
        return true; // pattern already written repo-root relative
    return matchGlob(p.slice(scope.length + 1), pattern); // pattern written relative to the scope
}
/** `filterByGlob`, scoped: see {@link matchGlobInScope}. */
function filterByGlobInScope(paths, pattern, scopeDir) {
    return paths.filter((p) => matchGlobInScope(p, pattern, scopeDir));
}
/** THE separator rule: back-slashes become forward slashes and nothing else changes (no trim, no `..`, no case). */
function toPosixPath(p) {
    return p.split("\\").join("/");
}
/**
 * Normalize a `path` scope argument (the `search_code` / `list_files` subdirectory
 * filter) to a clean repo-relative POSIX dir: back-slashes → forward, strip a leading
 * `./` and any surrounding slashes. `"./src/board/"` and `"src\\board"` both become
 * `"src/board"`; a blank/absent scope becomes `""` (no scope). ONE definition so every
 * capability provider (cloud GitHub-API, on-prem ripgrep, editor walk) normalizes a
 * scope identically instead of re-hand-rolling the same regex.
 */
function normalizeScopeDir(raw) {
    return toPosixPath(raw ?? "").trim().replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
}
/**
 * Is a repo-relative POSIX path inside a normalized scope dir? True for the dir itself
 * and anything beneath it (`src/board` ⊇ `src/board`, `src/board/x.ts`), false for a
 * sibling that merely shares a prefix (`src/boardroom`). An empty scope matches every
 * path (no scope). Shared prefix-match so provider scope-filtering can't drift.
 */
function isUnderScopeDir(pathPosix, scopeDir) {
    if (!scopeDir)
        return true;
    const p = toPosixPath(pathPosix);
    return p === scopeDir || p.startsWith(`${scopeDir}/`);
}
/**
 * Apply a scope-aware glob BEFORE a size cap.
 *
 * Cloud `list_files` used to slice the provider tree to 400 paths and only then
 * filter. A match sitting past that slice disappeared, and the zero-match note
 * then reported a real file as missing. Filter first so the cap counts matches.
 * `sourceTruncated` means the input list itself was cut off (GitHub `truncated`,
 * an R2 page left unread) — an empty result is then not proof of absence.
 */
function selectPathsWithinCap(paths, opts) {
    const glob = opts.glob?.trim() ? opts.glob.trim() : undefined;
    const matched = glob ? filterByGlobInScope(paths, glob, opts.scopeDir) : [...paths];
    const overCap = matched.length > opts.cap;
    return {
        paths: overCap ? matched.slice(0, opts.cap) : matched,
        truncated: overCap || opts.sourceTruncated === true,
    };
}
/**
 * What to tell the model when a glob matched nothing.
 *
 * A zero-match glob is proof of absence only when the walk covered the tree.
 * A truncated empty result means the search stopped early — never "no such file".
 */
function emptyGlobListingNote(glob, scopeDir, truncated) {
    const scope = normalizeScopeDir(scopeDir);
    const base = `No file matches glob "${glob}"${scope ? ` under "${scope}"` : ""}.`;
    if (truncated) {
        return `${base} This is NOT proof the file does not exist: the search was cut off before the tree was fully scanned, so this only means "not among the paths scanned so far". Narrow \`path\` to a smaller folder and re-run, or use \`search_code\`/\`find_symbol\` for a specific name, before concluding anything is missing.`;
    }
    return `${base} Try a broader pattern (e.g. "*${glob.replace(/[*?/]/g, "")}*"), or list_files without a glob to see the tree. 0 matches means no such file exists in the paths scanned — do not claim one is missing without trying a broader glob first.`;
}
/** Literal directory prefix a slash-anchored glob must sit under, or null when the
 *  pattern can match anywhere (no slash, or it starts with a glob metacharacter).
 *  `frontend/src/lib/**\/*.test.ts` → `frontend/src/lib/`. */
function literalGlobDirPrefix(pattern) {
    const p = toPosixPath(pattern);
    if (!p.includes("/"))
        return null;
    const meta = p.search(/[*?\[]/);
    if (meta === 0)
        return null;
    const head = meta < 0 ? p : p.slice(0, meta);
    const slash = head.lastIndexOf("/");
    if (slash < 0)
        return null;
    return head.slice(0, slash + 1);
}
function prefixCanReach(dir, prefix) {
    if (dir === "")
        return true;
    const dirSlash = `${dir}/`;
    return prefix.startsWith(dirSlash) || dirSlash.startsWith(prefix);
}
/**
 * Whether a directory walk should descend into `dirPosix`.
 *
 * A glob is applied during the walk so the file cap counts matches, but that
 * still visits every directory. Pruning directories the pattern cannot reach
 * keeps a `frontend/src/lib/**\/*.test.ts` search from exhausting its budget
 * inside unrelated trees — and from reporting a truncated miss for a file that
 * was simply never visited. A slash-free pattern, or one that starts with a
 * glob metacharacter, does not prune. A scope-relative pattern is also read
 * under `scopeDir`, so `{ path: "frontend/src", glob: "lib/**\/*.ts" }` still
 * descends into `frontend/src/lib`.
 */
function dirMayContainGlobMatch(dirPosix, pattern, scopeDir) {
    const dir = normalizeScopeDir(dirPosix);
    const scope = normalizeScopeDir(scopeDir);
    const pat = toPosixPath(pattern);
    if (scope && dir && dir !== scope && !dir.startsWith(`${scope}/`) && !scope.startsWith(`${dir}/`)) {
        return false;
    }
    const readings = [literalGlobDirPrefix(pat)];
    if (scope) {
        const rel = literalGlobDirPrefix(pat);
        readings.push(rel == null ? `${scope}/` : `${scope}/${rel}`);
    }
    for (const prefix of readings) {
        if (prefix == null) {
            if (!scope || dir === "" || dir === scope || dir.startsWith(`${scope}/`) || scope.startsWith(`${dir}/`))
                return true;
            continue;
        }
        if (prefixCanReach(dir, prefix))
            return true;
    }
    return false;
}

// ── skipDirs.ts ──
/**
 * skipDirs.ts — THE directory names no workspace walk descends into: build output,
 * dependencies, VCS stores and tool caches. One list for the definition index
 * (`node-symbols.ts`) and every knowledge review walker — the editor's and on-prem's
 * (`knowledge/fsDirectorySource.ts`) and the browser's (`@builderforce/knowledge-browser`)
 * — so the same folder gives the same graph on every host. Pure.
 */
/** Version-control stores. */
const VCS_DIRS = [".git", ".hg", ".svn"];
/** Installed-dependency and language-environment directories (never a workspace's own files, wherever they sit). */
const DEPENDENCY_DIRS = ["node_modules", ".pnpm-store", ".venv", "venv", ".tox", "__pycache__"];
/** Version-control and dependency/environment directory names: safe to match ANYWHERE in an absolute path, because no project lives inside one (a build-output name like `out` or `build` can be a parent folder, so it is not in this set). */
const DEPENDENCY_AND_VCS_DIRS = new Set([...VCS_DIRS, ...DEPENDENCY_DIRS]);
/** Whether `name` is a VCS store or an installed-dependency / language-environment directory. */
const isDependencyDirName = (name) => DEPENDENCY_AND_VCS_DIRS.has(name);
/** Build, dependency, VCS and cache OUTPUT directories: what a snapshot walk that must see every user-edited file still skips. */
const OUTPUT_DIRS = new Set([
    ...DEPENDENCY_AND_VCS_DIRS, ".next", ".nuxt", ".svelte-kit", ".wrangler", ".output", ".gradle", "dist", "build", "out", ".cache", ".turbo", ".vercel", "coverage", ".vscode-test",
]);
/** Whether `name` is a build/dependency/VCS output directory. */
const isOutputDirName = (name) => OUTPUT_DIRS.has(name);
/** {@link OUTPUT_DIRS} plus the directories not worth indexing (vendored code, target, IDE state). */
const WORKSPACE_SKIP_DIRS = new Set([...OUTPUT_DIRS, "vendor", "target", ".idea"]);
/**
 * Compiled-output names (.NET / Java `bin`, `obj`) that are ALSO real source folders in other
 * ecosystems (a JS package's `bin/` holds its CLI), so no walk skips them; only a CLASSIFIER
 * ("is this generated?", evidence sampling) treats them as generated, via {@link isGeneratedDirName}.
 */
const COMPILED_OUTPUT_DIRS = new Set(["bin", "obj"]);
/** Whether a classifier (not a walk) reads a directory called `name` as generated or vendored: any {@link WORKSPACE_SKIP_DIRS} entry or a compiled-output folder. */
const isGeneratedDirName = (name) => WORKSPACE_SKIP_DIRS.has(name) || COMPILED_OUTPUT_DIRS.has(name);
/**
 * Whether a `/` or `\` separated `path` lies inside a directory `isSkipped` accepts (default: a
 * {@link WORKSPACE_SKIP_DIRS} name; pass {@link isOutputDirName} to skip only build output and
 * dependencies), at any depth. The last segment is the file, not a directory, so it is not
 * tested. Directory names are lower-cased first, like the import/evidence rules this replaced.
 */
function isInSkippedDir(path, isSkipped = (name) => WORKSPACE_SKIP_DIRS.has(name)) {
    const segments = path.split(/[\\/]+/);
    for (let i = 0; i < segments.length - 1; i++)
        if (isSkipped((segments[i] ?? "").toLowerCase()))
            return true;
    return false;
}
/** The one hidden directory an index walk still enters: CI workflows and issue templates are source worth indexing. */
const INDEXED_DOT_DIR = ".github";
/**
 * Hidden directories a FILE LISTING still shows (`list_files`), so an agent can edit workflows,
 * editor settings and tool config. Indexing and search skip them; listing does not.
 */
const LIST_CONFIG_DOT_DIRS = new Set([
    ".github", ".vscode", ".devcontainer", ".husky", ".changeset", ".claude", ".cursor",
]);
const VCS_METADATA_NAMES = new Set(VCS_DIRS);
/** A version-control store's name (`.git`, `.hg`, `.svn`): never walked as a folder and never listed as a file (a `.git` FILE is a link to a store, not a source). */
function isVcsMetadataName(name) {
    return VCS_METADATA_NAMES.has(name);
}
/** Directory-NAME rules no walk descends into: other tools' worktrees, `*.local` scratch/state, vendored `_*_src` trees. */
const SKIPPED_DIR_NAME_RULES = [
    [/^\.worktrees$/, "worktrees"],
    [/\.local$/, "local-state"],
    [/^_.+_src$/, "vendored-src"],
];
/** The rule that skips a directory called `name`, when one of the name rules does. */
function skippedDirReason(name) {
    return SKIPPED_DIR_NAME_RULES.find(([re]) => re.test(name))?.[1];
}
/** Whether a walk skips a directory called `name`: in `skipDirs` (default {@link WORKSPACE_SKIP_DIRS}) or matching a name rule. */
function isSkippedDirName(name, skipDirs = WORKSPACE_SKIP_DIRS) {
    return skipDirs.has(name) || skippedDirReason(name) !== undefined;
}
/** Whether an INDEX / SEARCH / ANALYSIS walk enters a directory called `name`: not skipped (by `skipDirs`, default {@link WORKSPACE_SKIP_DIRS}), and not a hidden directory other than `.github`. */
function isIndexedDirName(name, skipDirs = WORKSPACE_SKIP_DIRS) {
    return !isSkippedDirName(name, skipDirs) && (!name.startsWith(".") || name === INDEXED_DOT_DIR);
}
/** Whether a FILE LISTING (`list_files`) enters a directory called `name`: not skipped, and not a hidden directory outside {@link LIST_CONFIG_DOT_DIRS}. */
function isListedDirName(name) {
    return !isSkippedDirName(name) && (!name.startsWith(".") || LIST_CONFIG_DOT_DIRS.has(name));
}

// ── workspaceList.ts ──
/**
 * workspaceList.ts - the `list_files` walk over a {@link WorkspaceFs}, ported from the VS Code
 * provider (`localCapabilities.walkFiles` + `summarizeDirs`), the most complete copy: breadth-first
 * (shallow files are collected before the budget is spent deep in one subtree), the glob applied
 * DURING the walk (so the budget counts matches, not candidates), directories the glob cannot
 * reach pruned, and a big unscoped listing collapsed to a directory summary. Pure.
 */
/** Collect root-relative file paths from `start`, bounded and sorted. */
async function walkWorkspace(fs, o) {
    const cap = o.unbounded ? Number.POSITIVE_INFINITY : LIST_MAX_FILES;
    const out = [];
    const queue = [o.start];
    let truncated = false;
    let first = true;
    while (queue.length > 0) {
        if (out.length >= cap) {
            truncated = true;
            break;
        }
        const dir = queue.shift() ?? "";
        const entries = [];
        try {
            for await (const e of fs.list(dir, {}))
                entries.push(e);
        }
        catch (e) {
            // The directory the caller NAMED failing is the caller's answer; a nested one is skipped.
            if (first)
                throw e;
            continue;
        }
        first = false;
        for (const entry of entries) {
            if (entry.kind === "dir") {
                const name = entry.path.split("/").pop() ?? entry.path;
                if (!o.dirFilter(name))
                    continue;
                // Prune directories the glob cannot reach so the match budget is not spent on unrelated trees.
                if (o.glob && !dirMayContainGlobMatch(entry.path, o.glob, o.scope))
                    continue;
                queue.push(entry.path);
            }
            else {
                if (o.glob && !matchGlobInScope(entry.path, o.glob, o.scope))
                    continue;
                if (out.length >= cap) {
                    truncated = true;
                    break;
                }
                out.push(entry.path);
            }
        }
    }
    return { paths: out.sort((a, b) => a.localeCompare(b)), truncated };
}
/**
 * Collapse a large listing to the deduped directory prefixes just below the listed folder
 * (trailing "/"), so an over-broad `list_files` returns a scoping map instead of thousands of
 * paths. Files directly at the listed folder are kept (a root doc stays discoverable).
 */
function summarizeDirs(paths, subdir) {
    const baseDepth = subdir ? subdir.split("/").filter(Boolean).length : 0;
    const depth = baseDepth + 2; // up to two levels below the listed folder
    const dirs = new Set();
    for (const p of paths) {
        const segs = p.split("/");
        if (segs.length <= 1) {
            dirs.add(p);
            continue;
        }
        const cut = Math.min(depth, segs.length - 1);
        dirs.add(`${segs.slice(0, cut).join("/")}/`);
    }
    return [...dirs].sort().slice(0, LIST_RETURN_MAX);
}
/** The `list_files` result for a finished walk: a glob returns every match, a big plain listing the summary. */
function listingResult(found, glob, subdir, unbounded) {
    if (glob || unbounded || found.paths.length <= LIST_RETURN_MAX)
        return { ok: true, paths: found.paths, truncated: found.truncated };
    return { ok: true, paths: summarizeDirs(found.paths, subdir), truncated: true };
}

export { matchGlobInScope, dirMayContainGlobMatch, emptyGlobListingNote, normalizeScopeDir, toPosixPath, isListedDirName, isVcsMetadataName, summarizeDirs, walkWorkspace, listingResult };
