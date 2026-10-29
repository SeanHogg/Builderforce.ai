#!/usr/bin/env node
/**
 * merge-replay-manifest.mjs NEW LIVE OUT [--dry-run]
 *
 * Writes OUT = the NEW replay manifest plus the LIVE manifest's operator-set
 * `pinned` and `channels` (PRD 33 §3.5). `emit-assets` writes only
 * latest/player/pageKit, so without this every release would drop a rollback pin.
 *
 *   - `pinned`: carried only when NEW has none (NEW's own value wins);
 *   - `channels`: merged by name, NEW's entries winning over LIVE's;
 *   - LIVE empty (a first publish): NEW is written unchanged;
 *   - LIVE present but NOT a JSON object (an error page served with a 200, `null`, an
 *     array): refuses — exit 1, nothing written — because publishing NEW over it could
 *     silently drop a pin. Under `--dry-run` it warns and writes NEW unchanged.
 *
 * Called by `cdn-publish.sh`; tested in `replay-sdk/src/mergeReplayManifest.test.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [newPath, livePath, outPath] = args.filter((arg) => !arg.startsWith('--'));
if (!newPath || !livePath || !outPath) {
  console.error('usage: merge-replay-manifest.mjs NEW LIVE OUT [--dry-run]');
  process.exit(2);
}

const next = JSON.parse(readFileSync(newPath, 'utf8'));
const raw = readFileSync(livePath, 'utf8').trim();

let live = {};
if (raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    live = parsed;
  } else if (dryRun) {
    console.error('cdn-publish: live manifest is not a JSON object — dry run, nothing carried forward');
  } else {
    console.error('cdn-publish: live manifest is not a JSON object; refusing to publish over a possible pin');
    process.exit(1);
  }
}

if (live.pinned && !next.pinned) next.pinned = live.pinned;
if (live.channels && typeof live.channels === 'object') next.channels = { ...live.channels, ...(next.channels || {}) };
writeFileSync(outPath, `${JSON.stringify(next, null, 2)}\n`);
