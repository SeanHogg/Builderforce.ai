/**
 * W2: the ONE path-glob reading (and repo-path sanitising) the blueprint code shares (detector `reads`, Cargo
 * workspace `members`). One `*` semantic, chosen for repo paths:
 *
 * - a whole segment `*` is exactly one folder or file name (`[^/]+`): `crates/*`
 *   matches `crates/api`, never `crates/` or `crates/a/b`;
 * - a `*` inside a segment is any run of name characters, empty included (`[^/]*`):
 *   `*.csproj`, `Api*.sln`.
 *
 * No `**`, no character classes: nothing in a manifest or a `reads` entry uses them.
 */

/** `a.b` → `a\.b`: a literal for a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A path glob as a RegExp source (no anchors). */
export function pathGlobSource(glob: string): string {
  return glob
    .split('/')
    .map((segment) => (segment === '*' ? '[^/]+' : segment.split('*').map(escapeRegExp).join('[^/]*')))
    .join('/');
}

/** A path glob as an anchored RegExp: the whole path must match. */
export function pathGlobRegExp(glob: string): RegExp {
  return new RegExp(`^${pathGlobSource(glob)}$`);
}

/**
 * A path a repo file names (a solution's project), as a repo-relative path — or null
 * when it is not one: absolute, a control character / `\` / `%`, an empty segment or one
 * of only dots and spaces, or `..` climbing above the repo root. `..` inside the root
 * resolves (`api/../web/W.csproj` → `web/W.csproj`).
 * Every named path passes here before it reaches a provider URL.
 */
export function repoRelativePath(path: string): string | null {
  // Control characters, `\` and `%` (an encoded separator or dot) never reach a provider URL.
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || /[\u0000-\u001f\u007f\\%]/.test(path)) return null;
  const resolved: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    // Empty, `.`, and any run of dots and spaces (`...`, `. `) a server may fold into `.`/`..`.
    if (/^[.\s]*$/.test(segment)) return null;
    resolved.push(segment);
  }
  return resolved.length > 0 ? resolved.join('/') : null;
}
