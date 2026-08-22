/**
 * The ONE ratchet mechanism the data-model guards share (PRD 20 §5 Step 0).
 *
 * Six guards land against a schema that already violates all six. A guard that
 * fails on day one gets `|| true`'d into decoration within a week, so each one
 * ships with a BASELINE of what it found when it was written, and fails only on
 * something NEW. The baseline can shrink and never grow — which is what turns
 * "we should clean this up" into a number that goes down.
 *
 * `check-tenant-scope.mjs` and `check-migrations.mjs` already work this way; this
 * is that pattern extracted so six more guards do not each reinvent the file
 * format, the `--update` flag, and the stale-entry reporting.
 *
 * Baseline files live beside the scripts as `.<name>-baseline.txt`: one key per
 * line, `#` comments and blank lines ignored, sorted so a diff is readable.
 *
 * A baseline entry is OUTSTANDING WORK. An entry that was examined and accepted
 * is a different thing and lives somewhere else — see `./adjudications.mjs`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadAdjudications } from './adjudications.mjs';

/** Parse a baseline file into a Set of keys. Missing file → empty set. */
export function readBaseline(path) {
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
}

/**
 * Compare findings against the baseline and exit.
 *
 * @param {object} o
 * @param {string} o.name        Guard name, for the output line.
 * @param {string} o.baselinePath
 * @param {Array<{key: string, detail?: string}>} o.findings  Everything found NOW.
 * @param {string} o.unit        Plural noun for the count ("duplicate clusters").
 * @param {string} o.header      One line written to the top of a generated baseline.
 * @param {string} o.fixHint     What to do about a NEW finding.
 * @param {boolean} o.update     `--update` was passed: rewrite the baseline.
 * @returns {never}
 *
 * Findings that `scripts/adjudications/<guard>.mjs` holds a verdict for are
 * removed before anything else happens. They are reported separately, because
 * "decided" and "outstanding" are not the same number and a baseline that mixes
 * them cannot be read as a balance.
 */
export async function reportRatchet({ name, baselinePath, findings, unit, header, fixHint, update }) {
  const adjudicated = await loadAdjudications(name);
  const seen = new Map(
    findings.filter((f) => !adjudicated.has(f.key)).map((f) => [f.key, f.detail ?? '']),
  );
  const baseline = readBaseline(baselinePath);
  const slug = name.replace(/^check-/, '');

  // A verdict that no longer answers any finding is a reason nobody needs — the
  // table was renamed, dropped, or migrated away. Reported so the registry cannot
  // rot into a list of arguments about things that stopped existing.
  const foundKeys = new Set(findings.map((f) => f.key));
  const orphanedVerdicts = [...adjudicated.keys()].filter((k) => !foundKeys.has(k)).sort();

  // An entry cannot be both decided and outstanding. Carried in both places, the
  // baseline double-counts settled work — the exact arithmetic this exists to end.
  const doubleCounted = [...adjudicated.keys()].filter((k) => baseline.has(k)).sort();
  if (doubleCounted.length && !update) {
    console.error(`❌  ${name}: ${doubleCounted.length} adjudicated entr${doubleCounted.length === 1 ? 'y is' : 'ies are'} still in the baseline.\n`);
    for (const k of doubleCounted) console.error(`    ${k}`);
    console.error(
      `\n    An adjudicated entry is finished work and must not also be carried as an open\n` +
        `    balance. Run \`node scripts/${name}.mjs --update\` to drop it from the baseline.`,
    );
    process.exit(1);
  }

  if (update) {
    const body = [...seen.keys()].sort();
    const decided = adjudicated.size ? ` (+ ${adjudicated.size} adjudicated, deliberately not listed here)` : '';
    writeFileSync(
      baselinePath,
      `# ${header}\n` +
        `# Regenerate: node scripts/${name}.mjs --update\n` +
        `# A VERDICT DOES NOT BELONG HERE — this file is rewritten wholesale, so a '#' comment\n` +
        `# explaining an accepted entry does not survive. Argue it in\n` +
        `# scripts/adjudications/${slug}.mjs instead, where it is data and is counted separately.\n` +
        `${body.join('\n')}\n`,
    );
    console.log(`✍️   ${name}: baseline rewritten — ${body.length} ${unit}${decided}.`);
    process.exit(0);
  }

  const added = [...seen.keys()].filter((k) => !baseline.has(k)).sort();
  const stale = [...baseline].filter((k) => !seen.has(k)).sort();

  if (added.length) {
    console.error(`❌  ${name}: ${added.length} NEW ${unit}.\n`);
    for (const k of added) console.error(`    ${k}${seen.get(k) ? `\n        ${seen.get(k)}` : ''}`);
    console.error(`\n    ${fixHint}`);
    console.error(
      `\n    If it is genuinely intended, either argue it in scripts/adjudications/${slug}.mjs\n` +
        `    (a verdict, with the reason attached) or run \`node scripts/${name}.mjs --update\`\n` +
        `    to carry it as debt — but the baseline is meant to SHRINK. Growing it is a\n` +
        `    decision, not a formality.`,
    );
    process.exit(1);
  }

  // A shrinking baseline is the point, so say so loudly enough that somebody trims it.
  const staleNote = stale.length
    ? ` — ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} now fixed, trim with --update`
    : '';
  const decidedNote = adjudicated.size ? ` · ${adjudicated.size} adjudicated` : '';
  console.log(`✅  ${name} OK — ${seen.size} known ${unit}${decidedNote}; 0 new${staleNote}.`);
  if (stale.length) for (const k of stale) console.log(`      fixed: ${k}`);
  if (orphanedVerdicts.length) {
    console.log(`      ⚠️  ${orphanedVerdicts.length} adjudication(s) match no finding — trim scripts/adjudications/${slug}.mjs:`);
    for (const k of orphanedVerdicts) console.log(`         ${k}`);
  }
  process.exit(0);
}

/** Payload columns — the ones that carry meaning. Every table has the rest. */
export const BOILERPLATE = new Set([
  'id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by',
  'tenant_id', 'account_id', 'segment_id', 'company_id', 'archived_at',
  'is_active', 'is_archived',
]);
