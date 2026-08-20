import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
 * check stops them being created: bump the version, or delete the artifact you mean to
 * replace, or pass `--allow-overwrite` when you are deliberately re-cutting one.
 */
const allowOverwriteIndex = forwardedArgs.indexOf("--allow-overwrite");
const allowOverwrite = allowOverwriteIndex !== -1;
if (allowOverwrite) forwardedArgs.splice(allowOverwriteIndex, 1);

if (operation === "package") {
  const outFlag = forwardedArgs.findIndex((arg) => arg === "--out" || arg === "-o");
  const manifest = createRequire(import.meta.url)("./package.json");
  const outPath = outFlag !== -1
    ? forwardedArgs[outFlag + 1]
    : `${manifest.name}-${manifest.version}.vsix`;
  if (outFlag === -1) forwardedArgs.push("--out", outPath);
  const absolute = resolve(outPath);
  if (existsSync(absolute) && !allowOverwrite) {
    throw new Error(
      `${basename(absolute)} already exists.
`
        + `Version ${manifest.version} has already been packaged, and overwriting it would ship different `
        + `code under a version someone may already be running — an install a support report cannot identify.
`
        + `Bump "version" in clients/vscode/package.json, delete the existing artifact, or pass `
        + `--allow-overwrite if you are deliberately re-cutting this exact build.`,
    );
  }
}
const result = spawnSync(
  process.execPath,
  [vsceCli, operation, "--no-dependencies", "--target", target, ...forwardedArgs],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
