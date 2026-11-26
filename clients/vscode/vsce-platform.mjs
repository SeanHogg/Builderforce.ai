import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import {
  planPackageStep,
  planPublishArgs,
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
 *                       had no effect. Stripped before publish (it is a packaging-only
 *                       concern; vsce would reject it as an unknown option).
 *   --auto-bump         On collision, bump the trailing numeric component of the
 *                       version in package.json, then package under the new version.
 *                       Refused for `publish` (there is no local artifact collision —
 *                       the marketplace version is authoritative) so a caller is never
 *                       misled into thinking a publish was bumped.
 *
 * --auto-bump is refused together with a caller-supplied output path (--out, -o, or
 * the --out=<path> form): auto-bump only helps by writing to a new, un-taken artifact
 * path, and a caller's explicit output path is fixed — so the bumped version would
 * still collide at that path and the bump would be pure damage. Pass --allow-overwrite
 * to re-cut into a caller-supplied path instead.
 *
 * Both decisions are the pure, unit-tested `planPackageStep` / `planPublishArgs` in
 * `vsce-platform.lib.mjs`; this file is only the I/O wrapper around them.
 *
 * ── ROLLBACK & SIGNAL SAFETY ───────────────────────────────────────────────────
 * Auto-bump writes the bumped version into package.json BEFORE invoking vsce, and
 * vsce `package` reads the version from package.json — so any `vscode:prepublish` /
 * build scripts vsce runs (or a concurrent tool/watcher) see the bumped version for
 * the duration. On success the bumped package.json is LEFT COMMITTED (that is the
 * point — the new version is now the source of truth, and the artifact path passed to
 * vsce was constructed from the same candidate, so the two cannot drift).
 *
 * vsce is run with ASYNC `spawn` (not `spawnSync`) precisely so the event loop stays
 * live and SIGINT/SIGTERM/SIGHUP handlers can run mid-package: on one of those signals
 * the bump is rolled back and the process exits 130, so a graceful Ctrl-C mid-package
 * does not leave a bumped package.json with no artifact. The handler is registered
 * with `once` ONLY around the spawn and removes itself on exit, so it cannot loop or
 * leak into later runs. Remaining limits, documented rather than hidden: a SIGKILL /
 * unrecoverable crash of this process between the bump and the handler running cannot
 * be recovered — package.json may be left with the bumped version and no artifact, and
 * the recovery is manual (check package.json and keep or revert the bump). On Windows
 * Ctrl-C typically kills the whole console process group without delivering SIGINT to
 * node, so the same manual recovery applies there. A throw inside the rollback is
 * swallowed (with a stderr note) so it cannot mask the original error. Do not
 * auto-bump inside a long-running watcher where a kill is likely; bump the version
 * yourself and re-run.
 */
const SIGNAL_EXIT_CODE = 130;

/** The version package.json held before any auto-bump; null when no bump happened. */
let autoBumpedFrom = null;

/** Rollback the bump, best-effort (a throw here must not mask the original error). */
function rollbackBump() {
  if (autoBumpedFrom == null) return;
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

async function main() {
  const args = process.argv.slice(3);

  // ── Plan: decide everything BEFORE touching disk or spawning vsce. ──
  if (operation === "package") {
    // Parsed here (not at module top level) so a malformed/missing package.json fails
    // in the context of the operation that actually needs it — publish never reads it.
    const pkgPath = require.resolve("./package.json");
    const manifest = JSON.parse(readFileSync(pkgPath, "utf8"));

    /** Existence probe: an artifact path exists iff its cwd-resolved file exists. */
    const artifactExists = (path) => existsSync(resolve(path));

    // THE decision — pure and unit-tested in the lib. Nothing is written here.
    const plan = planPackageStep(manifest, args, artifactExists);
    if (plan.warning) console.warn(plan.warning);
    if (!plan.ok) throw new Error(plan.error);

    // A bump is committed to disk only now, after the plan has succeeded in full.
    if (plan.bumpedTo != null) {
      autoBumpedFrom = manifest.version;
      const pkgText = readFileSync(pkgPath, "utf8");
      writeFileSync(pkgPath, rewriteVersionLine(pkgText, plan.bumpedTo));
      console.warn(
        `${basename(plan.outPath)} already exists (version ${autoBumpedFrom} already `
          + `packaged). Auto-bumped to ${plan.bumpedTo}.`,
      );
    }
    args.length = 0;
    args.push(...plan.args);
  } else {
    const plan = planPublishArgs(args);
    if (!plan.ok) throw new Error(plan.error);
    args.length = 0;
    args.push(...plan.args);
  }

  // ── Run vsce with the event loop live so signal handlers work mid-package. ──
  // `once` + removal on exit means the handler cannot re-enter itself or leak.
  const onSignal = () => {
    rollbackBump();
    process.exit(SIGNAL_EXIT_CODE);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, onSignal);

  let code;
  try {
    code = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        process.execPath,
        [vsceCli, operation, "--no-dependencies", "--target", target, ...args],
        // `vscode:prepublish` (esbuild's copyBfiNative) reads the target: ship only this platform's native addon.
        { stdio: "inherit", env: { ...process.env, BFI_NATIVE_TARGET: target } },
      );
      child.on("error", rejectPromise);
      child.on("exit", (status, signal) => {
        // A signal kill is surfaced explicitly — silent status-1 exits hide why vsce
        // died. Our own signal handler exits 130 before this normally matters.
        if (signal) {
          rejectPromise(new Error(`vsce exited due to signal ${signal}.`));
          return;
        }
        resolvePromise(status ?? 1);
      });
    });
  } finally {
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(sig, onSignal);
  }

  // Non-zero exit → roll the bump back; zero → leave it committed.
  if (operation === "package" && autoBumpedFrom != null && code !== 0) {
    rollbackBump();
  }
  process.exitCode = code;
}

main().catch((err) => {
  // A throw anywhere in the plan/spawn path rolls the bump back too.
  rollbackBump();
  console.error(err.message ?? err);
  process.exitCode = 1;
});
