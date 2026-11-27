#!/usr/bin/env node
/**
 * Post-build guard: `out/extension.js` must not reach for the memory engine or the
 * memory runtime by NAME at run time unless a host can inject them first.
 *
 * `@seanhogg/builderforce-memory-mcp` loads its optional peers through `dynamicImport(name)`
 * (a `new Function` import no bundler can see). Inside a packaged .vsix (`--no-dependencies`)
 * that name resolves to nothing, so a call that was not given the module fails only in the
 * user's editor. The bundled hosts therefore hand in the statically imported modules
 * (`engine`, `memory`, `idbFactory`, `injected`), and every remaining call in the bundle
 * must sit behind such an injected-value check: `<injected> ?? (await dynamicImport(...))`.
 * A bare `dynamicImport("@seanhogg/builderforce-memory-engine")` fails the build.
 *
 *   node scripts/check-bundle-dynamic-imports.mjs [path/to/extension.js]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CALL = /dynamicImport\(\s*["'](@seanhogg\/builderforce-memory(?:-engine)?)["']\s*\)/g;
/** What must precede the call, ignoring whitespace: `x ??` / `x ||` and an optional `(await `. */
const GUARDED = /(?:\?\?|\|\|)\s*\(?\s*(?:await\s+)?$/;

/** The calls in `source` that are not behind an injected-value check, as `{ module, line }`. */
export function unguardedDynamicImports(source) {
  const found = [];
  for (const m of source.matchAll(CALL)) {
    const before = source.slice(Math.max(0, m.index - 80), m.index);
    if (GUARDED.test(before)) continue;
    found.push({ module: m[1], line: source.slice(0, m.index).split("\n").length });
  }
  return found;
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? path.join(here, "..", "out", "extension.js");
  if (!fs.existsSync(file)) {
    console.error(`check-bundle-dynamic-imports: ${file} does not exist; build first.`);
    process.exit(1);
  }
  const bad = unguardedDynamicImports(fs.readFileSync(file, "utf8"));
  if (bad.length) {
    console.error(`check-bundle-dynamic-imports: ${bad.length} run-time import(s) of a memory package that no host can inject:`);
    for (const b of bad) console.error(`  ${path.basename(file)}:${b.line}  dynamicImport("${b.module}")`);
    console.error("Pass the statically imported module into the memory-mcp call (engine / memory / idbFactory) so the bundle never imports it by name.");
    process.exit(1);
  }
  console.log("check-bundle-dynamic-imports: ok - every memory-package dynamicImport is behind an injected value.");
}
