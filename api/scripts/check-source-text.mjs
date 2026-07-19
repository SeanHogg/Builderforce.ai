#!/usr/bin/env node
/**
 * Searchable-source guard.
 *
 * A single raw NUL (0x00) byte anywhere in a file makes ripgrep classify the WHOLE
 * file as binary and skip it. The file then becomes invisible to every code search
 * — audits, code review, `git grep`-style sweeps, and agent tooling all return
 * "no matches" for symbols that are plainly there.
 *
 * This is not hypothetical: `application/quality/ingestEngine.ts` used a raw NUL as
 * a Set-key separator, and a search for its `enforceErrorEventsCap` call site came
 * back empty — leading to the wrong conclusion that a live enforcement gate was
 * dead code. Two more files (`insights/engineeringInsights.ts`,
 * `studio/voiceCloneService.ts`) had the same idiom.
 *
 * The fix is never to change behaviour: write the ESCAPE (\u0000) instead of the
 * raw byte. Identical string at runtime, and the file stays text.
 *
 * Scans every source tree in the repo, not just the api, since the hazard is
 * repo-wide. Run via `npm run check:source` and wired into `npm test`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repoRoot = resolve(here, '../..');

/** Source trees worth guarding — everything a human or an agent greps. */
const ROOTS = [
  'api/src',
  'api/scripts',
  'frontend/src',
  'brain-embedded/src',
  'packages',
  'clients/vscode/src',
  'clients/vscode/webview/src',
];

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.md', '.sql']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.vercel', '.wrangler', '.git']);

/** Every guarded source file under `dir`. */
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.has(extname(name))) yield full;
  }
}

const offenders = [];
let scanned = 0;

for (const root of ROOTS) {
  const dir = resolve(repoRoot, root);
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    scanned++;
    const buf = readFileSync(file);
    const idx = buf.indexOf(0);
    if (idx === -1) continue;
    // Report the line so the fix is a one-liner for whoever hits this.
    const line = buf.subarray(0, idx).toString('utf8').split('\n').length;
    let count = 0;
    for (const byte of buf) if (byte === 0) count++;
    offenders.push({ file: relative(repoRoot, file), line, count });
  }
}

if (offenders.length > 0) {
  console.error('\n❌  Source files containing raw NUL bytes — these are INVISIBLE to ripgrep/code search:\n');
  for (const o of offenders) {
    console.error(`   ${o.file}:${o.line}  (${o.count} NUL byte${o.count === 1 ? '' : 's'})`);
  }
  console.error('\n   Fix: replace the raw NUL with its escape sequence (backslash-u-0000) inside the');
  console.error('   string literal. The runtime value is identical, so no key, hash, or cached');
  console.error('   digest changes — the file simply stops testing as binary.\n');
  process.exit(1);
}

console.log(`✅  Searchable-source check passed — ${scanned} files scanned, no raw NUL bytes.`);
