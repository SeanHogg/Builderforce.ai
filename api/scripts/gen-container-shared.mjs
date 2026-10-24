#!/usr/bin/env node
/**
 * Generate (and, with `--check`, verify) the shared TypeScript module the Cloudflare
 * Container sandbox imports — the same pattern as `gen-agent-loop-bundle.mjs`.
 *
 * The container is plain Node ESM with no build step (its Dockerfile copies `.mjs`
 * files), so it cannot import a source-only package. Rather than hand-copy the logic
 * (which is how the container came to return the HEAD of a command's output while its
 * capture buffer kept the TAIL), the module below is compiled from its ONE source into
 * a dependency-free `.mjs` beside `server.mjs`. Every tool definition (the `read_file`
 * window, the `edit_file` core, `repo_map`) runs in the Worker's engine now, so the
 * sandbox needs only the output cuts for what its shell prints:
 *
 *   • `container/toolOutputPolicy.mjs` ← `packages/tool-output-policy` (PRD C7: caps,
 *     head+tail cuts, the shell/test summarizer, JSON projection, read_file windows);
 *
 * `--check` needs no compiler: each bundle's header carries a hash of the source it was
 * built from, so the check recomputes it and fails the moment a source changes without
 * the bundle being regenerated. The fix is never to hand-edit a generated file.
 *
 *   node scripts/gen-container-shared.mjs           # write (needs `typescript`)
 *   node scripts/gen-container-shared.mjs --check   # verify, exit 1 on drift
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(API_ROOT, '..');
const HASH_TAG = '@source-sha256';

/** Each bundle: its source files in dependency order and the names it exports. */
const BUNDLES = [
  {
    out: join(API_ROOT, 'container', 'toolOutputPolicy.mjs'),
    srcDir: join(REPO_ROOT, 'packages', 'tool-output-policy', 'src'),
    files: ['caps.ts', 'textCut.ts', 'shellSummary.ts', 'jsonProjection.ts', 'readFileWindow.ts', 'policy.ts', 'modelPolicy.ts'],
    exports: [
      'SHELL_CAPTURE_CHARS', 'TOOL_OUTPUT_CAPS', 'toolOutputCap', 'keepTail', 'cutHead', 'cutHeadTail',
      'summarizeShellOutput', 'detectRunner', 'projectJson', 'windowReadFile', 'fitToolText', 'shapeToolResult',
      'modelToolResultPolicy',
    ],
  },
];

const lf = (text) => text.replace(/\r\n/g, '\n');

async function readSources(bundle) {
  return Promise.all(bundle.files.map(async (file) => [file, lf(await readFile(join(bundle.srcDir, file), 'utf8'))]));
}

function sourceHash(sources) {
  const hash = createHash('sha256');
  for (const [file, text] of sources) hash.update(`${file}\n${text}\n`);
  return hash.digest('hex');
}

/** One module, transpiled and flattened: sibling imports dropped (they are inlined in
 *  this same file) and `export` keywords stripped — the bundle exports its own list. */
function flatten(ts, file, source) {
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false },
  }).outputText;
  const body = lf(js)
    .replace(/^import\s[\s\S]*?\sfrom\s+["']\.\/[^"']+["'];?[ \t]*\n/gm, '')
    .replace(/^export \{[^}]*\};?[ \t]*\n/gm, '')
    .replace(/^export /gm, '');
  return `// ── ${file} ──\n${body.trim()}\n`;
}

function render(bundle, hash, modules) {
  const rel = bundle.srcDir.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Compiled from \`${rel}\` (${bundle.files.join(', ')}) into one dependency-free ESM
 * module for the Cloudflare Container, which has no build step.
 *
 * Regenerate with \`node scripts/gen-container-shared.mjs\` (from \`api/\`).
 * \`--check\` fails the build when the source no longer matches the hash below.
 *
 * ${HASH_TAG} ${hash}
 */
${modules.join('\n')}
export { ${bundle.exports.join(', ')} };
`;
}

const check = process.argv.includes('--check');
const ts = check ? null : (await import('typescript')).default;
const problems = [];

for (const bundle of BUNDLES) {
  const sources = await readSources(bundle);
  const hash = sourceHash(sources);
  if (check) {
    const current = await readFile(bundle.out, 'utf8').catch(() => null);
    if (!current || !lf(current).includes(`${HASH_TAG} ${hash}`)) {
      problems.push(`${bundle.out.slice(API_ROOT.length + 1)} was not built from the current source.`);
    }
    continue;
  }
  await writeFile(bundle.out, render(bundle, hash, sources.map(([file, text]) => flatten(ts, file, text))));
  console.log(`[gen-container-shared] wrote ${bundle.out}`);
}

if (check) {
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[gen-container-shared] ${problem}`);
    console.error('[gen-container-shared] Fix: cd api && node scripts/gen-container-shared.mjs');
    process.exit(1);
  }
  console.log('[gen-container-shared] ok — the container runs the current shared modules.');
}
