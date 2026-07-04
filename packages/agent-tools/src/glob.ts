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
