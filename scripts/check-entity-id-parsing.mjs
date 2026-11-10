#!/usr/bin/env node
/**
 * Entity-id parsing guard (docs/design/typed-entity-ids.md §8).
 *
 * Every UUID check and every whole-string integer id parse goes through ONE primitive,
 * `packages/local-first/src/entityId.ts` (`isLocalId`, `parseSyncId`, `parseEntityRef`, `isIntegerIdText`). This fails on:
 *
 *   - a UUID regex literal (`[0-9a-f]{8}-…`), and
 *   - a whole-string integer parse (`/^\d+$/`, `/^[1-9]\d*$/`, `/^-?\d+$/`, `/^[0-9]+$/`)
 *
 * in non-test source under packages/local-first/src, api/src/application/sync, clients/vscode/src, clients/chrome/src and
 * brain-embedded/src, and on a UUID regex anywhere else in api/src. What is held where lives in scripts/lib/entityIdParsing.mjs.
 *
 * Sites that are NOT entity ids (a git SHA, a version, a TOML key) and the api's non-sync UUID sweep (§7, its own DRY entry)
 * are listed, each with a reason, in scripts/entity-id-parsing.allowlist.mjs. An entry that no longer matches anything fails
 * too, so the list shrinks as sites move onto the primitive. Tests (`*.test.*`, `__fixtures__`) are exempt by rule.
 *
 * Files are enumerated with `git ls-files --cached --others --exclude-standard` (falling back to a filesystem walk).
 * Run from anywhere; it derives the repo root from its own location.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SKIP_DIRS } from './lib/skipDirs.mjs';
import { SCOPED, UUID_ONLY, applyAllowlist, findViolations, kindsFor } from './lib/entityIdParsing.mjs';
import { ALLOWLIST } from './entity-id-parsing.allowlist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = [...SCOPED, ...UUID_ONLY].map((p) => p.replace(/\/$/, ''));

function gitFiles() {
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...ROOTS], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return undefined;
  return r.stdout.split('\n').filter(Boolean);
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; } // a scoped root may not exist in a partial checkout
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield path.relative(root, full).split(path.sep).join('/');
    }
  }
}

const files = (gitFiles() ?? ROOTS.flatMap((r) => [...walk(path.join(root, r))])).filter((rel) => kindsFor(rel).length > 0);

const findings = [];
for (const rel of files) {
  let text;
  try { text = readFileSync(path.join(root, rel), 'utf8'); } catch { continue; } // deleted but still indexed
  findings.push(...findViolations(rel, text));
}

const { violations, stale } = applyAllowlist(findings, ALLOWLIST);

if (violations.length > 0 || stale.length > 0) {
  if (violations.length > 0) {
    console.error(`Entity-id parsing: ${violations.length} id regex(es) outside entityId.ts.\n`);
    for (const v of violations) console.error(`  - ${v.file}:${v.line} [${v.kind}] ${v.text}`);
    console.error(
      '\nUse the primitive in packages/local-first/src/entityId.ts (via "@builderforce/local-first"): isLocalId for a UUID,\n' +
        'parseSyncId for a server id (number or decimal text), parseEntityRef for an id of unknown shape, isIntegerIdText for\n' +
        '"is this integer text". If the regex is not about an entity id, list it in scripts/entity-id-parsing.allowlist.mjs with a reason.',
    );
  }
  if (stale.length > 0) {
    console.error(`\nEntity-id parsing: ${stale.length} allowlist entr(ies) match nothing — remove them from scripts/entity-id-parsing.allowlist.mjs:`);
    for (const e of stale) console.error(`  - ${e.file} [${e.kind}]`);
  }
  process.exit(1);
}
console.log(`Entity-id parsing: ok (${files.length} files, ${findings.length} allowlisted site(s)).`);
