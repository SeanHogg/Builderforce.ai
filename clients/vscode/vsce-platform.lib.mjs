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
  // Build metadata (`+...`) is NOT part of semver precedence — bumping it produces a
  // version considered EQUAL to the original, which cannot resolve a collision, so
  // refuse it outright.
  if (version.includes("+")) return null;
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
 * claiming the new one. Expects a pretty-printed (multi-line) package.json, which is
 * what this repo always has; a single-line/minified document has no line-anchored
 * version key and will throw.
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
      // A trailing flag with no value yields path === undefined; callers must guard.
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

/**
 * THE package-step decision, extracted pure so the orchestration is unit-testable
 * without running vsce. Given the package name/version, the forwarded CLI args, and
 * an artifact-existence probe, decides how a `package` invocation proceeds:
 *
 *   { ok: true, args, outPath, bumpedTo, warning }
 *       Proceed with `args`. `bumpedTo` is the new version to write into package.json
 *       before packaging (null when no bump). `warning` is an advisory message the
 *       CLI should print (currently: --auto-bump ignored under --allow-overwrite).
 *   { ok: false, error }
 *       Refuse; `error` is a user-facing message. Nothing was written anywhere.
 *
 * Handles: stripping --allow-overwrite/--auto-bump, caller output detection
 * (--out/-o/--out=<p>/-o=<p>, including the missing-value guard), default --out
 * insertion, the collision hard error, --auto-bump's free-version search, and the
 * --auto-bump + caller-out refusal. --allow-overwrite takes precedence over
 * --auto-bump and says so in `warning` rather than silently ignoring the bump.
 */
export function planPackageStep({ name, version }, rawArgs, artifactExists) {
  const args = [...rawArgs];

  const allowIdx = args.indexOf("--allow-overwrite");
  const allowOverwrite = allowIdx !== -1;
  if (allowOverwrite) args.splice(allowIdx, 1);

  const autoIdx = args.indexOf("--auto-bump");
  let autoBump = autoIdx !== -1;
  if (autoBump) args.splice(autoIdx, 1);

  let warning = null;
  if (allowOverwrite && autoBump) {
    warning = "--allow-overwrite takes precedence over --auto-bump; --auto-bump ignored.";
    autoBump = false;
  }

  const artifactPathFor = (v) => `${name}-${v}.vsix`;
  const callerOut = parseOutArg(args);
  if (callerOut && callerOut.path === undefined) {
    return { ok: false, error: "Missing value after --out/-o flag." };
  }

  // Compute the default --out AFTER the push so the value slot can never drift.
  let outValueIndex = -1;
  const outPath = callerOut ? callerOut.path : artifactPathFor(version);
  if (!callerOut) {
    args.push("--out", outPath);
    outValueIndex = args.length - 1;
  }

  if (!artifactExists(outPath) || allowOverwrite) {
    return { ok: true, args, outPath, bumpedTo: null, warning };
  }
  if (!autoBump) {
    return {
      ok: false,
      error:
        `${artifactPathFor(version)} already exists. Version ${version} has already been packaged, `
        + `and overwriting it would ship different code under a version someone may already be running. `
        + `Bump "version" in package.json, delete the existing artifact, pass --auto-bump to bump the `
        + `version automatically, or pass --allow-overwrite if you are deliberately re-cutting this exact build.`,
    };
  }
  if (callerOut) {
    return {
      ok: false,
      error:
        `--auto-bump cannot be combined with a caller-supplied output path (${callerOut.path}). `
        + `Auto-bump only helps by writing to a new, un-taken artifact path, but that path is fixed by the `
        + `caller, so the bumped version would still collide there. Pass --allow-overwrite to re-cut into `
        + `that path, or drop --out and let the artifact path default to the bumped version.`,
    };
  }

  const candidate = nextFreeVersion(version, (v) => artifactExists(artifactPathFor(v)));
  if (!candidate) {
    return {
      ok: false,
      error:
        `Auto-bump could not find a free version after 100 attempts starting from ${version}. `
        + `Bump "version" in package.json manually.`,
    };
  }
  args[outValueIndex] = artifactPathFor(candidate);
  return { ok: true, args, outPath: artifactPathFor(candidate), bumpedTo: candidate, warning };
}
