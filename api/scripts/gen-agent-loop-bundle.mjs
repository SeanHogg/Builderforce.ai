#!/usr/bin/env node
/**
 * Generate (and, with `--check`, verify) the agent-loop KERNEL for the two image
 * surfaces — the same pattern as `gen-agent-relay-source.mjs`.
 *
 * `@builderforce/agent-loop` is THE model→tools→model skeleton every other surface
 * drives. The two images could not: the Cloudflare Container is plain Node ESM with no
 * build step (its Dockerfile copies `.mjs` files), and the GitHub Actions runner is ONE
 * file rendered by the Worker into a bare checkout with no `npm install`. Each carried a
 * hand-written loop instead — with a 20-step cap the kernel retired, no failure-streak
 * breaker and no repetition-loop trim.
 *
 * So this script compiles the kernel's source closure (`loop.ts`, `openaiCodec.ts` and
 * the relative modules they import) into ONE dependency-free ESM file,
 * `api/container/agentLoop.mjs`, which the container imports next to the image loop
 * (`agentImageLoop.mjs` — the image semantics mapped onto the kernel's hooks, shared by
 * both images). It also bakes BOTH files into `generated/agentLoopSource.ts` so the
 * Actions runner inlines exactly what the container imports.
 *
 * `--check` needs no compiler: the bundle's header carries a hash of the kernel source
 * it was built from, so the check recomputes that hash from `packages/agent-loop` and
 * fails the moment the kernel changes without the bundle being regenerated — and it
 * fails if the inlined copy has drifted from the two files. A toolchain upgrade can
 * therefore never fail the check by itself; only a stale copy can. The fix is never to
 * hand-edit a generated file; it is to run this script.
 *
 *   node scripts/gen-agent-loop-bundle.mjs           # write (needs `typescript`)
 *   node scripts/gen-agent-loop-bundle.mjs --check   # verify, exit 1 on drift
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, '..');
const KERNEL_SRC = resolve(API_ROOT, '..', 'packages', 'agent-loop', 'src');
const BUNDLE = join(API_ROOT, 'container', 'agentLoop.mjs');
const IMAGE_LOOP = join(API_ROOT, 'container', 'agentImageLoop.mjs');
const OUT = join(API_ROOT, 'src', 'application', 'runtime', 'generated', 'agentLoopSource.ts');

/** The kernel modules the images use, and the names the bundle exports. */
const ENTRIES = ['loop.ts', 'openaiCodec.ts'];
const PUBLIC = ['runAgentLoop', 'openAiChatCodec', 'readOpenAiToolCalls'];

const HASH_TAG = '@source-sha256';
const RELATIVE_IMPORT = /from\s+["'](\.\/[^"']+)["']/g;

const lf = (text) => text.replace(/\r\n/g, '\n');

/** `./x.js` → `x.ts`, the kernel's own spelling of a sibling module. */
function moduleFile(specifier) {
  return posix.basename(specifier).replace(/\.js$/, '.ts');
}

/** The entries and every relative module they reach (type-only edges included, so the
 *  hash covers every file whose change could change the kernel), dependencies first. */
async function kernelClosure() {
  const order = [];
  const sources = new Map();
  const seen = new Set();
  async function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = lf(await readFile(join(KERNEL_SRC, file), 'utf8'));
    sources.set(file, source);
    for (const match of source.matchAll(RELATIVE_IMPORT)) await visit(moduleFile(match[1]));
    order.push(file);
  }
  for (const entry of ENTRIES) await visit(entry);
  return { order, sources };
}

function sourceHash(order, sources) {
  const hash = createHash('sha256');
  for (const file of [...order].sort()) hash.update(`${file}\n${sources.get(file)}\n`);
  return hash.digest('hex');
}

/** One module, transpiled and flattened into the bundle: its relative imports are the
 *  other modules of this same file, and only the PUBLIC names stay exported. */
function flatten(ts, file, source) {
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false },
  }).outputText;
  const body = lf(js)
    .replace(/^import\s[\s\S]*?\sfrom\s+["']\.\/[^"']+["'];?[ \t]*\n/gm, '')
    .replace(/^export \{\s*\};?[ \t]*\n/gm, '')
    .replace(/^export /gm, '');
  const exported = new RegExp(`^((?:async )?function\\s+(?:${PUBLIC.join('|')})\\b)`, 'gm');
  return `// ── ${file} ──\n${body.replace(exported, 'export $1').trim()}\n`;
}

function renderBundle(hash, modules) {
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * \`@builderforce/agent-loop\` (the kernel every agent surface drives), compiled into one
 * dependency-free ESM module for the image surfaces: the Cloudflare Container imports it
 * from \`agentImageLoop.mjs\`, and the GitHub Actions runner inlines it via
 * \`src/application/runtime/generated/agentLoopSource.ts\`.
 *
 * Regenerate with \`node scripts/gen-agent-loop-bundle.mjs\` (from \`api/\`).
 * \`--check\` fails the build when the kernel source no longer matches the hash below.
 *
 * ${HASH_TAG} ${hash}
 */
${modules.join('\n')}`;
}

/** A module body as the single-file runner needs it: no imports of the sibling files
 *  (they are inlined beside it) and no `export` keywords (top-level bindings there). */
function toInline(source) {
  return lf(source)
    .replace(/^import\s[\s\S]*?\sfrom\s+'\.\/agentLoop\.mjs';[ \t]*\n/gm, '')
    .replace(/^export /gm, '');
}

function renderInline(bundle, imageLoop) {
  const inline = `${toInline(bundle)}\n${toInline(imageLoop)}`;
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * The inlinable form of \`api/container/agentLoop.mjs\` (the agent-loop kernel) followed
 * by \`api/container/agentImageLoop.mjs\` (the image semantics on its hooks), baked into
 * the Worker bundle so \`githubActionsRunner.ts\` emits inside its single-file runner
 * exactly what the container imports. \`export\` keywords and the sibling import are
 * stripped: the runner is one file.
 *
 * Regenerate with \`node scripts/gen-agent-loop-bundle.mjs\` (from \`api/\`).
 * \`--check\` runs in the check chain and fails if this file has drifted.
 */

export const AGENT_LOOP_INLINE = ${JSON.stringify(inline)};
`;
}

const { order, sources } = await kernelClosure();
const hash = sourceHash(order, sources);

async function readOrNull(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

if (process.argv.includes('--check')) {
  const bundle = await readOrNull(BUNDLE);
  const imageLoop = await readOrNull(IMAGE_LOOP);
  const inline = await readOrNull(OUT);
  const problems = [];
  if (!bundle || !lf(bundle).includes(`${HASH_TAG} ${hash}`)) {
    problems.push('container/agentLoop.mjs was not built from the current packages/agent-loop source.');
  }
  if (!imageLoop) problems.push('container/agentImageLoop.mjs is missing.');
  if (bundle && imageLoop && (inline === null || lf(inline) !== renderInline(bundle, imageLoop))) {
    problems.push('src/application/runtime/generated/agentLoopSource.ts has drifted from container/agentLoop.mjs + agentImageLoop.mjs.');
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[gen-agent-loop-bundle] ${problem}`);
    console.error('[gen-agent-loop-bundle] The image surfaces would run a STALE agent loop.');
    console.error('[gen-agent-loop-bundle] Fix: cd api && node scripts/gen-agent-loop-bundle.mjs');
    process.exit(1);
  }
  console.log('[gen-agent-loop-bundle] ok — both images run the current agent-loop kernel.');
  process.exit(0);
}

const ts = (await import('typescript')).default;
const bundle = renderBundle(hash, order.map((file) => flatten(ts, file, sources.get(file))));
await writeFile(BUNDLE, bundle);
const imageLoop = await readFile(IMAGE_LOOP, 'utf8');
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, renderInline(bundle, imageLoop));
console.log(`[gen-agent-loop-bundle] wrote ${BUNDLE} and ${OUT}`);
