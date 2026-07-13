/**
 * Bundles the extension into a single CommonJS file so ESM-only dependencies
 * (e.g. @seanhogg/builderforce-memory — Evermind Write-Through Cognition) can be
 * imported normally. `vscode` is provided by the host, so it stays external.
 */
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

// Clean stale per-file output from the old tsc build so out/ holds only the bundle.
fs.rmSync("out", { recursive: true, force: true });

const here = path.dirname(fileURLToPath(import.meta.url));
// The shared `@builderforce/agent-tools` contract is consumed as SOURCE (no dist —
// mirrors how `api` resolves it via tsconfig paths), so the editor surface runs the
// SAME tool definitions as the cloud. Bundle it from its TS entry…
const agentToolsRoot = path.resolve(here, "../../packages/agent-tools/src");

/** …and rewrite its NodeNext `./x.js` relative imports to the real `./x.ts` source
 *  (esbuild won't map .js→.ts on its own). Scoped to that package so nothing else
 *  is affected. */
const agentToolsTsResolve = {
  name: "agent-tools-ts-resolve",
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.importer.startsWith(agentToolsRoot)) return undefined;
      const tsPath = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return fs.existsSync(tsPath) ? { path: tsPath } : undefined;
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  alias: { "@builderforce/agent-tools": path.join(agentToolsRoot, "index.ts") },
  plugins: [agentToolsTsResolve],
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
