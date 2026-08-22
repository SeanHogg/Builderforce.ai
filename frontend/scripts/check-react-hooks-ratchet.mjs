#!/usr/bin/env node
/**
 * React-hooks ratchet — the six rules are OFF in `eslint.config.js`, and this is
 * what stops that from meaning "forever".
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * `eslint-plugin-react-hooks` v6 and the React Compiler rules fire on hundreds of
 * pre-existing, working call sites — the standard fetch-on-mount effect, ref
 * mirrors, manual memoization. Turning them into errors would have meant a large
 * behaviour-changing refactor before anything else could land, so they were
 * turned off with a roadmap entry standing in for the cleanup. That entry then
 * sat for months and its own numbers went stale by an order of magnitude: it said
 * "~72 warnings demoted to `warn`"; the rules were `off`, and the real count was
 * 673.
 *
 * A number nobody measures is not a plan. This makes it a RATCHET instead: the
 * count per file may fall and may not rise, so every edit to a component either
 * leaves its debt alone or reduces it, and a NEW file starts at zero.
 *
 * ── WHY IT RUNS ON CHANGED FILES, MEASURED RATHER THAN GUESSED ───────────────
 * These rules are expensive in a way ordinary lint rules are not: four of the six
 * run the React Compiler over the file. Measured here — ~17s for a 90-line
 * component, ~57s for `CreationCanvas.tsx`, and ~10 minutes for a full sweep of
 * all 2,071 files. That rules out both extremes. A full sweep in `npm test` would
 * dominate the build; a per-file check on every editor save would tax every edit
 * by a quarter-minute, which is how a guard gets switched off.
 *
 * So `--changed` is the wired-in mode: lint the files this branch actually
 * touched. The cost is proportional to the change — a PR touching three
 * components pays a minute — and a change that touches no component pays nothing.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *   node scripts/check-react-hooks-ratchet.mjs --changed  # wired into npm test
 *   node scripts/check-react-hooks-ratchet.mjs --file src/components/Foo.tsx
 *   node scripts/check-react-hooks-ratchet.mjs            # full sweep, ~10 min
 *   node scripts/check-react-hooks-ratchet.mjs --update   # rewrite the baseline
 *
 * The baseline lists only files that still carry warnings, so it shrinks toward
 * empty and its length is the size of the debt.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const frontendDir = resolve(here, '..');
const baselineFile = resolve(here, '.react-hooks-baseline.txt');

/**
 * The rules `eslint.config.js` turns off. Listed here rather than read from there
 * because this file is the one that decides what is being ratcheted DOWN — if a
 * rule is re-enabled as an error, it leaves this list and the ratchet stops
 * counting it, which is the end state.
 */
const RULES = [
  'react-hooks/set-state-in-effect',
  'react-hooks/refs',
  'react-hooks/purity',
  'react-hooks/immutability',
  'react-hooks/preserve-manual-memoization',
  'react-hooks/exhaustive-deps',
];

const UPDATE = process.argv.includes('--update');
const CHANGED = process.argv.includes('--changed');
const FILE_AT = process.argv.indexOf('--file');

/**
 * The `src` files this branch touched: uncommitted work, plus everything since
 * the merge base with the upstream default branch when there is one.
 *
 * Both halves matter. On a developer's machine the interesting files are usually
 * uncommitted; in CI the checkout is clean and the change is the branch.
 */
function changedSourceFiles() {
  // Every command runs from the REPO ROOT and reports repo-relative paths.
  // `ls-files` alone would otherwise print relative to the cwd while `diff`
  // prints from the root — the mismatch silently dropped the untracked half.
  const repoRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: frontendDir, encoding: 'utf8' });
  if (repoRoot.status !== 0) {
    console.log('ℹ️   Not a git checkout — nothing to compare, so no file was checked.');
    return [];
  }
  const root = (repoRoot.stdout ?? '').trim();

  const commands = [
    ['diff', '--name-only', 'HEAD'],
    // Untracked files are invisible to `git diff`, and a brand-new component is
    // the case this guard most wants: it is the one that starts at zero and has
    // no excuse for a warning.
    ['ls-files', '--others', '--exclude-standard', '--full-name'],
  ];
  const base = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main'], { cwd: root, encoding: 'utf8' });
  if (base.status === 0) commands.push(['diff', '--name-only', 'origin/main...HEAD']);

  const files = new Set();
  for (const args of commands) {
    const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (run.status !== 0) continue;
    for (const line of (run.stdout ?? '').split('\n')) {
      const path = line.trim();
      if (!path.startsWith('frontend/src/') || !/\.tsx?$/.test(path)) continue;
      if (/\.(test|spec)\.tsx?$/.test(path)) continue;
      const absolute = resolve(root, path);
      if (existsSync(absolute)) files.add(absolute);
    }
  }
  return [...files];
}

/** Repo-relative, forward-slashed — the baseline key. */
const key = (file) => relative(frontendDir, resolve(file)).split('\\').join('/');

function readBaseline() {
  if (!existsSync(baselineFile)) return new Map();
  return new Map(
    readFileSync(baselineFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const at = line.lastIndexOf(' ');
        return [line.slice(0, at), Number(line.slice(at + 1))];
      }),
  );
}

/**
 * Warning count per file, for the rules above only.
 *
 * The rules are switched back on HERE rather than in `eslint.config.js`, so the
 * app's own lint and build stay clean while the ratchet still sees them.
 */
async function countWarnings(patterns) {
  const eslint = new ESLint({
    cwd: frontendDir,
    overrideConfig: [{ rules: Object.fromEntries(RULES.map((rule) => [rule, 'warn'])) }],
  });
  const results = await eslint.lintFiles(patterns);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const result of results) {
    const hits = result.messages.filter((message) => message.ruleId && RULES.includes(message.ruleId));
    if (hits.length > 0) counts.set(key(result.filePath), hits.length);
  }
  return { counts, results };
}

const baseline = readBaseline();

// ── One file: the edit-time ratchet ──────────────────────────────────────────
if (FILE_AT !== -1) {
  const target = process.argv[FILE_AT + 1];
  if (!target || !existsSync(target)) process.exit(0);

  const relPath = key(target);
  const { counts, results } = await countWarnings([target]);
  const now = counts.get(relPath) ?? 0;
  const was = baseline.get(relPath) ?? 0;

  if (now <= was) {
    if (now < was) {
      console.log(
        `✅  ${relPath}: react-hooks warnings ${was} → ${now}. Record it: ` +
          'node scripts/check-react-hooks-ratchet.mjs --update',
      );
    }
    process.exit(0);
  }

  const detail = results
    .flatMap((result) => result.messages.filter((m) => m.ruleId && RULES.includes(m.ruleId)))
    .map((m) => `    - ${relPath}:${m.line}  ${m.ruleId} — ${m.message}`)
    .join('\n');

  console.error(
    `❌  ${relPath} adds react-hooks warnings: ${was} → ${now}.\n\n${detail}\n\n` +
      '   These rules are off in eslint.config.js because ~673 pre-existing sites fire them;\n' +
      '   the ratchet is what keeps that number falling. A file may only get better. Fix the\n' +
      "   new site — or, if this genuinely is the right pattern, say so in the diff and run\n" +
      '   `node scripts/check-react-hooks-ratchet.mjs --update` to move the baseline WITH a reason.\n',
  );
  process.exit(1);
}

// ── Changed files: the wired-in mode ─────────────────────────────────────────
if (CHANGED) {
  const targets = changedSourceFiles();
  if (targets.length === 0) {
    console.log('✅  React-hooks ratchet — no component under src/ changed on this branch.');
    process.exit(0);
  }

  const { counts } = await countWarnings(targets);
  const worse = targets
    .map((file) => key(file))
    .map((relPath) => ({ relPath, now: counts.get(relPath) ?? 0, was: baseline.get(relPath) ?? 0 }))
    .filter(({ now, was }) => now > was);

  if (worse.length > 0) {
    console.error(`❌  ${worse.length} changed file(s) gained react-hooks warnings:\n`);
    for (const { relPath, was, now } of worse) console.error(`  - ${relPath}: ${was} → ${now}`);
    console.error(
      '\n   These rules are off in eslint.config.js because of ~673 pre-existing sites; the\n' +
        '   ratchet is what keeps that number falling rather than frozen. A file may only get\n' +
        '   better. See the sites with:\n' +
        `     node scripts/check-react-hooks-ratchet.mjs --file ${worse[0].relPath}\n`,
    );
    process.exit(1);
  }

  // A file that improved must be recorded, or the next change to it can silently
  // give the warnings back.
  const improved = targets
    .map((file) => key(file))
    .map((relPath) => ({ relPath, now: counts.get(relPath) ?? 0, was: baseline.get(relPath) ?? 0 }))
    .filter(({ now, was }) => now < was);
  if (improved.length > 0) {
    console.error(`✅→❌  ${improved.length} changed file(s) improved — record it so the ratchet holds:\n`);
    for (const { relPath, was, now } of improved) console.error(`  - ${relPath}: ${was} → ${now}`);
    console.error('\n   Run: node scripts/check-react-hooks-ratchet.mjs --update\n');
    process.exit(1);
  }

  console.log(`✅  React-hooks ratchet OK — ${targets.length} changed file(s) checked, none of them worse.`);
  process.exit(0);
}

// ── Full sweep ───────────────────────────────────────────────────────────────
const { counts } = await countWarnings(['src/**/*.{ts,tsx}']);

if (UPDATE) {
  const header =
    '# React-hooks warnings per file, for the rules eslint.config.js turns off.\n' +
    '# This list may only SHRINK — see scripts/check-react-hooks-ratchet.mjs.\n' +
    '# Regenerate with: node scripts/check-react-hooks-ratchet.mjs --update\n';
  const body = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, n]) => `${file} ${n}`);
  writeFileSync(baselineFile, header + body.join('\n') + (body.length ? '\n' : ''), 'utf8');
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  console.log(`📝  Baseline written: ${counts.size} file(s), ${total} warning(s).`);
  process.exit(0);
}

const worse = [...counts.entries()].filter(([file, n]) => n > (baseline.get(file) ?? 0));
const stale = [...baseline.entries()].filter(([file, n]) => (counts.get(file) ?? 0) < n);

if (worse.length > 0) {
  console.error(`❌  ${worse.length} file(s) gained react-hooks warnings:\n`);
  for (const [file, n] of worse) console.error(`  - ${file}: ${baseline.get(file) ?? 0} → ${n}`);
  console.error('\n   A file may only get better. Fix the new sites.\n');
  process.exit(1);
}

if (stale.length > 0) {
  console.error(`✅→❌  ${stale.length} baseline entr(ies) are now too high — record the win so the ratchet holds:\n`);
  for (const [file, n] of stale) console.error(`  - ${file}: ${n} → ${counts.get(file) ?? 0}`);
  console.error('\n   Run: node scripts/check-react-hooks-ratchet.mjs --update\n');
  process.exit(1);
}

const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
console.log(`✅  React-hooks ratchet OK — ${counts.size} file(s) carry ${total} warning(s), none of them new.`);
