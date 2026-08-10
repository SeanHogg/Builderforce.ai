/**
 * BurnRateOS tenant/company cutover mapping.
 *
 * This is deliberately a pure planner. It emits coordinates for the existing
 * Builderforce `segments`, tenant-scoped `companies`, registered `objects` and
 * kernel `relations`; it performs no writes and requires no migration table.
 * The caller persists the accepted plan only after the read-only audit is clean.
 */

export const BURNRATE_RELATIONSHIP_KINDS = [
  'OWNER', 'CUSTOMER', 'PROSPECT', 'INVESTOR_TARGET', 'PORTFOLIO_COMPANY',
  'PARTNER', 'COMPETITOR', 'VENDOR', 'OTHER',
] as const;

export type BurnrateRelationshipKind = (typeof BURNRATE_RELATIONSHIP_KINDS)[number];

export interface BurnrateAccountTenantMapping {
  sourceAccountId: string;
  tenantId: number;
}

export interface BurnrateCompanySource {
  id: string;
  accountId?: string | null;
  name: string;
  slug: string;
  website?: string | null;
  industry?: string | null;
  stage?: string | null;
  attrs?: Record<string, unknown> | null;
}

export interface BurnrateCompanyRelationshipSource {
  id: string;
  accountId: string;
  companyId: string;
  kind: string;
  status?: string | null;
  isPrimary?: boolean | null;
  source?: string | null;
  claimedByUserId?: string | null;
  claimVerificationMethod?: string | null;
  claimVerifiedAt?: string | null;
}

export interface BurnrateProjectCompanySource {
  projectId: string;
  accountId: string;
  companyIds: string[];
}

export interface BurnrateMappingIssue {
  severity: 'blocker' | 'warning';
  code: string;
  sourceRef: string;
  detail: string;
}

export interface BurnrateCompanyTarget {
  key: string;
  tenantId: number;
  sourceAccountId: string;
  sourceCompanyId: string;
  name: string;
  slug: string;
  website: string | null;
  sector: string | null;
  stage: string | null;
  isPortfolio: boolean;
  relationshipKinds: BurnrateRelationshipKind[];
  segment: {
    externalAccountId: string;
    externalCompanyId: string;
    displayName: string;
    slug: string;
  };
  attrs: Record<string, unknown>;
}

export interface BurnrateProjectTarget {
  sourceProjectId: string;
  tenantId: number;
  sourceAccountId: string;
  primaryCompanyKey: string | null;
  companyKeys: string[];
  /** Persist after the project and companies have registered `objects` rows. */
  relations: Array<{ from: `project:${string}`; to: `company:${string}`; kind: 'associated_with' }>;
}

export interface BurnrateTenantCompanyPlan {
  companies: BurnrateCompanyTarget[];
  projects: BurnrateProjectTarget[];
  unclaimedCompanyIds: string[];
  issues: BurnrateMappingIssue[];
  summary: {
    sourceCompanies: number;
    mappedCompanyCopies: number;
    mappedProjects: number;
    unclaimedCompanies: number;
    blockers: number;
    warnings: number;
  };
}

export type BurnrateRowCoordinates = {
  sourceRef: string;
  accountId?: string | null;
  companyId?: string | null;
  allowGlobal?: boolean;
};

export type BurnrateRowResolution =
  | { ok: true; tenantId: number | null; sourceAccountId: string | null; sourceCompanyId: string | null; companyKey: string | null; global: boolean }
  | { ok: false; code: 'unknown_account' | 'unknown_company' | 'account_company_mismatch' | 'ambiguous_company_owner' | 'unscoped_row'; detail: string };

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function segmentSlug(accountId: string, companyId: string): string {
  const safe = `${accountId}-${companyId}`.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (safe || 'burnrate-company').slice(0, 255);
}

function targetKey(tenantId: number, companyId: string): string {
  return `${tenantId}:${companyId}`;
}

export function createBurnrateRowResolver(input: {
  accountTenants: readonly BurnrateAccountTenantMapping[];
  companies: readonly BurnrateCompanySource[];
  relationships: readonly BurnrateCompanyRelationshipSource[];
}) {
  const tenantByAccount = new Map(input.accountTenants.map((row) => [row.sourceAccountId, row.tenantId]));
  const companyIds = new Set(input.companies.map((company) => company.id));
  const activeRelationships = input.relationships.filter((row) => (row.status ?? 'ACTIVE') === 'ACTIVE' && tenantByAccount.has(row.accountId));
  const relationshipsByPair = new Map<string, BurnrateCompanyRelationshipSource[]>();
  const ownersByCompany = new Map<string, BurnrateCompanyRelationshipSource[]>();
  for (const relationship of activeRelationships) {
    const pair = `${relationship.accountId}:${relationship.companyId}`;
    relationshipsByPair.set(pair, [...(relationshipsByPair.get(pair) ?? []), relationship]);
    if (relationship.kind === 'OWNER') ownersByCompany.set(relationship.companyId, [...(ownersByCompany.get(relationship.companyId) ?? []), relationship]);
  }

  return (row: BurnrateRowCoordinates): BurnrateRowResolution => {
    const accountId = row.accountId?.trim() || null;
    const companyId = row.companyId?.trim() || null;
    if (companyId && !companyIds.has(companyId)) return { ok: false, code: 'unknown_company', detail: `${row.sourceRef} references unknown company ${companyId}.` };
    if (accountId) {
      const tenantId = tenantByAccount.get(accountId);
      if (tenantId == null) return { ok: false, code: 'unknown_account', detail: `${row.sourceRef} references account ${accountId} without a tenant mapping.` };
      if (companyId && !(relationshipsByPair.get(`${accountId}:${companyId}`)?.length)) {
        return { ok: false, code: 'account_company_mismatch', detail: `${row.sourceRef} has account ${accountId} and company ${companyId}, but no active relationship authorizes that pair.` };
      }
      return { ok: true, tenantId, sourceAccountId: accountId, sourceCompanyId: companyId, companyKey: companyId ? targetKey(tenantId, companyId) : null, global: false };
    }
    if (companyId) {
      const owners = ownersByCompany.get(companyId) ?? [];
      if (owners.length !== 1) return { ok: false, code: 'ambiguous_company_owner', detail: `${row.sourceRef} has company ${companyId} without an account and resolves to ${owners.length} active mapped OWNER relationships; exactly one is required.` };
      const owner = owners[0]!;
      const tenantId = tenantByAccount.get(owner.accountId)!;
      return { ok: true, tenantId, sourceAccountId: owner.accountId, sourceCompanyId: companyId, companyKey: targetKey(tenantId, companyId), global: false };
    }
    if (row.allowGlobal) return { ok: true, tenantId: null, sourceAccountId: null, sourceCompanyId: null, companyKey: null, global: true };
    return { ok: false, code: 'unscoped_row', detail: `${row.sourceRef} has neither account nor company coordinates and is not an approved global record.` };
  };
}

export function planBurnrateTenantCompanyMapping(input: {
  accountTenants: readonly BurnrateAccountTenantMapping[];
  companies: readonly BurnrateCompanySource[];
  relationships: readonly BurnrateCompanyRelationshipSource[];
  projects?: readonly BurnrateProjectCompanySource[];
}): BurnrateTenantCompanyPlan {
  const issues: BurnrateMappingIssue[] = [];
  const tenantByAccount = new Map<string, number>();
  for (const mapping of input.accountTenants) {
    const prior = tenantByAccount.get(mapping.sourceAccountId);
    if (prior != null && prior !== mapping.tenantId) issues.push({ severity: 'blocker', code: 'duplicate_account_mapping', sourceRef: mapping.sourceAccountId, detail: `Account maps to both tenant ${prior} and tenant ${mapping.tenantId}.` });
    else tenantByAccount.set(mapping.sourceAccountId, mapping.tenantId);
  }
  const companyById = new Map(input.companies.map((company) => [company.id, company]));
  const active = input.relationships.filter((relationship) => (relationship.status ?? 'ACTIVE') === 'ACTIVE');
  const grouped = new Map<string, BurnrateCompanyRelationshipSource[]>();
  for (const relationship of active) {
    if (!companyById.has(relationship.companyId)) {
      issues.push({ severity: 'blocker', code: 'unknown_company', sourceRef: relationship.id, detail: `Relationship references missing company ${relationship.companyId}.` });
      continue;
    }
    const tenantId = tenantByAccount.get(relationship.accountId);
    if (tenantId == null) {
      issues.push({ severity: 'blocker', code: 'unknown_account', sourceRef: relationship.id, detail: `Relationship account ${relationship.accountId} has no approved tenant mapping.` });
      continue;
    }
    if (!(BURNRATE_RELATIONSHIP_KINDS as readonly string[]).includes(relationship.kind)) {
      issues.push({ severity: 'blocker', code: 'invalid_relationship_kind', sourceRef: relationship.id, detail: `Unsupported relationship kind ${relationship.kind}.` });
      continue;
    }
    const key = targetKey(tenantId, relationship.companyId);
    grouped.set(key, [...(grouped.get(key) ?? []), relationship]);
  }

  const companies: BurnrateCompanyTarget[] = [];
  for (const [key, relationships] of grouped) {
    const first = relationships[0]!;
    const tenantId = tenantByAccount.get(first.accountId)!;
    const company = companyById.get(first.companyId)!;
    const kinds = [...new Set(relationships.map((relationship) => relationship.kind as BurnrateRelationshipKind))].sort();
    companies.push({
      key, tenantId, sourceAccountId: first.accountId, sourceCompanyId: company.id,
      name: company.name.trim(), slug: company.slug.trim(), website: company.website ?? null,
      sector: company.industry ?? null, stage: company.stage ?? null,
      isPortfolio: kinds.includes('PORTFOLIO_COMPANY'), relationshipKinds: kinds,
      segment: { externalAccountId: first.accountId, externalCompanyId: company.id, displayName: company.name.trim(), slug: segmentSlug(first.accountId, company.id) },
      attrs: {
        ...(company.attrs ?? {}),
        burnrate: {
          sourceCompanyId: company.id,
          sourceAccountId: first.accountId,
          relationshipKinds: kinds,
          relationships: relationships.map((relationship) => ({
            sourceId: relationship.id, kind: relationship.kind, isPrimary: relationship.isPrimary === true,
            source: relationship.source ?? null, claimedByUserId: relationship.claimedByUserId ?? null,
            claimVerificationMethod: relationship.claimVerificationMethod ?? null,
            claimVerifiedAt: relationship.claimVerifiedAt ?? null,
          })),
        },
      },
    });
  }
  companies.sort((left, right) => left.tenantId - right.tenantId || left.sourceCompanyId.localeCompare(right.sourceCompanyId));

  const companyKeys = new Set(companies.map((company) => company.key));
  const primaryByAccount = new Map<string, string[]>();
  for (const relationship of active.filter((row) => row.isPrimary === true && row.kind === 'OWNER')) {
    if (!tenantByAccount.has(relationship.accountId)) continue;
    primaryByAccount.set(relationship.accountId, [...(primaryByAccount.get(relationship.accountId) ?? []), targetKey(tenantByAccount.get(relationship.accountId)!, relationship.companyId)]);
  }
  for (const [accountId, keys] of primaryByAccount) if (new Set(keys).size > 1) issues.push({ severity: 'blocker', code: 'multiple_primary_companies', sourceRef: accountId, detail: `Account has ${new Set(keys).size} active primary OWNER companies.` });

  const projects: BurnrateProjectTarget[] = [];
  for (const project of input.projects ?? []) {
    const tenantId = tenantByAccount.get(project.accountId);
    if (tenantId == null) {
      issues.push({ severity: 'blocker', code: 'unknown_project_account', sourceRef: project.projectId, detail: `Project account ${project.accountId} has no approved tenant mapping.` });
      continue;
    }
    const keys = [...new Set(project.companyIds.map((companyId) => targetKey(tenantId, companyId)))];
    const missing = keys.filter((key) => !companyKeys.has(key));
    if (missing.length) {
      issues.push({ severity: 'blocker', code: 'project_company_mismatch', sourceRef: project.projectId, detail: `Project references companies not authorized for account ${project.accountId}: ${missing.join(', ')}.` });
      continue;
    }
    const primaryCandidates = primaryByAccount.get(project.accountId) ?? [];
    const primaryCompanyKey = primaryCandidates.find((key) => keys.includes(key)) ?? keys[0] ?? null;
    projects.push({
      sourceProjectId: project.projectId, tenantId, sourceAccountId: project.accountId,
      primaryCompanyKey, companyKeys: keys,
      relations: keys.map((key) => ({ from: `project:${project.projectId}`, to: `company:${key}`, kind: 'associated_with' as const })),
    });
  }

  const mappedCompanyIds = new Set(companies.map((company) => company.sourceCompanyId));
  const unclaimedCompanyIds = input.companies.filter((company) => !mappedCompanyIds.has(company.id)).map((company) => company.id).sort();
  for (const company of input.companies) {
    if (company.accountId && tenantByAccount.has(company.accountId) && !companyKeys.has(targetKey(tenantByAccount.get(company.accountId)!, company.id))) {
      issues.push({ severity: 'blocker', code: 'missing_relationship', sourceRef: company.id, detail: `Company.accountId=${company.accountId} is mapped, but no active account-company relationship authorizes import.` });
    }
  }
  const duplicateNames = new Map<string, string[]>();
  for (const company of companies) {
    const key = `${company.tenantId}:${normalized(company.name)}`;
    duplicateNames.set(key, [...(duplicateNames.get(key) ?? []), company.sourceCompanyId]);
  }
  for (const [key, ids] of duplicateNames) if (new Set(ids).size > 1) issues.push({ severity: 'blocker', code: 'duplicate_target_company_name', sourceRef: key, detail: `Target unique name would merge distinct source companies: ${ids.join(', ')}.` });

  return {
    companies, projects, unclaimedCompanyIds, issues,
    summary: {
      sourceCompanies: input.companies.length,
      mappedCompanyCopies: companies.length,
      mappedProjects: projects.length,
      unclaimedCompanies: unclaimedCompanyIds.length,
      blockers: issues.filter((issue) => issue.severity === 'blocker').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
  };
}
