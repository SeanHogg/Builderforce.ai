import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveManagerPolicy,
  resolveTieredManagerPolicy,
  resolveTenantManagerDefaults,
  resolveManagerKind,
  normalizePrMergePolicy,
  DEFAULT_MANAGER_POLICY,
  type ManagerConfigRow,
  type TenantManagerDefaultsRow,
} from './managerPolicy';

/** A full project row (every column NOT NULL in the DB except managerRef/allowAutoMerge). */
const projectRow = (o: Partial<ManagerConfigRow> = {}): ManagerConfigRow => ({
  managerRef: null,
  enabled: true,
  prMergePolicy: 'immediate',
  autoAssign: true,
  autoBusinessValue: true,
  autoPrioritize: true,
  managerType: 'general',
  requireSignoffToComplete: true,
  allowAutoMerge: null,
  ...o,
});

/** A workspace row with NO opinions — every column nullable, null = "not set". */
const tenantRow = (o: Partial<TenantManagerDefaultsRow> = {}): TenantManagerDefaultsRow => ({
  enabled: null,
  prMergePolicy: null,
  autoAssign: null,
  autoBusinessValue: null,
  autoPrioritize: null,
  requireSignoffToComplete: null,
  allowAutoMerge: null,
  ...o,
});

describe('resolveManagerKind', () => {
  it('maps ref prefixes to a kind, defaulting to system', () => {
    expect(resolveManagerKind('u:123')).toBe('human');
    expect(resolveManagerKind('c:agent-abc')).toBe('agent');
    expect(resolveManagerKind('h:5')).toBe('agent');
    expect(resolveManagerKind(null)).toBe('system');
    expect(resolveManagerKind('  ')).toBe('system');
  });
});

describe('normalizePrMergePolicy', () => {
  it('accepts valid policies and defaults the rest', () => {
    expect(normalizePrMergePolicy('on_green')).toBe('on_green');
    expect(normalizePrMergePolicy('queue')).toBe('queue');
    expect(normalizePrMergePolicy('bogus')).toBe('immediate');
    expect(normalizePrMergePolicy(undefined)).toBe('immediate');
  });
});

describe('resolveEffectiveManagerPolicy', () => {
  it('returns the tenant default when no row exists', () => {
    expect(resolveEffectiveManagerPolicy(null)).toEqual(DEFAULT_MANAGER_POLICY);
  });
  it('folds a row over the default and derives managerKind', () => {
    const eff = resolveEffectiveManagerPolicy({
      managerRef: 'c:ada',
      enabled: true,
      prMergePolicy: 'queue',
      autoAssign: false,
      autoBusinessValue: true,
      autoPrioritize: true,
      managerType: 'qa',
    });
    expect(eff.managerKind).toBe('agent');
    expect(eff.prMergePolicy).toBe('queue');
    expect(eff.autoAssign).toBe(false);
    expect(eff.managerType).toBe('qa');
  });
  it('normalizes an invalid persisted policy string', () => {
    const eff = resolveEffectiveManagerPolicy({
      managerRef: null, enabled: true, prMergePolicy: 'garbage',
      autoAssign: true, autoBusinessValue: true, autoPrioritize: true,
      managerType: 'not-a-type',
    });
    expect(eff.prMergePolicy).toBe('immediate');
    expect(eff.managerKind).toBe('system');
    expect(eff.managerType).toBe('general');
  });
  it('is exactly the two-tier case of the tiered fold (no duplicated precedence)', () => {
    const row = projectRow({ managerRef: 'u:7', prMergePolicy: 'on_green', autoPrioritize: false });
    expect(resolveEffectiveManagerPolicy(row)).toEqual(resolveTieredManagerPolicy({ project: row }));
  });
});

// ── merge authority is its own control (0363) ────────────────────────────────

describe('allowAutoMerge', () => {
  it('is withheld by default — nothing inherits merge authority by omission', () => {
    expect(DEFAULT_MANAGER_POLICY.allowAutoMerge).toBe(false);
    expect(resolveTieredManagerPolicy({}).allowAutoMerge).toBe(false);
    expect(resolveEffectiveManagerPolicy(null).allowAutoMerge).toBe(false);
  });

  it('is NOT implied by prMergePolicy — the two questions are independent', () => {
    // 'immediate' used to mean "may merge, right now". It now only answers HOW.
    const immediate = resolveTieredManagerPolicy({ project: projectRow({ prMergePolicy: 'immediate' }) });
    expect(immediate.prMergePolicy).toBe('immediate');
    expect(immediate.allowAutoMerge).toBe(false);

    // And a granted project can still choose to wait for green CI.
    const granted = resolveTieredManagerPolicy({
      project: projectRow({ prMergePolicy: 'on_green', allowAutoMerge: true }),
    });
    expect(granted.prMergePolicy).toBe('on_green');
    expect(granted.allowAutoMerge).toBe(true);
  });

  it('is granted by the workspace tier alone when the project has no opinion (null)', () => {
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow({ allowAutoMerge: true }),
      project: projectRow({ allowAutoMerge: null }),
    });
    expect(eff.allowAutoMerge).toBe(true);
  });

  it('is granted by the project tier alone when the workspace is silent', () => {
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow(),
      project: projectRow({ allowAutoMerge: true }),
    });
    expect(eff.allowAutoMerge).toBe(true);
  });

  it('is a CEILING: a workspace false cannot be re-granted by a project', () => {
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow({ allowAutoMerge: false }),
      project: projectRow({ allowAutoMerge: true }),
    });
    expect(eff.allowAutoMerge).toBe(false);
  });

  it('lets a project decline authority the workspace granted', () => {
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow({ allowAutoMerge: true }),
      project: projectRow({ allowAutoMerge: false }),
    });
    expect(eff.allowAutoMerge).toBe(false);
  });

  it('treats a pre-migration row (field absent entirely) as no opinion, not as a grant', () => {
    // A row projected before 0363 lands simply has no allowAutoMerge key at all.
    const { allowAutoMerge: _omitted, ...legacy } = projectRow();
    expect(resolveEffectiveManagerPolicy(legacy).allowAutoMerge).toBe(false);
    // A workspace grant still reaches a legacy row that never had the column.
    expect(resolveTieredManagerPolicy({
      tenant: tenantRow({ allowAutoMerge: true }),
      project: legacy,
    }).allowAutoMerge).toBe(true);
  });
});

// ── three-tier precedence ────────────────────────────────────────────────────

describe('resolveTieredManagerPolicy', () => {
  it('falls back to the hardcoded default when neither tier exists', () => {
    expect(resolveTieredManagerPolicy({})).toEqual(DEFAULT_MANAGER_POLICY);
    expect(resolveTieredManagerPolicy({ tenant: null, project: null })).toEqual(DEFAULT_MANAGER_POLICY);
  });

  it('ignores a workspace row that expresses no opinions at all', () => {
    expect(resolveTieredManagerPolicy({ tenant: tenantRow() })).toEqual(DEFAULT_MANAGER_POLICY);
  });

  it('lets the workspace tier override the hardcoded default', () => {
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow({ prMergePolicy: 'on_green', autoAssign: false, autoBusinessValue: false }),
    });
    expect(eff.prMergePolicy).toBe('on_green');
    expect(eff.autoAssign).toBe(false);
    expect(eff.autoBusinessValue).toBe(false);
    // Untouched fields still come from the hardcoded default.
    expect(eff.autoPrioritize).toBe(DEFAULT_MANAGER_POLICY.autoPrioritize);
    expect(eff.managerType).toBe(DEFAULT_MANAGER_POLICY.managerType);
  });

  it('normalizes a garbage workspace policy string rather than trusting it', () => {
    expect(resolveTieredManagerPolicy({ tenant: tenantRow({ prMergePolicy: 'sideways' }) }).prMergePolicy)
      .toBe('immediate');
  });

  it('lets the project tier win over the workspace tier for tuning knobs', () => {
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow({ prMergePolicy: 'queue', autoAssign: false, autoPrioritize: false }),
      project: projectRow({ prMergePolicy: 'on_green', autoAssign: true, autoPrioritize: true }),
    });
    expect(eff.prMergePolicy).toBe('on_green');
    expect(eff.autoAssign).toBe(true);
    expect(eff.autoPrioritize).toBe(true);
  });

  it('resolves each field independently — one tier setting X does not pull in its Y', () => {
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow({ prMergePolicy: 'on_green' }),
      project: projectRow({ autoBusinessValue: false }),
    });
    expect(eff.prMergePolicy).toBe('on_green');   // workspace
    expect(eff.autoBusinessValue).toBe(false);    // project
    expect(eff.autoAssign).toBe(true);            // project row's NOT NULL default
    expect(eff.managerType).toBe('general');      // hardcoded default
  });

  it('carries the designation + derived kind from the project tier', () => {
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow({ allowAutoMerge: true }),
      project: projectRow({ managerRef: '  h:42  ', managerType: 'devops' }),
    });
    expect(eff.managerRef).toBe('h:42'); // trimmed
    expect(eff.managerKind).toBe('agent');
    expect(eff.managerType).toBe('devops');
  });

  it('keeps a blank designation as the system service', () => {
    const eff = resolveTieredManagerPolicy({ project: projectRow({ managerRef: '   ' }) });
    expect(eff.managerRef).toBeNull();
    expect(eff.managerKind).toBe('system');
  });

  // enabled — a kill-switch, not a preference.
  it('enabled: a workspace false is a kill-switch a project row cannot undo', () => {
    // This is the case that forces most-restrictive-wins: project_manager_configs.enabled
    // is NOT NULL DEFAULT true, so EVERY existing project row "sets" it to true.
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow({ enabled: false }),
      project: projectRow({ enabled: true }),
    });
    expect(eff.enabled).toBe(false);
  });

  it('enabled: a project false still pauses one project under an enabled workspace', () => {
    expect(resolveTieredManagerPolicy({
      tenant: tenantRow({ enabled: true }),
      project: projectRow({ enabled: false }),
    }).enabled).toBe(false);
  });

  it('enabled: stays on when both tiers agree, or when neither speaks', () => {
    expect(resolveTieredManagerPolicy({
      tenant: tenantRow({ enabled: true }), project: projectRow({ enabled: true }),
    }).enabled).toBe(true);
    expect(resolveTieredManagerPolicy({}).enabled).toBe(true);
  });

  // requireSignoffToComplete — an obligation, so `true` is the restrictive value.
  it('requireSignoff: a workspace true is a floor a project cannot opt out of', () => {
    const eff = resolveTieredManagerPolicy({
      tenant: tenantRow({ requireSignoffToComplete: true }),
      project: projectRow({ requireSignoffToComplete: false }),
    });
    expect(eff.requireSignoffToComplete).toBe(true);
  });

  it('requireSignoff: a project may still tighten what the workspace relaxed', () => {
    expect(resolveTieredManagerPolicy({
      tenant: tenantRow({ requireSignoffToComplete: false }),
      project: projectRow({ requireSignoffToComplete: true }),
    }).requireSignoffToComplete).toBe(true);
  });

  it('requireSignoff: a workspace-wide opt-out applies to projects with no opinion', () => {
    expect(resolveTieredManagerPolicy({
      tenant: tenantRow({ requireSignoffToComplete: false }),
      project: projectRow({ requireSignoffToComplete: undefined }),
    }).requireSignoffToComplete).toBe(false);
    // …and defaults back to required when nobody speaks.
    expect(resolveTieredManagerPolicy({}).requireSignoffToComplete).toBe(true);
  });

  it('is pure — it never mutates the rows it folds, or the shared default object', () => {
    const tenant = tenantRow({ allowAutoMerge: true });
    const project = projectRow({ prMergePolicy: 'on_green' });
    const tenantBefore = { ...tenant };
    const projectBefore = { ...project };
    const defaultBefore = { ...DEFAULT_MANAGER_POLICY };

    const a = resolveTieredManagerPolicy({ tenant, project });
    a.allowAutoMerge = false;
    a.prMergePolicy = 'queue';

    expect(tenant).toEqual(tenantBefore);
    expect(project).toEqual(projectBefore);
    expect(DEFAULT_MANAGER_POLICY).toEqual(defaultBefore);
    // A second call is unaffected by the mutated first result.
    expect(resolveTieredManagerPolicy({ tenant, project })).toEqual({
      ...a, allowAutoMerge: true, prMergePolicy: 'on_green',
    });
  });
});

describe('resolveTenantManagerDefaults', () => {
  it('describes what a project with no config row of its own gets', () => {
    const eff = resolveTenantManagerDefaults(tenantRow({ allowAutoMerge: true, prMergePolicy: 'on_green' }));
    expect(eff.allowAutoMerge).toBe(true);
    expect(eff.prMergePolicy).toBe('on_green');
    expect(eff.enabled).toBe(true);              // hardcoded default
    expect(eff.managerType).toBe('general');     // workspace tier has no designation
    expect(eff.managerRef).toBeNull();
  });
  it('is the hardcoded default for a workspace that has never been configured', () => {
    expect(resolveTenantManagerDefaults(null)).toEqual(DEFAULT_MANAGER_POLICY);
  });
});
