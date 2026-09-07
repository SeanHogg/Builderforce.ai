#!/usr/bin/env node
/**
 * Dead-export scan for the `@seanhogg/builderforce-agents` workspace.
 *
 * The repo-wide sixth-pass scan stopped at the workspace boundary and a scan
 * over `src/` alone is meaningless: this package's exports are consumed by its
 * own `test/`, `extensions/` (35 channel/auth plugins importing the plugin SDK),
 * `ui/`, and by whoever installs the published package. This guard counts ALL
 * of those as consumers before it calls anything dead.
 *
 * Every named export declared in a non-test file under `src/` is classified
 * into exactly one bucket (first match wins):
 *
 *   published-sdk-surface  reachable from a `package.json` `exports` / `bin`
 *                          entry (`src/index.ts`, `src/plugin-sdk/*.ts`,
 *                          `src/entry.ts` behind `builderforce.mjs`) through
 *                          `export { x } from` / `export * from` chains
 *   consumed-in-src        referenced by another non-test `src/` file
 *   consumed-by-extensions referenced under `extensions/`
 *   consumed-by-ui         referenced under `ui/`
 *   test-seam              only test references AND the name is a seam
 *                          (`_reset*`, `__*`, `mock*`, `fixture*`, `stub*`,
 *                          `fake*`, `*ForTest(s)`)
 *   test-only              only test references, not a seam name
 *   unreferenced           no reference anywhere
 *
 * References are word-boundary identifier matches in every OTHER file, with
 * comments and bare re-export statements stripped so an `index.ts` barrel does
 * not count as a consumer of what it forwards. A renamed re-export
 * (`export { a as b }`) is matched under every alias.
 *
 * Ratchet: `unreferenced` and `testOnly` may not exceed
 * `scripts/.dead-exports-baseline.json`; `--update` rewrites it.
 *
 *   node scripts/check-dead-exports.mjs                # guard (exit 1 on regression)
 *   node scripts/check-dead-exports.mjs --update       # re-seed the baseline
 *   node scripts/check-dead-exports.mjs --report=out.json --list=unreferenced
 *
 * Known blind spots (all err toward "consumed", never toward "dead"):
 * dynamic `import()` by string, string-keyed registries and `vi.mock("…")`
 * paths never mention the identifier, and two modules exporting the same name
 * share one reference count. Namespace re-exports (`export * as ns`) are
 * counted as an export named `ns`, not expanded.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BASELINE_PATH = path.join(HERE, ".dead-exports-baseline.json");

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name) => flag(name)?.split("=").slice(1).join("=") || undefined;
const UPDATE = Boolean(flag("update"));
const REPORT_PATH =
  flagValue("report") ?? path.join(os.tmpdir(), "builderforce-agents-dead-exports-report.json");
const LIST_BUCKET = flagValue("list");

const TREES = ["src", "test", "extensions", "ui"];
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".next", "vendor", ".git"]);
const SOURCE_EXT = /\.(ts|tsx|mts|mjs|js)$/;
const TEST_SEGMENTS = new Set(["test", "__tests__", "test-helpers", "test-utils", "test-fixtures"]);
const TEST_BASENAME = /(\.(test|spec|e2e|live)|[.-]test-(helpers?|utils?|fixtures?|support)|\.fixtures)\.[cm]?[jt]sx?$/;
const SEAM_NAME = /^(_reset|__|mock|fixture|stub|fake)|ForTests?$/i;
const IDENT = /[A-Za-z_$][\w$]*/g;
const RESOLVE_EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs"];
const BUCKETS = [
  "published-sdk-surface",
  "consumed-in-src",
  "consumed-by-extensions",
  "consumed-by-ui",
  "test-seam",
  "test-only",
  "unreferenced",
];

// ---------------------------------------------------------------- file walk
function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

function isTestFile(relPath) {
  if (TEST_BASENAME.test(path.posix.basename(relPath))) return true;
  return relPath.split("/").slice(0, -1).some((seg) => TEST_SEGMENTS.has(seg));
}

/** Reference category of a file: which consumer it speaks for. */
function categoryOf(relPath) {
  const tree = relPath.split("/")[0];
  if (tree === "test" || isTestFile(relPath)) return "test";
  if (tree === "extensions") return "ext";
  if (tree === "ui") return "ui";
  return "src";
}

// ------------------------------------------------------------- text shaping
/**
 * Blank out block comments and whole-line `//` comments, preserving newlines so
 * `^export` anchors still hold. A `/*` only opens a comment when followed by
 * whitespace (or `/**` + whitespace) so glob strings like "src/** /*.ts" survive.
 */
function stripComments(code) {
  return code
    .replace(/\/\*\*?(?=\s)[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const RE_EXPORT_LIST = /^[ \t]*export\s+(type\s+)?\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/gm;
const RE_EXPORT_STAR = /^[ \t]*export\s+\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*["']([^"']+)["']/gm;
const RE_EXPORT_DECL =
  /^[ \t]*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+enum|const|let|var|function\*?|class|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;
const RE_EXPORT_DESTRUCTURE = /^[ \t]*export\s+(?:const|let|var)\s*(\{[^}]*\}|\[[^\]]*\])\s*=/gm;
const RE_IMPORT_LIST = /^[ \t]*import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm;

/** Remove bare re-export statements so a barrel is not a "reference". */
function stripReExports(code) {
  return code
    .replace(RE_EXPORT_LIST, (m, _t, _names, from) => (from ? m.replace(/[^\n]/g, " ") : m))
    .replace(RE_EXPORT_STAR, (m) => m.replace(/[^\n]/g, " "));
}

function destructuredNames(pattern) {
  return pattern
    .slice(1, -1)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const afterColon = part.includes(":") ? part.slice(part.indexOf(":") + 1) : part;
      const m = afterColon.replace(/^\.\.\./, "").trim().match(/^[A-Za-z_$][\w$]*/);
      return m?.[0];
    })
    .filter(Boolean);
}

// --------------------------------------------------------- module resolving
function resolveSpecifier(fromAbs, spec) {
  let base;
  if (spec === "@seanhogg/builderforce-agents/plugin-sdk") {
    base = path.join(ROOT, "src/plugin-sdk/index");
  } else if (spec.startsWith("@seanhogg/builderforce-agents/plugin-sdk/")) {
    base = path.join(ROOT, "src/plugin-sdk", spec.slice("@seanhogg/builderforce-agents/plugin-sdk/".length));
  } else if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromAbs), spec);
  } else {
    return null;
  }
  const stem = base.replace(/\.(js|mjs|ts|tsx|mts)$/, "");
  const candidates = [
    ...RESOLVE_EXTS.map((ext) => stem + ext),
    ...RESOLVE_EXTS.map((ext) => path.join(stem, "index" + ext)),
  ];
  if (/\.(js|mjs|ts|tsx|mts)$/.test(base)) candidates.unshift(base);
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

// --------------------------------------------------------- export extraction
/**
 * Parse one file's export statements.
 * Returns { locals: Set<name>, lists: [{exported, local, from}], stars: [{from, as}] }
 */
function parseExports(abs, code) {
  const locals = new Set();
  const lists = [];
  const stars = [];
  // `import { a, b as c } from "./x"` — so a bare `export { c }` later in the file
  // (the shape of src/index.ts) resolves to its real definer instead of this file.
  const imported = new Map();
  for (const m of code.matchAll(RE_IMPORT_LIST)) {
    const from = resolveSpecifier(abs, m[2]);
    if (!from) continue;
    for (const raw of m[1].split(",")) {
      const part = raw.trim().replace(/^type\s+/, "");
      if (!part) continue;
      const [remote, , local = remote] = part.split(/\s+/);
      imported.set(local, { from, local: remote });
    }
  }
  for (const m of code.matchAll(RE_EXPORT_DECL)) locals.add(m[1]);
  for (const m of code.matchAll(RE_EXPORT_DESTRUCTURE)) for (const n of destructuredNames(m[1])) locals.add(n);
  for (const m of code.matchAll(RE_EXPORT_LIST)) {
    const from = m[3] ? resolveSpecifier(abs, m[3]) : undefined;
    const unresolvedExternal = Boolean(m[3]) && from === null;
    for (const raw of m[2].split(",")) {
      const part = raw.trim().replace(/^type\s+/, "");
      if (!part) continue;
      const [local, , exported = local] = part.split(/\s+/);
      if (exported === "default" || !/^[A-Za-z_$][\w$]*$/.test(exported)) continue;
      if (m[3]) lists.push({ exported, local, from, external: unresolvedExternal });
      else if (imported.has(local)) lists.push({ exported, ...imported.get(local), external: false });
      else locals.add(exported);
    }
  }
  for (const m of code.matchAll(RE_EXPORT_STAR)) {
    const from = resolveSpecifier(abs, m[2]);
    if (m[1]) lists.push({ exported: m[1], local: "*", from, external: from === null, namespace: true });
    else if (from) stars.push({ from });
  }
  return { locals, lists, stars };
}

// ------------------------------------------------------------------- main
const files = TREES.flatMap((tree) => walk(path.join(ROOT, tree), []));
const fileInfo = new Map(); // abs -> { rel, category, stripped }
for (const abs of files) {
  const r = rel(abs);
  fileInfo.set(abs, { rel: r, category: categoryOf(r), stripped: stripComments(fs.readFileSync(abs, "utf8")) });
}

// 1. Exports per src non-test file (parsed lazily for files reached via chains too).
const parsed = new Map();
const parsedOf = (abs) => {
  if (!parsed.has(abs)) {
    const info = fileInfo.get(abs);
    const code = info ? info.stripped : stripComments(fs.readFileSync(abs, "utf8"));
    parsed.set(abs, parseExports(abs, code));
  }
  return parsed.get(abs);
};

/** records: originKey -> { name, file, aliases:Set, reexportedFrom:Set, published } */
const records = new Map();
const keyOf = (abs, name) => `${rel(abs)}::${name}`;
function record(abs, name, alias, via) {
  const key = keyOf(abs, name);
  let rec = records.get(key);
  if (!rec) {
    rec = { name, file: rel(abs), aliases: new Set([name]), reexportedFrom: new Set(), published: false };
    records.set(key, rec);
  }
  rec.aliases.add(alias);
  if (via) rec.reexportedFrom.add(rel(via));
  return rec;
}

/** Resolved export map of a file: exportedName -> record (transitive, cycle-safe). */
const resolvedCache = new Map();
function resolvedExports(abs, seen = new Set()) {
  if (resolvedCache.has(abs)) return resolvedCache.get(abs);
  if (seen.has(abs)) return new Map();
  seen.add(abs);
  const out = new Map();
  const { locals, lists, stars } = parsedOf(abs);
  for (const name of locals) out.set(name, record(abs, name, name));
  for (const item of lists) {
    if (item.from && !item.namespace) {
      const origin = resolvedExports(item.from, seen).get(item.local);
      if (origin) {
        origin.aliases.add(item.exported);
        origin.reexportedFrom.add(rel(abs));
        out.set(item.exported, origin);
        continue;
      }
    }
    // Namespace re-export, or re-export from an external package / unresolvable file:
    // the re-exporting file is the origin as far as this workspace can see.
    out.set(item.exported, record(abs, item.exported, item.exported));
  }
  for (const star of stars) {
    for (const [name, origin] of resolvedExports(star.from, seen)) {
      if (out.has(name)) continue;
      origin.reexportedFrom.add(rel(abs));
      out.set(name, origin);
    }
  }
  resolvedCache.set(abs, out);
  return out;
}

const srcDefiners = files.filter((abs) => {
  const info = fileInfo.get(abs);
  return info.rel.startsWith("src/") && info.category === "src";
});
for (const abs of srcDefiners) resolvedExports(abs);

// 2. Published surface: package.json exports/bin + builderforce.mjs dynamic dist imports.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const rootTargets = new Set();
const distToSrc = (target) => {
  const m = String(target).match(/^\.\/dist\/(.+)\.(?:m?js|d\.ts)$/);
  return m ? path.join(ROOT, "src", m[1]) : null;
};
const addRoot = (target) => {
  const stem = distToSrc(target);
  const abs = stem && resolveSpecifier(path.join(ROOT, "package.json"), "./" + path.relative(ROOT, stem).split(path.sep).join("/"));
  if (abs) rootTargets.add(abs);
  else if (/^(\.\/)?builderforce\.mjs$/.test(String(target))) {
    const cli = fs.readFileSync(path.join(ROOT, "builderforce.mjs"), "utf8");
    for (const m of cli.matchAll(/["'](\.\/dist\/[^"']+\.m?js)["']/g)) addRoot(m[1]);
  }
};
const walkExportsField = (value) => {
  if (typeof value === "string") addRoot(value);
  else if (value && typeof value === "object") Object.values(value).forEach(walkExportsField);
};
walkExportsField(pkg.exports ?? {});
walkExportsField(pkg.bin ?? {});
if (pkg.main) addRoot("./" + String(pkg.main).replace(/^\.\//, ""));
const publishedRoots = [...rootTargets].map(rel).sort();
for (const abs of rootTargets) for (const rec of resolvedExports(abs).values()) rec.published = true;

// Extension entry files (extensions/*/package.json `builderforce.extensions`) are roots
// inside the extensions tree; their imports count as extension references below.
const extensionEntries = [];
for (const dir of fs.readdirSync(path.join(ROOT, "extensions"), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const manifest = path.join(ROOT, "extensions", dir.name, "package.json");
  if (!fs.existsSync(manifest)) continue;
  const entries = JSON.parse(fs.readFileSync(manifest, "utf8"))?.builderforce?.extensions ?? [];
  for (const entry of entries) extensionEntries.push(rel(path.resolve(ROOT, "extensions", dir.name, entry)));
}

// 3. Reference index: identifier -> Set<file> per category, re-exports excluded.
const refIndex = new Map();
for (const [abs, info] of fileInfo) {
  const tokens = new Set(stripReExports(info.stripped).match(IDENT) ?? []);
  for (const token of tokens) {
    let entry = refIndex.get(token);
    if (!entry) refIndex.set(token, (entry = { src: new Set(), test: new Set(), ext: new Set(), ui: new Set() }));
    entry[info.category].add(info.rel);
  }
}

// 4. Classify.
const results = [];
for (const rec of records.values()) {
  if (!rec.file.startsWith("src/")) continue;
  const refs = { src: new Set(), test: new Set(), ext: new Set(), ui: new Set() };
  for (const alias of rec.aliases) {
    const entry = refIndex.get(alias);
    if (!entry) continue;
    for (const cat of Object.keys(refs)) for (const f of entry[cat]) if (f !== rec.file) refs[cat].add(f);
  }
  const counts = Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.size]));
  // Uses inside the defining file beyond the declaration itself: separates an
  // over-exported internal helper (drop the `export`) from code nothing calls.
  const own = fileInfo.get(path.join(ROOT, rec.file))?.stripped ?? "";
  const selfUse = Math.max(0, (own.match(new RegExp(`(?<![\\w$])${rec.name}(?![\\w$])`, "g")) ?? []).length - 1);
  const isSeam = [...rec.aliases].some((a) => SEAM_NAME.test(a));
  let bucket;
  if (rec.published) bucket = "published-sdk-surface";
  else if (counts.src > 0) bucket = "consumed-in-src";
  else if (counts.ext > 0) bucket = "consumed-by-extensions";
  else if (counts.ui > 0) bucket = "consumed-by-ui";
  else if (counts.test > 0) bucket = isSeam ? "test-seam" : "test-only";
  else bucket = "unreferenced";
  const dir = rec.file.split("/")[1]?.includes(".") ? "(root)" : rec.file.split("/")[1];
  results.push({
    name: rec.name,
    file: rec.file,
    dir,
    aliases: [...rec.aliases].filter((a) => a !== rec.name),
    reexportedFrom: [...rec.reexportedFrom].sort(),
    refs: counts,
    selfUse,
    bucket,
  });
}
results.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

// 5. Report.
const bucketCounts = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
for (const r of results) bucketCounts[r.bucket]++;
const byDir = (bucket) => {
  const m = new Map();
  for (const r of results) if (r.bucket === bucket) m.set(r.dir, (m.get(r.dir) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
const table = (rows, head) => {
  const w = Math.max(head[0].length, ...rows.map(([k]) => String(k).length));
  const lines = [`  ${head[0].padEnd(w)}  ${head[1]}`, `  ${"-".repeat(w)}  ${"-".repeat(head[1].length)}`];
  for (const [k, v] of rows) lines.push(`  ${String(k).padEnd(w)}  ${v}`);
  return lines.join("\n");
};

console.log(`dead-export scan: ${fileInfo.size} files (${srcDefiners.length} src definers), ${results.length} exports`);
console.log(`published roots: ${publishedRoots.join(", ")}`);
console.log(`extension entry files: ${extensionEntries.length} (inside extensions/, counted as extension references)`);
console.log("\nbuckets");
console.log(table(Object.entries(bucketCounts), ["bucket", "count"]));
for (const bucket of ["test-only", "unreferenced"]) {
  console.log(`\n${bucket} by src/ directory`);
  console.log(table(byDir(bucket), ["directory", "count"]));
}
if (LIST_BUCKET) {
  console.log(`\n${LIST_BUCKET} exports`);
  for (const r of results) if (r.bucket === LIST_BUCKET) console.log(`  ${r.file} :: ${r.name}`);
}

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify({ generatedAt: new Date().toISOString(), publishedRoots, extensionEntries, buckets: bucketCounts, exports: results }, null, 2),
);
console.log(`\nfull report: ${REPORT_PATH}`);

// 6. Ratchet.
const current = { unreferenced: bucketCounts.unreferenced, testOnly: bucketCounts["test-only"] };
if (UPDATE || !fs.existsSync(BASELINE_PATH)) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  console.log(`baseline ${UPDATE ? "updated" : "seeded"}: ${JSON.stringify(current)}`);
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
const regressions = Object.entries(current).filter(([k, v]) => v > (baseline[k] ?? 0));
if (regressions.length) {
  for (const [k, v] of regressions) console.error(`RATCHET: ${k} grew ${baseline[k]} -> ${v}`);
  console.error("Wire the new export or drop it; run with --update only after a deliberate baseline change.");
  process.exit(1);
}
console.log(`ratchet OK: ${JSON.stringify(current)} within baseline ${JSON.stringify(baseline)}`);
