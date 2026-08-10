#!/usr/bin/env node
/** Read-only preflight for the BurnRateOS account → tenant → company plan. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { readBurnrateCutoverPolicy, validateBurnrateCutoverPolicy } from './check-burnrate-cutover-policy.mjs';

const argv = process.argv.slice(2);
const args = new Set(argv);
const flag = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : null; };
const accountMapPath = flag('--account-map');
const outputPath = flag('--output');
const validateOnly = args.has('--validate-only');
const strict = args.has('--strict');

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

function readAccountMap(path) {
  if (!path) return [];
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : parsed.accounts;
  if (!Array.isArray(rows)) throw new Error('Account map must be an array or {"accounts": [...]}');
  return rows.map((row, index) => {
    const sourceAccountId = String(row?.sourceAccountId ?? '').trim();
    const tenantId = Number(row?.tenantId);
    if (!sourceAccountId || !Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error(`Invalid account map row ${index + 1}`);
    return { sourceAccountId, tenantId };
  });
}

const policy = readBurnrateCutoverPolicy();
const policyErrors = validateBurnrateCutoverPolicy(policy);
const accountMap = readAccountMap(accountMapPath);
const duplicateAccounts = [...new Set(accountMap.filter((row, index) => accountMap.findIndex((candidate) => candidate.sourceAccountId === row.sourceAccountId && candidate.tenantId !== row.tenantId) !== -1).map((row) => row.sourceAccountId))];
if (policyErrors.length || duplicateAccounts.length) {
  console.error(`❌ Tenant mapping contract invalid: ${[...policyErrors, ...duplicateAccounts.map((id) => `conflicting tenant mappings for ${id}`)].join('; ')}`);
  process.exit(1);
}
if (validateOnly) {
  console.log(`✅ BurnRateOS tenancy audit contract valid — existing segments/companies/objects/relations only; ${accountMap.length} supplied account mappings.`);
  process.exit(0);
}
if (!accountMap.length) {
  console.error('❌ Supply --account-map <json> from the identity dry run. No account is assigned heuristically.');
  process.exit(2);
}

loadDotEnv(resolve('api', '.env'));
loadDotEnv(resolve('.env'));
const sourceUrl = process.env.BURNRATE_SOURCE_DATABASE_URL;
const targetUrl = process.env.NEON_DATABASE_URL;
if (!sourceUrl || !targetUrl) {
  console.error('❌ Set BURNRATE_SOURCE_DATABASE_URL and NEON_DATABASE_URL; both credentials must be read-only.');
  process.exit(2);
}

const source = neon(sourceUrl);
const target = neon(targetUrl);
const [sourceAccounts, sourceCompanies, sourceRelationships, targetTenants, targetSegments] = await Promise.all([
  source('SELECT id FROM accounts'),
  source('SELECT id, "accountId" AS account_id, name, slug FROM companies'),
  source('SELECT id, "accountId" AS account_id, "companyId" AS company_id, kind, status, "isPrimary" AS is_primary FROM account_company_relationships'),
  target('SELECT id FROM tenants WHERE id = ANY($1::int[])', [[...new Set(accountMap.map((row) => row.tenantId))]]),
  target('SELECT tenant_id, external_account_id, external_company_id FROM segments WHERE external_account_id = ANY($1::text[])', [[...new Set(accountMap.map((row) => row.sourceAccountId))]]),
]);

const sourceAccountIds = new Set(sourceAccounts.map((row) => String(row.id)));
const targetTenantIds = new Set(targetTenants.map((row) => Number(row.id)));
const tenantByAccount = new Map(accountMap.map((row) => [row.sourceAccountId, row.tenantId]));
const companyById = new Map(sourceCompanies.map((row) => [String(row.id), row]));
const active = sourceRelationships.filter((row) => String(row.status ?? 'ACTIVE') === 'ACTIVE');
const relationshipsByPair = new Map();
for (const relationship of active) {
  const key = `${relationship.account_id}:${relationship.company_id}`;
  relationshipsByPair.set(key, [...(relationshipsByPair.get(key) ?? []), relationship]);
}
const mapped = active.filter((row) => tenantByAccount.has(String(row.account_id)) && companyById.has(String(row.company_id)));
const assignments = mapped.map((row) => ({
  tenantId: tenantByAccount.get(String(row.account_id)), sourceAccountId: String(row.account_id), sourceCompanyId: String(row.company_id), relationshipKind: String(row.kind),
}));
const assignmentKeys = new Set(assignments.map((row) => `${row.tenantId}:${row.sourceCompanyId}`));
const existingSegmentKeys = new Set(targetSegments.map((row) => `${Number(row.tenant_id)}:${String(row.external_account_id)}:${String(row.external_company_id)}`));
const ownerByCompany = new Map();
for (const row of mapped.filter((relationship) => String(relationship.kind) === 'OWNER')) ownerByCompany.set(String(row.company_id), [...(ownerByCompany.get(String(row.company_id)) ?? []), row]);
const primaryByAccount = new Map();
for (const row of mapped.filter((relationship) => String(relationship.kind) === 'OWNER' && relationship.is_primary === true)) primaryByAccount.set(String(row.account_id), [...(primaryByAccount.get(String(row.account_id)) ?? []), String(row.company_id)]);

const blockers = [
  ...accountMap.filter((row) => !sourceAccountIds.has(row.sourceAccountId)).map((row) => ({ code: 'unknown_source_account', sourceRef: row.sourceAccountId })),
  ...accountMap.filter((row) => !targetTenantIds.has(row.tenantId)).map((row) => ({ code: 'unknown_target_tenant', sourceRef: String(row.tenantId) })),
  ...active.filter((row) => !tenantByAccount.has(String(row.account_id))).map((row) => ({ code: 'unmapped_relationship_account', sourceRef: String(row.id) })),
  ...sourceCompanies.filter((company) => company.account_id && tenantByAccount.has(String(company.account_id)) && !(relationshipsByPair.get(`${company.account_id}:${company.id}`)?.length)).map((company) => ({ code: 'missing_active_relationship', sourceRef: String(company.id) })),
  ...[...ownerByCompany].filter(([, rows]) => rows.length > 1).map(([companyId, rows]) => ({ code: 'ambiguous_company_owner', sourceRef: companyId, owners: rows.map((row) => String(row.account_id)) })),
  ...[...primaryByAccount].filter(([, companyIds]) => new Set(companyIds).size > 1).map(([accountId, companyIds]) => ({ code: 'multiple_primary_companies', sourceRef: accountId, companyIds })),
];
const report = {
  generatedAt: new Date().toISOString(), policyVersion: policy.version,
  mappingRule: 'account→tenant is explicit; account+company requires an active relationship; company-only rows require exactly one mapped active OWNER; project↔company uses kernel relations; primary company selects project segment',
  existingTargetShapes: ['segments', 'companies', 'objects', 'relations'], newTables: [],
  summary: {
    mappedAccounts: accountMap.length, sourceCompanies: sourceCompanies.length, activeRelationships: active.length,
    companyAssignments: assignmentKeys.size, existingSegments: existingSegmentKeys.size,
    segmentsToCreateDuringETL: [...new Set(assignments.map((row) => `${row.tenantId}:${row.sourceAccountId}:${row.sourceCompanyId}`))].filter((key) => !existingSegmentKeys.has(key)).length,
    unclaimedCompanies: sourceCompanies.filter((company) => !assignments.some((row) => row.sourceCompanyId === String(company.id))).length,
    blockers: blockers.length,
  },
  blockers, assignments,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  writeFileSync(resolve(outputPath), json, { encoding: 'utf8', flag: 'wx' });
  console.log(`Wrote immutable tenancy audit to ${resolve(outputPath)}`);
} else process.stdout.write(json);
if (strict && blockers.length) process.exit(1);
