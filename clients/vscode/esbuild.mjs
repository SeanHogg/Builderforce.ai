/**
 * Bundles the extension into a single CommonJS file so ESM-only dependencies
 * (e.g. @seanhogg/builderforce-memory — Evermind Write-Through Cognition) can be
 * imported normally. `vscode` is provided by the host, so it stays external.
 */
import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { computeBuildId } from "./buildId.mjs";
import { manifestEditorSchema } from "./scripts/manifest-editor-schema.mjs";
import { pinnedInstallResolve, sourcePackageAliasMap, sourcePackageRoots } from "../../scripts/sourcePackages.mjs";
import { addonTagOf, assertAddonFile } from "../../scripts/lib/nativeAddonFormat.mjs";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");
// The headless harness: the scenario replayer + the live probe, bundled as a Node CLI
// so the extension's chat can be exercised without packaging or installing a VSIX.
// Built to a SEPARATE entry point (never shipped in the .vsix — see .vscodeignore).
const harness = process.argv.includes("--harness");
// The extension-host integration suite: the Mocha entry VS Code loads inside the
// running host, plus the launcher that downloads/boots that host. Bundled (not tsc'd)
// so it resolves dependencies exactly as the shipped extension does, and written to a
// SEPARATE directory that is never packaged (see .vscodeignore).
const integration = process.argv.includes("--integration");

// Clean stale per-file output from the old tsc build so out/ holds only the bundle.
// Skipped for the harness build, which must not wipe an existing extension bundle.
// `out/analyzers` survives: it is an npm install guarded by its own stamp
// (`installBundledAnalyzers`), and wiping it made every build reinstall it from npm.
if (!harness && !integration && fs.existsSync("out")) {
  for (const entry of fs.readdirSync("out")) {
    if (entry !== "analyzers") fs.rmSync(path.join("out", entry), { recursive: true, force: true });
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

// The shared contracts (`@builderforce/agent-tools`, `run-context`, the canvas
// contract) are consumed as SOURCE (no dist — mirrors how `api` resolves them via
// tsconfig paths), so the editor surface runs the SAME tool definitions as the cloud.
// Both the alias map and the roots below are derived from the package manifests, so a
// new shared package is bundled here, in the harness and on the web without a list to
// remember. See `scripts/sourcePackages.mjs`.
//
// `@builderforce/agent-tools/node-path` is agent-tools' node-only export condition (the
// shared workspace-containment path resolver). The package ROOT stays node-builtin-free
// because the Cloudflare Worker imports it; this subpath is Node-surface-only, which is
// why it is a separate entry rather than a re-export from the index — esbuild matches
// the longest alias key, so both resolve correctly.
const sharedPackageAliases = sourcePackageAliasMap(repoRoot);

/** Source-only packages with PEERS and no install of their own (`@builderforce/knowledge-client`:
 *  `@seanhogg/builderforce-memory`) resolve those bare imports from THIS package's install,
 *  as `tsconfig.json` maps them for tsc — a fallback only, after node's own walk (the same
 *  shape as `clients/chrome/build.mjs`). */
const peerNodePaths = [path.join(here, "node_modules")];

/** ONE memory engine in every bundle: `@seanhogg/builderforce-memory` (+ subpaths) and
 *  `-memory-engine` always resolve from THIS package's install, whoever imports them — a
 *  source-only package's own `node_modules` copy is never bundled beside it. */
const pinnedMemoryResolve = pinnedInstallResolve(here);

/** Source-consumed shared packages whose NodeNext `./x.js` imports must be rewritten to
 *  `./x.ts`. The resolver plugin below reads these roots rather than hard-coding one
 *  (which is how `run-context` would otherwise have failed to bundle the moment it
 *  imported its own `blocks.js`). */
const tsSourcePackageRoots = sourcePackageRoots(repoRoot);

/** …and rewrite its NodeNext `./x.js` relative imports to the real `./x.ts` source
 *  (esbuild won't map .js→.ts on its own). Scoped to that package so nothing else
 *  is affected. */
const agentToolsTsResolve = {
  name: "shared-package-ts-resolve",
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!tsSourcePackageRoots.some((root) => args.importer.startsWith(root))) return undefined;
      const tsPath = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
      return fs.existsSync(tsPath) ? { path: tsPath } : undefined;
    });
  },
};

/**
 * A REAL `import.meta.url` inside the CommonJS bundle.
 *
 * esbuild has to shim `import.meta` when it emits CJS, and its shim is an empty object
 * — so every bundled ESM dependency that does `createRequire(import.meta.url)` (the
 * Agent/MCP SDKs do, at MODULE scope) receives `undefined` and throws
 * `The argument 'filename' must be a file URL object, file URL string, or absolute path
 * string` before a single line of our code runs. That is not a degraded feature: the
 * extension fails to ACTIVATE, so every command, view and webview is dead, and the only
 * evidence is one notification in a window the user may already have dismissed.
 *
 * It shipped that way in 2026.7.126 → 2026.8.128 and no offline test could see it,
 * because the bundle is only ever LOADED by a real extension host — which is exactly the
 * gap `test-integration/` now covers.
 *
 * `pathToFileURL(__filename).href` is the honest value: a file URL, so both
 * `createRequire(...)` and `fileURLToPath(...)` consumers get what they expect (a bare
 * `__filename` would satisfy the first and break the second).
 */
const buildIdentity = {
  define: {
    __BF_BUILD_ID__: JSON.stringify(computeBuildId(here)),
    __BF_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
};

const importMetaUrlShim = {
  banner: { js: `var __bfImportMetaUrl = require("node:url").pathToFileURL(__filename).href;` },
  define: { "import.meta.url": "__bfImportMetaUrl" },
};

/** @type {import('esbuild').BuildOptions} */
const options = integration
  ? {
      // `suite.cjs` runs INSIDE the extension host (so `vscode` is provided);
      // `runTests.cjs` runs outside it, in plain Node.
      entryPoints: { suite: "test-integration/index.ts", runTests: "test-integration/runTests.ts" },
      bundle: true,
      outdir: "out-integration",
      outExtension: { ".js": ".cjs" },
      platform: "node",
      format: "cjs",
      target: "node20",
      // `vscode` is the host's. Mocha and the launcher stay external and resolve from
      // this package's `node_modules` at runtime: bundling Mocha inlines its
      // `require.resolve` worker paths, which only resolve as real files on disk.
      external: ["vscode", "mocha", "@vscode/test-electron"],
      // The suite imports source that does `createRequire(import.meta.url)` (`node-local-sqlite`): without the shim
      // it throws inside the CJS bundle and `node:sqlite` is reported "not available" in a host that has it.
      ...importMetaUrlShim,
      sourcemap: true,
      logLevel: "warning",
    }
  : harness
  ? {
      entryPoints: ["harness/cli.ts"],
      bundle: true,
      outfile: "out/harness.cjs",
      platform: "node",
      format: "cjs",
      target: "node20",
      // The harness never runs inside the editor, so `vscode` must not even be
      // reachable — anything that reaches for it belongs on the extension side.
      external: ["vscode", "react", "react-dom"],
      alias: sharedPackageAliases,
      nodePaths: peerNodePaths,
      plugins: [agentToolsTsResolve, pinnedMemoryResolve],
      ...importMetaUrlShim,
      define: { ...importMetaUrlShim.define, ...buildIdentity.define },
      sourcemap: true,
      logLevel: "warning",
    }
  : {
      entryPoints: ["src/extension.ts"],
      bundle: true,
      outfile: "out/extension.js",
      platform: "node",
      format: "cjs",
      target: "node20",
      external: ["vscode"],
      alias: sharedPackageAliases,
      nodePaths: peerNodePaths,
      plugins: [agentToolsTsResolve, pinnedMemoryResolve],
      ...importMetaUrlShim,
      define: { ...importMetaUrlShim.define, ...buildIdentity.define },
      sourcemap: !production,
      minify: production,
      logLevel: "info",
    };

/**
 * The extension host's `bfi` worker (`src/hostBfi/worker.ts`, PRD 34 §3.1): a SECOND
 * entry beside `extension.js`, started by `worker_threads`, plus the vendored wasm it
 * loads by path (`out/bfi_web_bg.wasm`; `out/` ships in the .vsix). Same options as the
 * extension bundle — it is Node, CJS, and needs the same `import.meta.url` shim.
 */
const hostWorker = harness || integration ? null : { ...options, entryPoints: ["src/hostBfi/worker.ts"], outfile: "out/bfiHostWorker.js" };
/**
 * The review's extraction worker (`src/knowledge/review/extractWorker.ts`, PRD 41 A8): a THIRD entry,
 * started by the extraction pool (`extractPoolHost.ts`) with `worker_threads`. Same options as the
 * extension bundle; `out/` ships in the .vsix, so no `.vscodeignore` entry is needed.
 */
const extractWorker = harness || integration ? null : { ...options, entryPoints: ["src/knowledge/review/extractWorker.ts"], outfile: "out/knowledgeExtractWorker.js" };
/**
 * The run delta's engine worker (`src/runDelta/deltaWorker.ts`, PRD 41 §C14): a FOURTH entry, started per delta by
 * `deltaWorkerHost.ts` with `worker_threads` and terminated when the delta's budget runs out. Same options as the extension.
 */
const deltaWorker = harness || integration ? null : { ...options, entryPoints: ["src/runDelta/deltaWorker.ts"], outfile: "out/runDeltaWorker.js" };
/**
 * The run-outcome labellers' worker (`src/runOutcomes/labelWorker.ts`, PRD 41 §D1): SZZ / revert masking and blame
 * matching run off the extension host's thread. Same options as the extension.
 */
const outcomeWorker = harness || integration ? null : { ...options, entryPoints: ["src/runOutcomes/labelWorker.ts"], outfile: "out/runOutcomeWorker.js" };
/**
 * The L3 analysis worker (`src/knowledge/l3WorkerEntry.ts`): the analyzers, the repo graph's build and the conversion to
 * `Extracted` run here, off the extension host's thread (`l3Worker.ts`, one worker per job, heap-limited, terminated on Stop).
 * Same options as the extension; the bundle must not reach `vscode`.
 */
const l3Worker = harness || integration ? null : { ...options, entryPoints: ["src/knowledge/l3WorkerEntry.ts"], outfile: "out/knowledgeL3Worker.js" };
/**
 * The knowledge graph worker (`src/knowledge/graphWorkerEntry.ts`): every graph build of the extension (the knowledge view, a
 * run delta's sides, the code actions) runs here, off the extension host's thread (`graphWorker.ts`, ONE reused worker,
 * reading the folder's knowledge file through its own read-only connection). Same options; the bundle must not reach `vscode`.
 */
const graphWorker = harness || integration ? null : { ...options, entryPoints: ["src/knowledge/graphWorkerEntry.ts"], outfile: "out/knowledgeGraphWorker.js" };
async function copyBfiWasm() {
  const wasm = createRequire(import.meta.url).resolve("@seanhogg/bfi-web/bfi_web_bg.wasm");
  fs.mkdirSync("out", { recursive: true });
  fs.copyFileSync(wasm, path.join("out", "bfi_web_bg.wasm"));
  copyBfiNative();
  await copyTreeSitterWasm();
  installBundledAnalyzers();
  copyLauncherAssets();
  await writeManifestSchema();
}

/**
 * The app manifest's JSON schema for VS Code's JSON validation (`contributes.jsonValidation` →
 * `./out/schemas/app.v1.schema.json`, matching `.builderforce/builderforce.json` and the legacy
 * root files): built from the runtime's own `APP_MANIFEST_SCHEMA_V1` (`scripts/manifest-editor-schema.mjs`
 * says what it validates), never a copy kept here.
 */
async function writeManifestSchema() {
  const { APP_MANIFEST_SCHEMA_V1 } = await import("@seanhogg/builderforce-webcontainers-core/manifest");
  const target = path.join("out", "schemas");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "app.v1.schema.json"), `${JSON.stringify(manifestEditorSchema(APP_MANIFEST_SCHEMA_V1), null, 2)}\n`);
}

/**
 * The local launcher's browser assets (PRD 31 §W11, `/launch`): `createLocalLauncher` is bundled into
 * `extension.js`, but it SERVES files from the runtime package's `dist/` — the preview origin's
 * `assets.js` (service worker, relay page, process Workers) and the launcher page
 * (`launcher/{index.html,page.js,launcher.css}`). `node_modules/` never ships in the .vsix, so exactly
 * those files are copied to `out/bfwc/` (`out/` ships), and `composerCommands/host.ts` passes that
 * directory as `distDir`. The file list mirrors the launcher's `loadLauncherAssets` (`PAGE_FILES`).
 */
function copyLauncherAssets() {
  const serverEntry = fileURLToPath(import.meta.resolve("@seanhogg/builderforce-webcontainers/launcher/server"));
  const dist = path.resolve(path.dirname(serverEntry), "..", "..");
  const target = path.join("out", "bfwc");
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, "launcher"), { recursive: true });
  for (const file of ["assets.js", "launcher/index.html", "launcher/page.js", "launcher/launcher.css"]) {
    const from = path.join(dist, ...file.split("/"));
    if (!fs.existsSync(from)) throw new Error(`[esbuild] the local launcher's ${file} is missing from ${dist}: build @seanhogg/builderforce-webcontainers first`);
    fs.copyFileSync(from, path.join(target, ...file.split("/")));
  }
  // `assets.js` is an ES module the launcher `import()`s; the extension's own manifest has no `"type"`, so
  // this directory states its own, or Node would read it as CommonJS.
  fs.writeFileSync(path.join(target, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
}

/**
 * The analyzers the VSIX ships (PRD 41 A3): `analyzers/package.json` pins dependency-cruiser, jscpd,
 * knip and the `typescript@5.6.3` they share; they are installed into `out/analyzers/node_modules`
 * (`out/` ships in the .vsix) and `src/diagnostics/bundledAnalyzers.ts` resolves their entry scripts at activation,
 * so no analysis ever downloads from npm. `npm ci` when `analyzers/package-lock.json` exists. Skipped when
 * the install is already there AND its stamp (`out/analyzers/.install-stamp`, the hash of the copied
 * package.json + lockfile) matches, so a changed pin reinstalls; a failed install fails the build, since a VSIX without its
 * analyzers would report every analyzer `not_measured`.
 */
function installBundledAnalyzers() {
  const target = path.join("out", "analyzers");
  const installed = path.join(target, "node_modules", "knip", "package.json");
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join("analyzers", "package.json"), path.join(target, "package.json"));
  const lock = path.join("analyzers", "package-lock.json");
  const locked = fs.existsSync(lock);
  if (locked) fs.copyFileSync(lock, path.join(target, "package-lock.json"));
  const hash = createHash("sha256");
  for (const file of [path.join(target, "package.json"), ...(locked ? [path.join(target, "package-lock.json")] : [])]) hash.update(fs.readFileSync(file));
  const stamp = hash.digest("hex");
  const stampFile = path.join(target, ".install-stamp");
  const stamped = fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8").trim() === stamp;
  if (fs.existsSync(installed) && stamped && !process.env.BF_REINSTALL_ANALYZERS) return;
  const run = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [locked ? "ci" : "install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: target, stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) throw new Error("[esbuild] could not install the bundled analyzers into out/analyzers");
  fs.writeFileSync(stampFile, stamp);
}

/**
 * The symbol index's tree-sitter wasm (`@builderforce/agent-tools/node-symbols` →
 * `node-tree-sitter.ts`): the web-tree-sitter runtime plus the grammars it loads, copied to
 * `out/tree-sitter/` (`out/` ships in the .vsix; activation points the extractor there).
 * The grammar list is IMPORTED from that module (`TREE_SITTER_GRAMMAR_WASMS`, the same
 * constant `agent-runtime/scripts/copy-tree-sitter-wasm.ts` imports), so a grammar added
 * there ships without a second list to remember. Resolved from agent-tools, which
 * declares both packages; a machine without them ships the regex extractor, with a warning.
 */
async function copyTreeSitterWasm() {
  const agentTools = path.join(repoRoot, "packages", "agent-tools");
  const req = createRequire(path.join(agentTools, "package.json"));
  const { TREE_SITTER_GRAMMAR_WASMS, TREE_SITTER_RUNTIME_WASM } = await treeSitterManifest(agentTools);
  let runtimeWasm;
  let grammarDir;
  try {
    runtimeWasm = path.join(path.dirname(req.resolve("web-tree-sitter")), TREE_SITTER_RUNTIME_WASM);
    grammarDir = path.join(path.dirname(req.resolve("tree-sitter-wasms/package.json")), "out");
  } catch (err) {
    console.warn(`[esbuild] tree-sitter packages not installed (${String(err)}): symbols use the regex extractor.`);
    return;
  }
  const target = path.join("out", "tree-sitter");
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(runtimeWasm, path.join(target, TREE_SITTER_RUNTIME_WASM));
  for (const file of TREE_SITTER_GRAMMAR_WASMS) {
    const from = path.join(grammarDir, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, file));
    else console.warn(`[esbuild] no tree-sitter grammar ${file}: that language's symbols use the regex extractor.`);
  }
}

/**
 * `node-tree-sitter.ts`'s exports, imported for real. This script is plain Node and cannot
 * import TypeScript, so esbuild bundles the module in memory (with the same `.js` → `.ts`
 * resolver as the extension) and the result is imported from a data URL — no regex over
 * its source, no copy of its list.
 */
async function treeSitterManifest(agentTools) {
  const built = await esbuild.build({
    entryPoints: [path.join(agentTools, "src", "node-tree-sitter.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
    plugins: [agentToolsTsResolve, pinnedMemoryResolve],
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
}

/**
 * Every native engine addon `@seanhogg/bfi-node` vendors, under its tagged name
 * (`out/bfi_node.<platform>-<arch>.node`). The universal .vsix carries all of them; the
 * host worker picks its own at runtime (`hostBfi/nativeEngine.ts`), and a platform with
 * none runs the wasm. Each is format-checked against its tag first, so a mislabelled
 * binary fails the build instead of reaching Windows' loader (a modal "Bad Image" dialog
 * no try/catch can intercept).
 *
 * `vsce-platform.mjs` sets `BFI_NATIVE_TARGET` to its vsce target (`win32-x64`, `alpine-x64`…):
 * a platform-targeted package then ships only the addon of that exact tag, so an `alpine`
 * target (no musl build) ships none. Unset — the CI universal package — ships them all.
 */
function copyBfiNative() {
  const dir = path.dirname(createRequire(import.meta.url).resolve("@seanhogg/bfi-node/package.json"));
  const tagOf = (name) => {
    const tag = addonTagOf(name);
    return tag && `${tag.platform}-${tag.arch}`;
  };
  const target = process.env.BFI_NATIVE_TARGET;
  const addons = fs.readdirSync(dir).filter((name) => tagOf(name) && (!target || tagOf(name) === target));
  const keep = new Set(addons);
  // Matters for harness/integration builds, which don't empty out/: a no-longer-shipped addon would linger.
  for (const stale of fs.readdirSync("out")) {
    if (stale === "bfi_node.node" || (tagOf(stale) && !keep.has(stale))) fs.rmSync(path.join("out", stale), { force: true });
  }
  for (const name of addons) {
    assertAddonFile(path.join(dir, name));
    fs.copyFileSync(path.join(dir, name), path.join("out", name));
  }
  if (!addons.length) console.warn("[esbuild] no bfi-node addon vendored: the host bfi worker will run the wasm.");
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  if (hostWorker) {
    await (await esbuild.context(hostWorker)).watch();
    await copyBfiWasm();
  }
  if (extractWorker) await (await esbuild.context(extractWorker)).watch();
  if (deltaWorker) await (await esbuild.context(deltaWorker)).watch();
  if (outcomeWorker) await (await esbuild.context(outcomeWorker)).watch();
  if (l3Worker) await (await esbuild.context(l3Worker)).watch();
  if (graphWorker) await (await esbuild.context(graphWorker)).watch();
  console.log("[esbuild] watching…");
} else {
  // The bundles are independent (each has its own entry and outfile, and none reads another's
  // output), so they build concurrently. The out/ cleanup above has already finished, and
  // `copyBfiWasm` (wasm, native addon, tree-sitter, analyzers, launcher assets, schema) only
  // needs `out/` to exist, so it chains after the host worker as before. Any failure rejects
  // the whole `Promise.all`, which fails the build exactly as the serial awaits did.
  await Promise.all([
    esbuild.build(options),
    hostWorker ? esbuild.build(hostWorker).then(() => copyBfiWasm()) : null,
    extractWorker ? esbuild.build(extractWorker) : null,
    deltaWorker ? esbuild.build(deltaWorker) : null,
    outcomeWorker ? esbuild.build(outcomeWorker) : null,
    l3Worker ? esbuild.build(l3Worker) : null,
    graphWorker ? esbuild.build(graphWorker) : null,
  ]);
}
