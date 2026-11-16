import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { nextFreeVersion, parseOutArg, rewriteVersionLine } from "./vsce-platform.lib.mjs";

const operation = process.argv[2];
if (operation !== "package" && operation !== "publish") {
  throw new Error("Expected package or publish.");
}

const isMusl = process.platform === "linux"
  && !process.report?.getReport?.().header?.glibcVersionRuntime;
const os = process.platform === "win32"
  ? "win32"
  : process.platform === "darwin"
    ? "darwin"
    : isMusl ? "alpine" : "linux";
const architecture = process.arch === "arm64" ? "arm64" : "x64";
const target = `${os}-${architecture}`;
const require = createRequire(import.meta.url);
const vsceCli = require.resolve("@vscode/vsce/vsce");
const forwardedArgs = process.argv.slice(3);

/**
 * A version may be packaged ONCE.
 *
 * `vsce package` overwrites an existing `.vsix` without a word, so a rebuild can ship
 * different code under a version somebody is already running — and nothing downstream
 * can tell the two apart. That is not theoretical: a `2026.7.104` rebuilt with an
 * agent-stall recovery fix silently replaced a `2026.7.104` without it, and the user who
 * hit the exact bug the fix addressed reported a diagnostics dump (`UI 2026.7.104`) that
 * matched both builds.
 *
 * The bundler now stamps a source hash into every artifact (see `esbuild.mjs` /
 * `src/buildInfo.ts`), so two builds are at least DISTINGUISHABLE after the fact. This
 * check stops them being created.
 *
 * ── RESOLVING A COLLISION ──────────────────────────────────────────────────────
 * The default remains a hard error — bump the version in package.json, delete the
 * artifact you mean to replace, or pass one of two opt-in flags:
 *
 *   --allow-overwrite   Re-cut THIS exact version (overwrite the existing artifact).
 *                       Takes precedence over --auto-bump when both are passed; a
 *                       warning is printed so a caller who passed --auto-bump knows it
 *                       had no effect.
 *   --auto-bump         On collision, bump the trailing numeric component of the
 *                       version in package.json, then package under the new version.
 *                       The bump is committed to disk only when the package step
 *                       succeeds; on ANY failure (non-zero exit OR a thrown error)
 *                       package.json is rolled back via try/finally so the tree is
 *                       never left with a bumped version and no artifact.
 *
 * --auto-bump is refused together with a caller-supplied output path (--out, -o, or
 * the --out=<path> form): auto-bump only helps by writing to a new, un-taken artifact
 * path, and a caller's explicit output path is fixed — so the bumped version would
 * still collide at that path and the bump would be pure damage. Pass --allow-overwrite
 * to re-cut into a caller-supplied path instead. --auto-bump is also refused for
 * `publish` (there is no local artifact collision to resolve — the marketplace version
 * is authoritative), so a caller is never misled into thinking a publish was bumped.
 *
 * Auto-bump delegates the free-version search to the tested `nextFreeVersion` helper
 * (see `vsce-platform.lib.mjs`), which re-checks every bumped version so a bumped
 * version that was itself already packaged is skipped, never overwritten.
 *
 * ── ROLLBACK & SIGNAL SAFETY ───────────────────────────────────────────────────
 * Auto-bump writes the bumped version into package.json BEFORE invoking vsce, and
 * vsce `package` reads the version from package.json — so any `vscode:prepublish` /
 * build scripts vsce runs (or a concurrent tool/watcher) see the bumped version for
 * the duration. On success the bumped package.json is LEFT COMMITTED (that is the
 * point — the new version is now the source of truth, and the artifact path passed to
 * vsce is constructed from the same candidate, so the two cannot drift). On failure
 * the bump is rolled back in a `finally`, keyed on an explicit `succeeded` flag that
 * is set only after spawnSync returns cleanly with a zero exit status — any throw
 * anywhere in the try block leaves it false and triggers the rollback. That rollback
 * is best-effort: a throw inside it is swallowed (with a stderr note) so it cannot mask
 * the original error, and it CANNOT run if this node process itself is hard-killed
 * (SIGKILL / unrecoverable crash) between the bump and the spawn completing — in that
 * case package.json may be left with the bumped version and no artifact, and the
 * recovery is manual: check package.json and either keep the bump or revert it. Do not
 * auto-bump inside a long-running watcher where a kill is likely; bump the version
 * yourself and re-run.
 */
const allowOverwriteIndex = forwardedArgs.indexOf("--allow-overwrite");
const allowOverwrite = allowOverwriteIndex !== -1;
if (allowOverwrite) forwardedArgs.splice(allowOverwriteIndex, 1);

const autoBumpIndex = forwardedArgs.indexOf("--auto-bump");
let autoBump = autoBumpIndex !== -1;
if (autoBump) forwardedArgs.splice(autoBumpIndex, 1);

// --allow-overwrite takes precedence over --auto-bump. Warn rather than silently
// ignoring --auto-bump, so a caller who passed both knows which flag won.
if (allowOverwrite && autoBump) {
  console.warn("--allow-overwrite takes precedence over --auto-bump; --auto-bump ignored.");
  autoBump = false;
}

// --auto-bump only resolves a local artifact collision; it is meaningless for publish
// (the marketplace version is authoritative). Refuse it rather than silently stripping
// it and misleading the caller into thinking the publish was bumped.
if (autoBump && operation === "publish") {
  throw new Error("--auto-bump is only supported for `package`, not `publish`.");
}

let result;
let succeeded = false;
/** The version package.json held before any auto-bump; null when no bump happened. */
let autoBumpedFrom = null;

try {
  if (operation === "package") {
    // Parsed here (not at module top level) so a malformed/missing package.json fails
    // in the context of the operation that actually needs it — publish never reads it.
    const pkgPath = require.resolve("./package.json");
    const manifest = JSON.parse(readFileSync(pkgPath, "utf8"));

    /** Rewrite ONLY the version line of package.json, every other byte untouched. */
    const setPackageVersion = (version) => {
      writeFileSync(pkgPath, rewriteVersionLine(readFileSync(pkgPath, "utf8"), version));
    };

    /**
     * THE single source for an artifact path: both the initial collision check and
     * the auto-bump free-version search derive from this one function, so they can
     * never disagree about what path belongs to a version. Kept relative for the
     * default (what vsce has always printed/passed); resolved only where an absolute
     * path is needed for existence checks. Assumes an unscoped package name;
     * builderforce-ai is unscoped.
     */
    const artifactPathFor = (version) =>
      `${manifest.name}-${version}.vsix`;

    const callerOut = parseOutArg(forwardedArgs);
    let defaultOutValueIndex = -1;
    const outPath = callerOut
      ? callerOut.path
      : artifactPathFor(manifest.version);
    if (!callerOut) {
      forwardedArgs.push("--out", outPath);
      // The value slot we just pushed — computed AFTER the push so no later arg
      // mutation can silently shift it before the auto-bump overwrite below.
      defaultOutValueIndex = forwardedArgs.length - 1;
    }
    const absolute = resolve(outPath);

    if (existsSync(absolute) && !allowOverwrite) {
      if (!autoBump) {
        throw new Error(
          `${basename(absolute)} already exists.\n`
            + `Version ${manifest.version} has already been packaged, and overwriting it would ship different `
            + `code under a version someone may already be running — an install a support report cannot identify.\n`
            + `Bump "version" in clients/vscode/package.json, delete the existing artifact, pass `
            + `--auto-bump to bump the version automatically, or pass `
            + `--allow-overwrite if you are deliberately re-cutting this exact build.`,
        );
      }
      if (callerOut) {
        throw new Error(
          `--auto-bump cannot be combined with a caller-supplied output path (${callerOut.path}). `
            + `Auto-bump only helps by writing to a new, un-taken artifact path, but that path is fixed by `
            + `the caller, so the bumped version would still collide there. Pass --allow-overwrite to re-cut `
            + `into that path, or drop --out and let the artifact path default to the bumped version.`,
        );
      }

      // Auto-bump: find the first bumped version whose artifact does not exist,
      // using the tested lib helper (which re-checks every candidate). Refuses to
      // overwrite any existing artifact, including a bumped version that was
      // itself already packaged.
      const originalVersion = manifest.version;
      const candidate = nextFreeVersion(
        originalVersion,
        (v) => existsSync(resolve(artifactPathFor(v))),
      );
      if (!candidate) {
        throw new Error(
          `Auto-bump could not find a free version after 100 attempts starting from ${originalVersion}. `
            + `Bump "version" in clients/vscode/package.json manually.`,
        );
      }
      setPackageVersion(candidate);
      // Keep the artifact path passed to vsce in sync with the bumped version by
      // construction: we pushed our own --out, so we know the exact value slot.
      forwardedArgs[defaultOutValueIndex] = artifactPathFor(candidate);
      autoBumpedFrom = originalVersion;
      console.warn(
        `${basename(absolute)} already exists (version ${originalVersion} already packaged). `
          + `Auto-bumped to ${candidate}.`,
      );
    }
  }

  result = spawnSync(
    process.execPath,
    [vsceCli, operation, "--no-dependencies", "--target", target, ...forwardedArgs],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  // Set only after every check above has passed: any throw leaves this false and the
  // finally block rolls the bump back, as does a non-zero exit status. A signal kill
  // (status null) is surfaced explicitly — silent status-1 exits hide why vsce died.
  if (result.signal) {
    throw new Error(`vsce exited due to signal ${result.signal}.`);
  }
  succeeded = (result.status ?? 1) === 0;
} finally {
  // Roll the version bump back unless the package step fully succeeded, so the tree is
  // never left with a bumped package.json and no corresponding artifact. Best-effort:
  // a throw inside the rollback is swallowed (with a stderr note) so it cannot mask the
  // original error, and a hard kill of this process between the bump and here cannot
  // be recovered automatically (see the header note).
  if (operation === "package" && autoBumpedFrom != null && !succeeded) {
    try {
      const pkgPath = require.resolve("./package.json");
      writeFileSync(
        pkgPath,
        rewriteVersionLine(readFileSync(pkgPath, "utf8"), autoBumpedFrom),
      );
    } catch (rollbackErr) {
      console.error(
        `Warning: failed to roll package.json back to ${autoBumpedFrom}: ${rollbackErr.message}`,
      );
    }
  }
}

process.exitCode = result?.status ?? 1;
