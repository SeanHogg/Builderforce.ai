import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import {
  nextFreeVersion,
  parseOutArg,
  planPackageStep,
  rewriteVersionLine,
} from "./vsce-platform.lib.mjs";

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
 *                       package.json is rolled back so the tree is never left with a
 *                       bumped version and no artifact.
 *
 * --auto-bump is refused together with a caller-supplied output path (--out, -o, or
 * the --out=<path> form): auto-bump only helps by writing to a new, un-taken artifact
 * path, and a caller's explicit output path is fixed — so the bumped version would
 * still collide at that path and the bump would be pure damage. Pass --allow-overwrite
 * to re-cut into a caller-supplied path instead. --auto-bump is also refused for
 * `publish` (there is no local artifact collision to resolve — the marketplace version
 * is authoritative), so a caller is never misled into thinking a publish was bumped.
 *
 * The decision itself (flag parsing, caller-out detection, collision handling, the
 * auto-bump free-version search) is the pure, unit-tested `planPackageStep` in
 * `vsce-platform.lib.mjs`; this file is only the I/O wrapper around it.
 *
 * ── ROLLBACK & SIGNAL SAFETY ───────────────────────────────────────────────────
 * Auto-bump writes the bumped version into package.json BEFORE invoking vsce, and
 * vsce `package` reads the version from package.json — so any `vscode:prepublish` /
 * build scripts vsce runs (or a concurrent tool/watcher) see the bumped version for
 * the duration. On success the bumped package.json is LEFT COMMITTED (that is the
 * point — the new version is now the source of truth, and the artifact path passed to
 * vsce was constructed from the same candidate, so the two cannot drift). On failure
 * the bump is rolled back via `rollbackBump()`, keyed on an explicit `succeeded` flag
 * that is set only after spawnSync returns cleanly with a zero exit status.
 *
 * That rollback covers: a non-zero vsce exit, a thrown error anywhere in the run, and
 * a graceful Ctrl-C / SIGTERM (a `process.on` handler rolls back and re-raises so the
 * default terminate behaviour still applies). It is still best-effort in two ways: a
 * throw inside the rollback is swallowed (with a stderr note) so it cannot mask the
 * original error; and a SIGKILL / unrecoverable crash of this process between the bump
 * and the handler running cannot be recovered — in that case package.json may be left
 * with the bumped version and no artifact, and the recovery is manual: check
 * package.json and either keep the bump or revert it. Do not auto-bump inside a
 * long-running watcher where a kill is likely; bump the version yourself and re-run.
 */
let result;
let succeeded = false;
/** The version package.json held before any auto-bump; null when no bump happened. */
let autoBumpedFrom = null;
/** Lazily-bound rollback; the signal handler below needs it before the try block. */
let rollbackBump = () => {};

// Roll the bump back on graceful interrupt (Ctrl-C / SIGTERM / SIGHUP) so a kill
// mid-package does not leave a bumped package.json with no artifact. The handler
// re-raises so the process still terminates with the default signal behaviour.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    rollbackBump();
    process.kill(process.pid, sig);
  });
}

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
    rollbackBump = () => {
      if (autoBumpedFrom == null) return;
      try {
        setPackageVersion(autoBumpedFrom);
      } catch (rollbackErr) {
        console.error(
          `Warning: failed to roll package.json back to ${autoBumpedFrom}: ${rollbackErr.message}`,
        );
      }
    };

    /** Existence probe: an artifact path exists iff its cwd-resolved file exists. */
    const artifactExists = (path) => existsSync(resolve(path));

    // THE decision — pure and unit-tested in the lib. Nothing is written here.
    const plan = planPackageStep(manifest, forwardedArgs, artifactExists);
    if (plan.warning) console.warn(plan.warning);
    if (!plan.ok) throw new Error(plan.error);

    // A bump is committed to disk only now, after the plan has succeeded in full.
    if (plan.bumpedTo != null) {
      autoBumpedFrom = manifest.version;
      setPackageVersion(plan.bumpedTo);
      console.warn(
        `${basename(plan.outPath)} already exists (version ${autoBumpedFrom} already `
          + `packaged). Auto-bumped to ${plan.bumpedTo}.`,
      );
    }
    // The plan's args replace the raw ones forwarded to vsce.
    forwardedArgs.length = 0;
    forwardedArgs.push(...plan.args);
  }

  result = spawnSync(
    process.execPath,
    [vsceCli, operation, "--no-dependencies", "--target", target, ...forwardedArgs],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  // A signal kill (status null) is surfaced explicitly — silent status-1 exits hide
  // why vsce died. Any throw above leaves succeeded=false and the rollback runs.
  if (result.signal) {
    throw new Error(`vsce exited due to signal ${result.signal}.`);
  }
  succeeded = (result.status ?? 1) === 0;
} finally {
  if (operation === "package" && autoBumpedFrom != null && !succeeded) {
    rollbackBump();
  }
}

process.exitCode = result?.status ?? 1;
