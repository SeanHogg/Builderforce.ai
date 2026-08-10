#!/usr/bin/env node
/**
 * BurnRateOS → Builderforce production reconciliation.
 *
 * Read-only by design. It counts every BurnRateOS table in the committed
 * source-to-target map and compares all one-to-one `keep` targets. Collapsed
 * primitive/merged/session/flatten rows are reported for their transform owner
 * and are not given a dishonest row-equality assertion.
 *
 * Usage:
 *   BURNRATE_SOURCE_DATABASE_URL=postgresql://... \
 *   NEON_DATABASE_URL=postgresql://... \
 *   pnpm audit:burnrate-cutover -- --output ./burnrate-reconciliation.json --strict
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { readBurnrateCutoverPolicy, validateBurnrateCutoverPolicy } from './check-burnrate-cutover-policy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mapPath = resolve(here, '..', '..', 'specs', 'builderforce', 'data-model', 'source-to-target.tsv');
const args = new Set(process.argv.slice(2));
const outputFlag = process.argv.indexOf('--output');
const outputPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : null;
const strict = args.has('--strict');
const validateOnly = args.has('--validate-only');
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const at = text.indexOf('=');
    if (at < 1) continue;
    const key = text.slice(0, at).trim();
    const value = text.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function readMap() {
  const lines = readFileSync(mapPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines.shift();
  if (header !== 'product\tsource_table\tdomain\tmove\ttarget') throw new Error('Unexpected source-to-target map header');
  return lines.map((line, index) => {
    const [product, sourceTable, domain, move, target] = line.split('\t').map((part) => part.trim());
    if (!product || !sourceTable || !domain || !move || !target) throw new Error(`Malformed map row ${index + 2}`);
    return { product, sourceTable, domain, move, target };
  });
}

async function existingTables(sql, names) {
  if (!names.length) return new Set();
  const rows = await sql(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [names],
  );
  return new Set(rows.map((row) => String(row.table_name)));
}

async function countTables(sql, names) {
  const result = new Map();
  for (let start = 0; start < names.length; start += 40) {
    const batch = names.slice(start, start + 40);
    const query = batch.map((name) => `SELECT '${name}' AS table_name, count(*)::bigint AS row_count FROM "${name}"`).join(' UNION ALL ');
    for (const row of await sql(query)) result.set(String(row.table_name), Number(row.row_count));
  }
  return result;
}

function databaseLabel(raw) {
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return 'configured-database';
  }
}

const mapped = readMap();
const policy = readBurnrateCutoverPolicy();
const policyErrors = validateBurnrateCutoverPolicy(policy);
const burnrate = mapped.filter((row) => row.product === 'BR');
const invalidNames = burnrate.filter((row) => !IDENTIFIER.test(row.sourceTable));
const keep = burnrate.filter((row) => row.move === 'keep' && IDENTIFIER.test(row.target));

if (burnrate.length !== 344 || invalidNames.length || keep.length === 0 || policyErrors.length) {
  console.error(`❌ BurnRateOS map/policy validation failed: rows=${burnrate.length}, invalid source names=${invalidNames.length}, keep targets=${keep.length}, policy errors=${policyErrors.length}`);
  if (policyErrors.length) console.error(policyErrors.join('\n'));
  process.exit(1);
}
if (validateOnly) {
  console.log(`✅ BurnRateOS cutover audit map/policy valid — ${burnrate.length} source tables, ${keep.length} one-to-one keep targets, policy v${policy.version}.`);
  process.exit(0);
}

loadDotEnv(resolve(here, '..', '.env'));
const sourceUrl = process.env.BURNRATE_SOURCE_DATABASE_URL;
const targetUrl = process.env.NEON_DATABASE_URL;
if (!sourceUrl || !targetUrl) {
  console.error('❌ Set BURNRATE_SOURCE_DATABASE_URL and NEON_DATABASE_URL to run production reconciliation.');
  process.exit(2);
}

const source = neon(sourceUrl);
const target = neon(targetUrl);
const sourceNames = [...new Set(burnrate.map((row) => row.sourceTable))].sort();
const targetNames = [...new Set(keep.map((row) => row.target))].sort();
const [sourceExisting, targetExisting] = await Promise.all([
  existingTables(source, sourceNames), existingTables(target, targetNames),
]);
const [sourceCounts, targetCounts] = await Promise.all([
  countTables(source, sourceNames.filter((name) => sourceExisting.has(name))),
  countTables(target, targetNames.filter((name) => targetExisting.has(name))),
]);

const tables = burnrate.map((row) => {
  const comparable = row.move === 'keep' && IDENTIFIER.test(row.target);
  const sourceRows = sourceCounts.get(row.sourceTable) ?? null;
  const targetRows = comparable ? targetCounts.get(row.target) ?? null : null;
  return {
    ...row,
    sourceExists: sourceExisting.has(row.sourceTable),
    sourceRows,
    targetExists: comparable ? targetExisting.has(row.target) : null,
    targetRows,
    delta: comparable && sourceRows != null && targetRows != null ? targetRows - sourceRows : null,
    reconciliation: comparable ? 'row_count' : 'transform_required',
  };
});
const comparable = tables.filter((row) => row.reconciliation === 'row_count');
const failures = comparable.filter((row) => !row.sourceExists || !row.targetExists || row.delta !== 0);
const report = {
  generatedAt: new Date().toISOString(),
  source: databaseLabel(sourceUrl),
  target: databaseLabel(targetUrl),
  cutoverPolicy: { version: policy.version, effectiveDate: policy.effectiveDate, newTablesAllowed: policy.newTablesAllowed, capabilities: policy.capabilities, providers: policy.providers },
  summary: {
    mappedSourceTables: tables.length,
    sourceTablesPresent: tables.filter((row) => row.sourceExists).length,
    comparableTables: comparable.length,
    reconciledTables: comparable.length - failures.length,
    failedComparableTables: failures.length,
    transformOwnedTables: tables.length - comparable.length,
    sourceRows: [...sourceCounts.values()].reduce((sum, count) => sum + count, 0),
    comparableTargetRows: [...targetCounts.values()].reduce((sum, count) => sum + count, 0),
  },
  tables,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  writeFileSync(resolve(outputPath), json, { encoding: 'utf8', flag: 'wx' });
  console.log(`Wrote immutable reconciliation report to ${resolve(outputPath)}`);
} else {
  process.stdout.write(json);
}

if (strict && failures.length) {
  console.error(`❌ Cutover reconciliation failed for ${failures.length}/${comparable.length} comparable tables.`);
  process.exit(1);
}
