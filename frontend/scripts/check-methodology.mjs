#!/usr/bin/env node
/**
 * The methodology mirror ratchet.
 *
 * `frontend/src/lib/methodology.ts` declares the eight proof forms so that four
 * signed-out marketing pages can render them without an API call, and
 * `i18n/messages/en.json` carries their English copy. The AUTHORITY is
 * `api/src/application/realization/targets/*` — the registry the product
 * actually plans and builds from.
 *
 * A mirror with a ratchet is a mirror. A mirror without one is a second source
 * of truth, and this particular pair of numbers is the worst possible place for
 * one: `fidelity` and `effort` are the two axes the whole recommendation turns
 * on, so a marketing page that had them a point out would be advertising
 * different advice than the product gives — quietly, and in the direction that
 * sells better.
 *
 * Six checks:
 *   1. SAME EIGHT — no target in the API that the site cannot show, and none on
 *      the site that the product cannot build.
 *   2. SAME NUMBERS — fidelity and effort match, per key.
 *   3. SAME BACKEND POSTURE — `live` means "this proof publishes an address",
 *      which is exactly `strategy !== null` in the API.
 *   4. SAME WORDS — the English name / question / summary are the API's own
 *      strings, so the pitch cannot drift from the product's own card.
 *   5. EVERY STEP HAS COPY — Read / Prove / Build each have a title, a question
 *      and a body.
 *   6. EVERY STAGE HAS A QUESTION AND A HUE — `STAGES` is iterated into
 *      `var(--stage-<id>)` by the left panel and by /features' arc table, and an
 *      undeclared custom property silently drops the declaration that uses it.
 *      A template literal is invisible to `check-design-tokens`; this closes it.
 *      (`--stage-expand` was missing for as long as the stage existed.)
 *
 * Run via `npm run check:methodology`; wired into `npm test`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const TARGETS_DIR = path.resolve(ROOT, '..', 'api', 'src', 'application', 'realization', 'targets');

const failures = [];
const fail = (message) => failures.push(message);

// ── The authority: the API's own target registry ───────────────────────────
/** Every field a target declares, read from the window right after its `key`.
 *  The declaration order is key → name → summary → answers → fidelity → effort,
 *  contiguous, so one window catches them all without parsing TypeScript. */
function readTargets(dir) {
  const found = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts') || file === 'index.ts' || file.endsWith('.test.ts')) continue;
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const at = source.search(/^\s*key:\s*'[a-z-]+',$/m);
    if (at === -1) continue;
    const window = source.slice(at, at + 900);
    const field = (name) => window.match(new RegExp(`^\\s*${name}:\\s*'([^']*)',$`, 'm'))?.[1];
    const num = (name) => {
      const raw = window.match(new RegExp(`^\\s*${name}:\\s*(\\d),$`, 'm'))?.[1];
      return raw == null ? undefined : Number(raw);
    };
    const key = field('key');
    if (!key) continue;
    found.set(key, {
      file,
      name: field('name'),
      summary: field('summary'),
      answers: field('answers'),
      fidelity: num('fidelity'),
      effort: num('effort'),
      // `strategy: null` (no backend) vs a strategy key (publishes an address).
      live: !/^\s*strategy:\s*null,$/m.test(window),
    });
  }
  return found;
}

if (!fs.existsSync(TARGETS_DIR)) {
  // The frontend is built on its own in some pipelines; a missing sibling
  // package is not a marketing-copy defect, so this reports and passes rather
  // than failing a build it cannot see the other half of.
  console.log('⚠️  check-methodology skipped — api/src/application/realization/targets is not present.');
  process.exit(0);
}

const targets = readTargets(TARGETS_DIR);
if (targets.size === 0) fail('[targets] No realization targets could be read from the API package.');

// ── The mirror: PROOF_FORMS in lib/methodology.ts ──────────────────────────
const methodologySource = fs.readFileSync(path.join(SRC, 'lib', 'methodology.ts'), 'utf8');
const proofBlock = methodologySource.match(/export const PROOF_FORMS[\s\S]*?\n\];/)?.[0] ?? '';
if (!proofBlock) fail('[mirror] PROOF_FORMS could not be located in lib/methodology.ts.');

const mirror = new Map(
  [...proofBlock.matchAll(/\{\s*key:\s*'([^']+)',\s*fidelity:\s*(\d),\s*effort:\s*(\d),\s*live:\s*(true|false)\s*\}/g)]
    .map((m) => [m[1], { fidelity: Number(m[2]), effort: Number(m[3]), live: m[4] === 'true' }]),
);

const stepBlock = methodologySource.match(/export const METHOD_STEP_SPECS[\s\S]*?\n\];/)?.[0] ?? '';
const steps = [...stepBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
const stepHueVars = [...stepBlock.matchAll(/hueVar:\s*'(--[a-zA-Z-]+)'/g)].map((m) => m[1]);

// ── The copy: en.json ──────────────────────────────────────────────────────
const en = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n', 'messages', 'en.json'), 'utf8'));
const copy = en.methodology ?? {};

// ── 1 · Same eight ─────────────────────────────────────────────────────────
for (const key of targets.keys()) {
  if (!mirror.has(key)) {
    fail(
      `[same-eight] The API builds \`${key}\` and lib/methodology.ts does not list it.\n` +
      '    A proof the product can run but the site cannot name is an unsold capability.',
    );
  }
}
for (const key of mirror.keys()) {
  if (!targets.has(key)) {
    fail(
      `[same-eight] lib/methodology.ts advertises \`${key}\`, which no API target declares.\n` +
      '    Remove it, or add the target — a marketing page may not promise a proof that cannot be built.',
    );
  }
}

// ── 2–4 · Same numbers, same posture, same words ───────────────────────────
for (const [key, target] of targets) {
  const mirrored = mirror.get(key);
  if (mirrored) {
    if (mirrored.fidelity !== target.fidelity) {
      fail(`[same-numbers] \`${key}\` fidelity is ${mirrored.fidelity} on the site and ${target.fidelity} in ${target.file}.`);
    }
    if (mirrored.effort !== target.effort) {
      fail(`[same-numbers] \`${key}\` effort is ${mirrored.effort} on the site and ${target.effort} in ${target.file}.`);
    }
    if (mirrored.live !== target.live) {
      fail(
        `[same-posture] \`${key}\` is marked ${mirrored.live ? 'live' : 'not live'} on the site but its API strategy says otherwise.\n` +
        '    `live` means the proof publishes an address, which is `strategy !== null`.',
      );
    }
  }

  const text = copy.proof?.[key];
  if (!text) {
    fail(`[same-words] en.json has no \`methodology.proof.${key}\` copy.`);
    continue;
  }
  const compare = [
    ['name', text.name, target.name],
    ['question', text.question, target.answers],
    ['summary', text.summary, target.summary],
  ];
  for (const [field, site, api] of compare) {
    if (api != null && site !== api) {
      fail(
        `[same-words] \`methodology.proof.${key}.${field}\` differs from ${target.file}.\n` +
        `      site: ${JSON.stringify(site)}\n` +
        `       api: ${JSON.stringify(api)}`,
      );
    }
  }
}

// ── 5 · Every step has copy ────────────────────────────────────────────────
if (steps.length === 0) fail('[steps] METHOD_STEP_SPECS could not be located in lib/methodology.ts.');
for (const step of steps) {
  for (const field of ['title', 'question', 'body']) {
    if (!copy.step?.[step]?.[field]) {
      fail(`[steps] en.json has no \`methodology.step.${step}.${field}\`.`);
    }
  }
}

// ── 6 · Every stage has a question and a declared hue ──────────────────────
const navSource = fs.readFileSync(path.join(SRC, 'lib', 'navGroups.ts'), 'utf8');
const stages = [...(navSource.match(/export const STAGES = \[[\s\S]*?\] as const;/)?.[0] ?? '')
  .matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (stages.length === 0) fail('[stages] STAGES could not be located in lib/navGroups.ts.');

const css = fs.readFileSync(path.join(SRC, 'app', 'globals.css'), 'utf8');
const declared = (variable) => new RegExp(`^\\s*${variable}:\\s*[^;]+;`, 'm').test(css);

for (const stage of stages) {
  if (!copy.arcQuestion?.[stage]) {
    fail(
      `[stages] en.json has no \`methodology.arcQuestion.${stage}\`.\n` +
      '    /features renders one row per stage and would print the raw key.',
    );
  }
  if (!declared(`--stage-${stage}`)) {
    fail(
      `[stages] \`--stage-${stage}\` is not declared in globals.css.\n` +
      '    It is referenced through a template literal, so an undeclared value drops the\n' +
      '    whole declaration silently — the stage dot paints nothing, in both themes.',
    );
  }
}

for (const hueVar of stepHueVars) {
  if (!declared(hueVar)) fail(`[steps] \`${hueVar}\` is not declared in globals.css.`);
}

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n❌ check-methodology — ${failures.length} problem(s):\n`);
  for (const message of failures) console.error(`  ${message}\n`);
  process.exit(1);
}

console.log(
  `✅ check-methodology OK — ${targets.size} proof forms mirrored from the API with matching ` +
  `fidelity/effort and copy; ${steps.length} method steps and ${stages.length} stages all have copy and a hue.`,
);
