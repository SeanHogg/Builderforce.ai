import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { nextFreeVersion, rewriteVersionLine } from "./vsce-platform.lib.mjs";

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
const vsceCli = createRequire(import.meta.url).resolve("@vscode/vsce/vsce");
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
 * artifact you mean to replace, or pass `--allow-overwrite` for a deliberate re-cut.
 * Two opt-in flags relax that:
 *
 *   --allow-overwrite   Re-cut THIS exact version (overwrite the existing artifact).
 *   --auto-bump         On collision, bump the trailing numeric component of the
 *                       version in package.json, then package under the new version.
 *                       The bump is committed to disk only when the package step
 *                       succeeds; on failure package.json is rolled back so the tree
 *                       is never left with a bumped version and no artifact.
 *
 * Auto-bump loops until it finds a version whose artifact does not exist (so a bumped
 * version that was itself already packaged is skipped, never overwritten). It only
 * touches the version line of package.json and never overrides a caller-supplied
 * `--out`/`-o` path.
 */
const allowOverwriteIndex = forwardedArgs.indexOf("--allow-overwrite");
const allowOverwrite = allowOverwriteIndex !== -1;
if (allowOverwrite) forwardedArgs.splice(allowOverwriteIndex, 1);

const autoBumpIndex = forwardedArgs.indexOf("--auto-bump");
const autoBump = autoBumpIndex !== -1;
if (autoBump) forwardedArgs.splice(autoBumpIndex, 1);

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("./package.json");
const manifest = JSON.parse(readFileSync(pkgPath, "utf8"));
/** The version package.json held before any auto-bump; null when no bump happened. */
let autoBumpedFrom = null;

/** Rewrite ONLY the version line of package.json, leaving every other byte untouched. */
function setPackageVersion(version) {
  writeFileSync(pkgPath, rewriteVersionLine(readFileSync(pkgPath, "utf8"), version));
}

if (operation === "package") {
  const outFlagIndex = forwardedArgs.findIndex((arg) => arg === "--out" || arg === "-o");
  const callerSuppliedOut = outFlagIndex !== -1;
  const outPath = callerSuppliedOut
    ? forwardedArgs[outFlagIndex + 1]
    : `${manifest.name}-${manifest.version}.vsix`;
  if (!callerSuppliedOut) forwardedArgs.push("--out", outPath);
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

    // Auto-bump: advance the version until the artifact for that version does not
    // exist. This re-checks after every bump so we never overwrite a shipped artifact
    // for the bumped version either. A caller-supplied --out is left alone (the bump
    // still applies to package.json, but we do not redirect their chosen path).
    const originalVersion = manifest.version;
    let candidate = manifest.version;
    let bumped = false;
    for (let guard = 0; guard < 100; guard++) {
      const next = bumpPatchVersion(candidate);
      if (!next) {
        throw new Error(
          `${basename(absolute)} already exists and version ${candidate} cannot be auto-bumped. `
            + `Bump "version" in clients/vscode/package.json manually or pass --allow-overwrite.`,
        );
      }
      candidate = next;
      const candidateOut = callerSuppliedOut
        ? outPath
        : `${manifest.name}-${candidate}.vsix`;
      if (!existsSync(resolve(candidateOut))) {
        setPackageVersion(candidate);
        if (!callerSuppliedOut) {
          const outIndex = forwardedArgs.indexOf("--out");
          forwardedArgs[outIndex + 1] = `${manifest.name}-${candidate}.vsix`;
        }
        bumped = true;
        console.warn(
          `${basename(absolute)} already exists (version ${originalVersion} already packaged). `
            + `Auto-bumped to ${candidate}.`,
        );
        break;
      }
    }
    if (!bumped) {
      throw new Error(
        `Auto-bump could not find a free version after 100 attempts starting from ${originalVersion}. `
          + `Bump "version" in clients/vscode/package.json manually.`,
      );
    }
    manifest.version = candidate;
    autoBumpedFrom = originalVersion;
  }
}

const result = spawnSync(
  process.execPath,
  [vsceCli, operation, "--no-dependencies", "--target", target, ...forwardedArgs],
  { stdio: "inherit" },
);

if (result.error) throw result.error;

// Roll the version bump back when the package step failed, so the tree is never left
// with a bumped package.json and no corresponding artifact.
if (operation === "package" && autoBumpedFrom != null && result.status !== 0) {
  setPackageVersion(autoBumpedFrom);
}

process.exitCode = result.status ?? 1;
