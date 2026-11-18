/**
 * W2: the ONE path-glob reading the blueprint code shares (detector `reads`, Cargo
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
