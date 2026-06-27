/**
 * Bundles the extension into a single CommonJS file so ESM-only dependencies
 * (e.g. @seanhogg/builderforce-memory — Evermind Write-Through Cognition) can be
 * imported normally. `vscode` is provided by the host, so it stays external.
 */
import * as esbuild from "esbuild";
import * as fs from "node:fs";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

// Clean stale per-file output from the old tsc build so out/ holds only the bundle.
fs.rmSync("out", { recursive: true, force: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[esbuild] watching…");
} else {
  await esbuild.build(options);
}
