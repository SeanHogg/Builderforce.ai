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
 * Rewrite ONLY the top-level `"version"` line of a package.json text, leaving every
 * other byte (key order, indentation, other fields, trailing newline) untouched.
 * When several `"version"` keys exist (e.g. a nested one inside a config block), the
 * one with the LEAST indentation — the top-level key — wins, so a nested version line
 * appearing earlier in the file is never rewritten by mistake. Throws when no version
 * line is found — silently rewriting nothing would package the OLD version while
 * claiming the new one.
 */
export function rewriteVersionLine(text, version) {
  const versionLine = /^(\s*)"version"(\s*):(\s*)"([^"]*)"(\s*,?\s*)$/;
  const lines = text.split("\n");
  let best = -1;
  let bestIndent = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const m = versionLine.exec(lines[i]);
    if (!m) continue;
    if (m[1].length < bestIndent) {
      bestIndent = m[1].length;
      best = i;
    }
  }
  if (best === -1) {
    throw new Error('Could not locate a "version" line in package.json to rewrite.');
  }
  lines[best] = lines[best].replace(versionLine, (_m, ind, sp1, sp2, _v, trail) =>
    `${ind}"version"${sp1}:${sp2}"${version}"${trail}`,
  );
  return lines.join("\n");
}

/**
 * Locate a caller-supplied output path among forwarded CLI args. Handles the separate
 * value forms (`--out <path>`, `-o <path>`) and the joined forms (`--out=<path>`,
 * `-o=<path>`). Returns { index, path, joined }, or null when the caller did not
 * supply one. Extraction into the lib keeps this parsing unit-testable.
 */
export function parseOutArg(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--out" || arg === "-o") {
      return { index: i, path: args[i + 1], joined: false };
    }
    if (arg.startsWith("--out=")) {
      return { index: i, path: arg.slice("--out=".length), joined: true };
    }
    if (arg.startsWith("-o=")) {
      return { index: i, path: arg.slice("-o=".length), joined: true };
    }
  }
  return null;
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
