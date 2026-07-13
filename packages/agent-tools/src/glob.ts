/**
 * A tiny, dependency-free glob matcher shared by every capability provider's
 * list_files so "find a file by name" behaves identically on the cloud Worker,
 * the Container, the on-prem Node agent, and the VS Code editor -- one matcher,
 * not four hand-rolled ones.
 *
 * Semantics (deliberately small, tuned for file discovery):
 *   - a single star matches any run of characters except a slash
 *   - a double star matches any run of characters INCLUDING slashes (crosses dirs)
 *   - a question mark matches a single character except a slash
 *   - matching is CASE-INSENSITIVE, so "Roadmap.md" finds "ROADMAP.md"
 *   - a pattern with NO slash matches the BASENAME anywhere in the tree, so the
 *     bare name "ROADMAP.md" finds "docs/ROADMAP.md" without writing a leading
 *     double-star. A pattern that contains a slash is anchored to the full path.
 */

/** Regex metacharacters (other than the glob operators handled below) that must be
 *  escaped when a literal glob character is spliced into the compiled RegExp. */
const REGEX_SPECIALS = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "/"]);

/** Compile a glob to an anchored, case-insensitive RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*"; // double star -- cross directory boundaries
        i++;
      } else {
        re += "[^/]*"; // single star -- within a path segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += REGEX_SPECIALS.has(c) ? "\\" + c : c; // escape regex specials
    }
  }
  return new RegExp("^" + re + "$", "i");
}

/**
 * Does a repo-relative POSIX path (a/b/c.ts) match the glob? A slash-free pattern
 * is tested against the basename so a bare filename finds it at any depth.
 */
export function matchGlob(pathPosix: string, pattern: string): boolean {
  const re = globToRegExp(pattern);
  if (!pattern.includes("/")) {
    const base = pathPosix.slice(pathPosix.lastIndexOf("/") + 1);
    return re.test(base);
  }
  return re.test(pathPosix);
}

/** Filter a list of repo-relative paths to those matching the pattern. */
export function filterByGlob(paths: readonly string[], pattern: string): string[] {
  return paths.filter((p) => matchGlob(p, pattern));
}

/**
 * Normalize a `path` scope argument (the `search_code` / `list_files` subdirectory
 * filter) to a clean repo-relative POSIX dir: back-slashes → forward, strip a leading
 * `./` and any surrounding slashes. `"./src/board/"` and `"src\\board"` both become
 * `"src/board"`; a blank/absent scope becomes `""` (no scope). ONE definition so every
 * capability provider (cloud GitHub-API, on-prem ripgrep, editor walk) normalizes a
 * scope identically instead of re-hand-rolling the same regex.
 */
export function normalizeScopeDir(raw: string | null | undefined): string {
  return (raw ?? "").split("\\").join("/").trim().replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
}

/**
 * Is a repo-relative POSIX path inside a normalized scope dir? True for the dir itself
 * and anything beneath it (`src/board` ⊇ `src/board`, `src/board/x.ts`), false for a
 * sibling that merely shares a prefix (`src/boardroom`). An empty scope matches every
 * path (no scope). Shared prefix-match so provider scope-filtering can't drift.
 */
export function isUnderScopeDir(pathPosix: string, scopeDir: string): boolean {
  if (!scopeDir) return true;
  const p = pathPosix.split("\\").join("/");
  return p === scopeDir || p.startsWith(`${scopeDir}/`);
}
