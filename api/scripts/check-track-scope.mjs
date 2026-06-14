#!/usr/bin/env node
/**
 * Isolation-track scope guard (T9 · Platform · DB · CI steward).
 *
 * The README '🧵 Isolation Tracks' table assigns each parallel agent a set of
 * `owns` paths + a reserved migration band so file-disjoint branches never collide.
 * Until now that was honor-system only. This guard makes it ENFORCEABLE: given a
 * `track/<id>` branch, it rejects any changed file outside the track's owns globs
 * (minus excludes) + the shared hubs, and any NEW migration number outside the
 * track's band. Reads the machine-readable manifest .github/isolation-tracks.json
 * (canonical — the README table renders from it) so guard and docs never drift.
 *
 * Usage:
 *   node scripts/check-track-scope.mjs                 # auto: branch + git diff vs main
 *   node scripts/check-track-scope.mjs --track T3      # force a track id
 *   node scripts/check-track-scope.mjs --base origin/main
 *   node scripts/check-track-scope.mjs --files "a.ts b.ts"   # explicit file list
 *
 * Exit 0 = in scope; exit 1 = violation; exit 0 + skip note = not a track/<id>
 * branch (nothing to enforce).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repoRoot = resolve(here, '../..');
const manifestFile = resolve(repoRoot, '.github/isolation-tracks.json');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// ── glob → RegExp ────────────────────────────────────────────────────────────
// `**` = any segments, `*` = within one segment, `?` = one char. Every other char
// is literal — crucially `[` `]` are literal (Next.js route dirs marketplace/[slug]).
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$');
}

const matchesAny = (file, globs) => globs.some((g) => globToRegExp(g).test(file));

// ── load manifest ────────────────────────────────────────────────────────────
if (!existsSync(manifestFile)) {
  console.error(`❌  Track manifest not found: ${manifestFile}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const sharedHubs = manifest.sharedHubs || [];

// ── resolve track id ─────────────────────────────────────────────────────────
let branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
// In a GitHub PR the checked-out ref is a detached merge commit; prefer the head ref.
if ((!branch || branch === 'HEAD') && process.env.GITHUB_HEAD_REF) branch = process.env.GITHUB_HEAD_REF;

let trackId = arg('--track');
if (!trackId) {
  const m = /(?:^|\/)track\/([A-Za-z0-9]+)$/.exec(branch) || /^track\/([A-Za-z0-9]+)$/.exec(branch);
  if (m) trackId = m[1];
}

if (!trackId) {
  console.log(`ℹ️  Branch "${branch || '(unknown)'}" is not a track/<id> branch — no track scope to enforce.`);
  process.exit(0);
}

const track = manifest.tracks.find((t) => t.id.toLowerCase() === trackId.toLowerCase());
if (!track) {
  console.error(`❌  Unknown track "${trackId}" — not in ${manifestFile}.`);
  process.exit(1);
}

// ── collect changed files ────────────────────────────────────────────────────
const base = arg('--base') || (git(['rev-parse', '--verify', 'origin/main']) ? 'origin/main' : 'main');
const parseNameStatus = (out) =>
  out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0][0]; // A/M/D/R…
      const file = parts[parts.length - 1]; // rename → dest path
      return { status, file };
    });

let changed; // [{ status, file }]
const filesArg = arg('--files');
if (filesArg) {
  changed = filesArg.split(/\s+/).filter(Boolean).map((file) => ({ status: 'M', file }));
} else if (process.argv.includes('--staged')) {
  // Pre-commit mode: enforce against what is about to be committed.
  changed = parseNameStatus(git(['diff', '--cached', '--name-status']));
} else {
  changed = parseNameStatus(git(['diff', '--name-status', `${base}...HEAD`]));
}

if (changed.length === 0) {
  console.log(`✅  Track ${track.id} (${track.name}): no changed files vs ${base}.`);
  process.exit(0);
}

// ── migration band helpers ───────────────────────────────────────────────────
const reservedByOthers = manifest.tracks
  .filter((t) => t.id !== track.id && Array.isArray(t.migrationBand))
  .map((t) => t.migrationBand);

const inBand = (n, band) => band && n >= band[0] && (band[1] == null || n <= band[1]);
const inAnyReserved = (n) => reservedByOthers.some((b) => inBand(n, b));

function migrationViolation(file, status) {
  const m = /^api\/migrations\/(\d+)/.exec(file);
  if (!m) return null; // not a migration
  const num = parseInt(m[1], 10);
  const isNew = status === 'A' || status === 'R';
  if (isNew) {
    // Adding a brand-new migration: number must be in this track's band.
    if (track.steward) {
      // Steward issues out-of-band singles too — just never grab another band.
      if (inAnyReserved(num)) return `new migration ${m[1]} falls inside another track's reserved band`;
      return null;
    }
    if (!track.migrationBand) return `track ${track.id} has no migration band — it may not add migrations (got ${m[1]})`;
    if (!inBand(num, track.migrationBand)) {
      return `new migration ${m[1]} is outside track ${track.id}'s band [${track.migrationBand[0]}-${track.migrationBand[1] ?? '∞'}]`;
    }
    return null;
  }
  // Modifying/deleting an EXISTING migration is steward-only (T9 owns the dir).
  if (!track.steward) return `modifying an existing migration is T9-steward-only`;
  return null;
}

// ── evaluate every changed file ──────────────────────────────────────────────
const violations = [];
for (const { status, file } of changed) {
  if (matchesAny(file, sharedHubs)) continue; // append-only shared hubs: allowed for all

  if (file.startsWith('api/migrations/')) {
    const v = migrationViolation(file, status);
    if (v) violations.push({ file, reason: v });
    continue; // migrations governed solely by the band rule above
  }

  const owned = matchesAny(file, track.owns) && !matchesAny(file, track.excludes || []);
  if (!owned) violations.push({ file, reason: `outside track ${track.id} (${track.name}) owns paths` });
}

if (violations.length > 0) {
  console.error(`❌  Track ${track.id} (${track.name}) scope violations (${violations.length}):\n`);
  for (const { file, reason } of violations) console.error(`   ${file}\n      → ${reason}`);
  console.error(
    `\n   A track/${track.id} branch may edit only its owns paths + shared hubs\n` +
      `   (${sharedHubs.join(', ')}), and add migrations only in its band. Move\n` +
      `   out-of-scope work to the owning track's branch, or update\n` +
      `   .github/isolation-tracks.json if the ownership boundary genuinely changed.`,
  );
  process.exit(1);
}

console.log(`✅  Track ${track.id} (${track.name}): all ${changed.length} changed file(s) in scope (vs ${base}).`);
