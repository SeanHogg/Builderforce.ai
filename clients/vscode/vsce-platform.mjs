import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";

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
 * check stops them being created — but instead of hard-failing and forcing the caller
 * to hand-edit package.json (an agent-loop turn spent on a version bump, measured on
 * chat #131817), the default is to AUTO-BUMP the trailing numeric component and package
 * under the new version. Overwriting is still possible only via `--allow-overwrite` when
 * you are deliberately re-cutting one exact build.
 */
const allowOverwriteIndex = forwardedArgs.indexOf("--allow-overwrite");
const allowOverwrite = allowOverwriteIndex !== -1;
if (allowOverwrite) forwardedArgs.splice(allowOverwriteIndex, 1);

function bumpPatchVersion(version) {
  const match = /^(.*?)(\d+)$/.exec(version);
  if (!match) return null;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function rewritePackageVersion(version) {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("./package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

if (operation === "package") {
  const outFlag = forwardedArgs.findIndex((arg) => arg === "--out" || arg === "-o");
  const manifest = createRequire(import.meta.url)("./package.json");
  const outPath = outFlag !== -1
    ? forwardedArgs[outFlag + 1]
    : `${manifest.name}-${manifest.version}.vsix`;
  if (outFlag === -1) forwardedArgs.push("--out", outPath);
  const absolute = resolve(outPath);
  if (existsSync(absolute) && !allowOverwrite) {
    const nextVersion = bumpPatchVersion(manifest.version);
    if (!nextVersion) {
      throw new Error(
        `${basename(absolute)} already exists and version ${manifest.version} cannot be auto-bumped.\n`
          + `Bump "version" in clients/vscode/package.json, delete the existing artifact, or pass `
          + `--allow-overwrite if you are deliberately re-cutting this exact build.`,
      );
    }
    console.warn(
      `${basename(absolute)} already exists (version ${manifest.version} already packaged). `
        + `Auto-bumping to ${nextVersion} rather than overwriting a shipped artifact.`,
    );
    rewritePackageVersion(nextVersion);
    // Point --out at the new version's artifact so vsce writes a fresh file.
    const outIndex = forwardedArgs.indexOf("--out");
    forwardedArgs[outIndex + 1] = `${manifest.name}-${nextVersion}.vsix`;
  }
}
const result = spawnSync(
  process.execPath,
  [vsceCli, operation, "--no-dependencies", "--target", target, ...forwardedArgs],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
