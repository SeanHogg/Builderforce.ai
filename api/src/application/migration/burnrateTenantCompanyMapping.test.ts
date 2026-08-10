import { describe, expect, it } from 'vitest';
import { createBurnrateRowResolver, planBurnrateTenantCompanyMapping } from './burnrateTenantCompanyMapping';

const accountTenants = [
  { sourceAccountId: 'acct-a', tenantId: 101 },
  { sourceAccountId: 'acct-b', tenantId: 202 },
];
const companies = [
  { id: 'co-a', accountId: 'acct-a', name: 'Acme', slug: 'acme', industry: 'SaaS' },
  { id: 'co-b', accountId: null, name: 'Beta', slug: 'beta' },
  { id: 'co-global', accountId: null, name: 'Unclaimed', slug: 'unclaimed' },
];

describe('BurnRateOS tenant/company mapping', () => {
  it('plans existing segments, tenant company copies, attrs and project relations without schema', () => {
    const plan = planBurnrateTenantCompanyMapping({
      accountTenants,
      companies,
      relationships: [
        { id: 'r1', accountId: 'acct-a', companyId: 'co-a', kind: 'OWNER', isPrimary: true, claimVerifiedAt: '2026-01-01T00:00:00Z' },
        { id: 'r2', accountId: 'acct-a', companyId: 'co-b', kind: 'PROSPECT' },
      ],
      projects: [{ projectId: 'project-1', accountId: 'acct-a', companyIds: ['co-a', 'co-b'] }],
    });

    expect(plan.summary).toEqual({ sourceCompanies: 3, mappedCompanyCopies: 2, mappedProjects: 1, unclaimedCompanies: 1, blockers: 0, warnings: 0 });
    expect(plan.unclaimedCompanyIds).toEqual(['co-global']);
    expect(plan.companies[0]).toMatchObject({
      key: '101:co-a', tenantId: 101, sourceAccountId: 'acct-a', sourceCompanyId: 'co-a',
      relationshipKinds: ['OWNER'], segment: { externalAccountId: 'acct-a', externalCompanyId: 'co-a' },
    });
    expect(plan.projects[0]).toMatchObject({
      tenantId: 101, primaryCompanyKey: '101:co-a', companyKeys: ['101:co-a', '101:co-b'],
      relations: [
        { from: 'project:project-1', to: 'company:101:co-a', kind: 'associated_with' },
        { from: 'project:project-1', to: 'company:101:co-b', kind: 'associated_with' },
      ],
    });
  });

  it('resolves account-scoped and uniquely-owned company-only rows', () => {
    const resolve = createBurnrateRowResolver({
      accountTenants,
      companies,
      relationships: [{ id: 'r1', accountId: 'acct-a', companyId: 'co-a', kind: 'OWNER' }],
    });

    expect(resolve({ sourceRef: 'expense:1', accountId: 'acct-a' })).toEqual({ ok: true, tenantId: 101, sourceAccountId: 'acct-a', sourceCompanyId: null, companyKey: null, global: false });
    expect(resolve({ sourceRef: 'deal:1', companyId: 'co-a' })).toEqual({ ok: true, tenantId: 101, sourceAccountId: 'acct-a', sourceCompanyId: 'co-a', companyKey: '101:co-a', global: false });
  });

  it('rejects a company-only row when more than one OWNER could receive it', () => {
    const resolve = createBurnrateRowResolver({
      accountTenants,
      companies,
      relationships: [
        { id: 'r1', accountId: 'acct-a', companyId: 'co-a', kind: 'OWNER' },
        { id: 'r2', accountId: 'acct-b', companyId: 'co-a', kind: 'OWNER' },
      ],
    });

    expect(resolve({ sourceRef: 'deal:ambiguous', companyId: 'co-a' })).toMatchObject({ ok: false, code: 'ambiguous_company_owner' });
  });

  it('rejects an account/company pair without an active relationship', () => {
    const resolve = createBurnrateRowResolver({ accountTenants, companies, relationships: [] });
    expect(resolve({ sourceRef: 'task:1', accountId: 'acct-a', companyId: 'co-a' })).toMatchObject({ ok: false, code: 'account_company_mismatch' });
  });

  it('blocks conflicting account mappings, primary companies, project links and target names', () => {
    const plan = planBurnrateTenantCompanyMapping({
      accountTenants: [...accountTenants, { sourceAccountId: 'acct-a', tenantId: 999 }],
      companies: [...companies, { id: 'co-acme-2', accountId: 'acct-a', name: ' acme ', slug: 'acme-2' }],
      relationships: [
        { id: 'r1', accountId: 'acct-a', companyId: 'co-a', kind: 'OWNER', isPrimary: true },
        { id: 'r2', accountId: 'acct-a', companyId: 'co-acme-2', kind: 'OWNER', isPrimary: true },
      ],
      projects: [{ projectId: 'bad-project', accountId: 'acct-a', companyIds: ['co-missing'] }],
    });

    expect(new Set(plan.issues.map((issue) => issue.code))).toEqual(new Set([
      'duplicate_account_mapping', 'multiple_primary_companies', 'project_company_mismatch', 'duplicate_target_company_name',
    ]));
    expect(plan.summary.blockers).toBe(4);
  });

  it('allows only explicitly approved global rows', () => {
    const resolve = createBurnrateRowResolver({ accountTenants, companies, relationships: [] });
    expect(resolve({ sourceRef: 'catalog:1' })).toMatchObject({ ok: false, code: 'unscoped_row' });
    expect(resolve({ sourceRef: 'catalog:1', allowGlobal: true })).toEqual({ ok: true, tenantId: null, sourceAccountId: null, sourceCompanyId: null, companyKey: null, global: true });
  });
});
