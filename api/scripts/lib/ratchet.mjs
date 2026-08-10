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
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

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
 */
export function reportRatchet({ name, baselinePath, findings, unit, header, fixHint, update }) {
  const seen = new Map(findings.map((f) => [f.key, f.detail ?? '']));
  const baseline = readBaseline(baselinePath);

  if (update) {
    const body = [...seen.keys()].sort();
    writeFileSync(baselinePath, `# ${header}\n# Regenerate: node scripts/${name}.mjs --update\n${body.join('\n')}\n`);
    console.log(`✍️   ${name}: baseline rewritten — ${body.length} ${unit}.`);
    process.exit(0);
  }

  const added = [...seen.keys()].filter((k) => !baseline.has(k)).sort();
  const stale = [...baseline].filter((k) => !seen.has(k)).sort();

  if (added.length) {
    console.error(`❌  ${name}: ${added.length} NEW ${unit}.\n`);
    for (const k of added) console.error(`    ${k}${seen.get(k) ? `\n        ${seen.get(k)}` : ''}`);
    console.error(`\n    ${fixHint}`);
    console.error(
      `\n    If this is genuinely intended, run \`node scripts/${name}.mjs --update\` — but the\n` +
        `    baseline is meant to SHRINK. Growing it is a decision, not a formality.`,
    );
    process.exit(1);
  }

  // A shrinking baseline is the point, so say so loudly enough that somebody trims it.
  const staleNote = stale.length
    ? ` — ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} now fixed, trim with --update`
    : '';
  console.log(`✅  ${name} OK — ${seen.size} known ${unit}; 0 new${staleNote}.`);
  if (stale.length) for (const k of stale) console.log(`      fixed: ${k}`);
  process.exit(0);
}

/** Payload columns — the ones that carry meaning. Every table has the rest. */
export const BOILERPLATE = new Set([
  'id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by',
  'tenant_id', 'account_id', 'segment_id', 'company_id', 'archived_at',
  'is_active', 'is_archived',
]);
