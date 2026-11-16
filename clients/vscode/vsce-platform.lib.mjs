/**
 * Pure helpers for `vsce-platform.mjs` — no file system, no process argv, so the
 * collision-resolution logic (version bumping, version-line rewriting, free-version
 * search) is unit-testable without running a package build.
 */

/**
 * Bump the trailing numeric run of a version, preserving any prefix.
 * `2026.10.178` → `2026.10.179`, `1.0.9` → `1.0.10`, `v2` → `v3`,
 * `1.2.3-beta.1` → `1.2.3-beta.2`. Returns null when the version has no
 * trailing digit run to bump.
 */
export function bumpPatchVersion(version) {
  const match = /^(.*?)(\d+)$/.exec(version);
  if (!match) return null;
  return `${match[1]}${Number(match[2]) + 1}`;
}

/**
 * Rewrite ONLY the `"version"` line of a package.json text, leaving every other byte
 * (key order, indentation, other fields, trailing newline) untouched. Throws when no
 * version line is found — silently rewriting nothing would package the OLD version
 * while claiming the new one.
 */
export function rewriteVersionLine(text, version) {
  const versionLine = /^([ \t]*"version"[ \t]*:[ \t]*")([^"]*)("[ \t]*,?[ \t]*)$/m;
  if (!versionLine.test(text)) {
    throw new Error('Could not locate a "version" line in package.json to rewrite.');
  }
  return text.replace(versionLine, `$1${version}$3`);
}

/**
 * Find the first version at or after `startVersion` for which `artifactExists` is
 * false. Returns `startVersion` itself when it is free; otherwise the first bumped
 * version that is. Each bumped version is RE-CHECKED, so a version that was itself
 * already packaged is skipped, never overwritten. Returns null after `maxAttempts`
 * bumps (or immediately when the version can no longer be bumped).
 */
export function nextFreeVersion(startVersion, artifactExists, maxAttempts = 100) {
  if (!artifactExists(startVersion)) return startVersion;
  let candidate = startVersion;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const next = bumpPatchVersion(candidate);
    if (!next) return null;
    candidate = next;
    if (!artifactExists(candidate)) return candidate;
  }
  return null;
}
