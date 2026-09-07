#!/usr/bin/env node
/**
 * Generate (and, with `--check`, verify) the inlinable copy of the shared image relay.
 *
 * `api/container/agentRelay.mjs` is the ONE dispatch table for every Worker-relayed
 * tool, and two images run it. The Cloudflare Container imports the file directly, so
 * it needs nothing from this script. The GitHub Actions runner cannot: it is a single
 * file served over HTTP into a bare checkout with no `npm install`, rendered from a
 * Worker that has no filesystem to read the module from at request time. So the module
 * source is baked into the Worker bundle as a string, and the runner inlines it.
 *
 * That makes the generated file a COPY, and a copy that can rot is exactly the problem
 * this whole consolidation exists to remove — so `--check` runs in the api check chain
 * and fails the build the moment the two diverge. The fix is never to hand-edit the
 * generated file; it is to run this script.
 *
 *   node scripts/gen-agent-relay-source.mjs           # write
 *   node scripts/gen-agent-relay-source.mjs --check   # verify, exit 1 on drift
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, '..');
const SOURCE = join(API_ROOT, 'container', 'agentRelay.mjs');
const OUT = join(API_ROOT, 'src', 'application', 'runtime', 'generated', 'agentRelaySource.ts');

/**
 * The module body as the Actions runner needs it: the same code with its `export`
 * keywords removed, because the runner is ONE file — the declarations become
 * top-level bindings in that file rather than a module's exports.
 *
 * Line endings are normalised to LF first. The module is stored LF in git, but a
 * Windows checkout with `core.autocrlf=true` hands this script CRLF, which would be
 * baked into the string as `\r\n` escapes — making the generated file a function of
 * WHICH MACHINE ran the generator: `--check` passes for the author and fails in CI,
 * and the runner ships CRLF for no reason. Normalising makes the artifact depend on
 * the module's content and nothing else.
 *
 * Beyond that, only a leading `export ` on a declaration is stripped (anchored per
 * line); nothing else about the source is rewritten, so what runs on the runner is
 * what you read in `agentRelay.mjs`.
 */
function toInline(source) {
  return source.replace(/\r\n/g, '\n').replace(/^export /gm, '');
}

function render(source) {
  const inline = toInline(source);
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * The inlinable form of \`api/container/agentRelay.mjs\`, baked into the Worker bundle
 * so \`githubActionsRunner.ts\` can emit it inside the single-file runner script it
 * serves. \`export\` keywords are stripped: the runner is one file, so the declarations
 * are top-level bindings there rather than module exports.
 *
 * Regenerate with \`node scripts/gen-agent-relay-source.mjs\` (from \`api/\`).
 * \`scripts/gen-agent-relay-source.mjs --check\` runs in the check chain and fails if
 * this file has drifted from the module it copies.
 */

export const AGENT_RELAY_INLINE = ${JSON.stringify(inline)};
`;
}

const source = await readFile(SOURCE, 'utf8');
const expected = render(source);

if (process.argv.includes('--check')) {
  let actual = null;
  try {
    actual = await readFile(OUT, 'utf8');
  } catch {
    actual = null;
  }
  if (actual !== expected) {
    console.error('[gen-agent-relay-source] src/application/runtime/generated/agentRelaySource.ts is out of date.');
    console.error('[gen-agent-relay-source] The GitHub Actions runner would ship a STALE copy of container/agentRelay.mjs.');
    console.error('[gen-agent-relay-source] Fix: cd api && node scripts/gen-agent-relay-source.mjs');
    process.exit(1);
  }
  console.log('[gen-agent-relay-source] ok — the runner inlines the current relay module.');
  process.exit(0);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, expected);
console.log(`[gen-agent-relay-source] wrote ${OUT}`);
