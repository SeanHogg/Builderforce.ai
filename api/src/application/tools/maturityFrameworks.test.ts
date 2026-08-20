import { describe, expect, it } from 'vitest';
import {
  MATURITY_FRAMEWORKS,
  applyMaturityFramework,
  listMaturityFrameworks,
  maturityFramework,
} from './maturityFrameworks';
import { agenticMaturity } from './toolDefinitions';
import type { ToolResult } from './toolTypes';

/** A scored six-practice result, as `scoreQuestionnaire` produces one. */
const scored: ToolResult = {
  headline: 'Level 3.2 — Defined',
  score: 3.2,
  scoreLabel: 'Defined',
  metrics: [
    { key: 'delivery', label: 'Software Delivery', value: 'Level 4', tier: 4 },
    { key: 'devops', label: 'Release & Operations (DORA)', value: 'Level 2', tier: 2 },
    { key: 'quality', label: 'Quality Assurance', value: 'Level 3', tier: 3 },
    { key: 'project_management', label: 'Project Management', value: 'Level 4', tier: 4 },
    { key: 'agentic_ops', label: 'Agentic AI Operations', value: 'Level 3', tier: 3 },
    { key: 'governance', label: 'Governance & Security', value: 'Not assessed' },
  ],
  recommendations: [{ title: 'Release & Operations (DORA) — to Level 3', detail: 'Automate the deploy pipeline.' }],
};

describe('the framework registry', () => {
  it('maps only practices the diagnostic actually has', () => {
    const known = new Set(agenticMaturity.sections.map((s) => s.key));
    for (const framework of MATURITY_FRAMEWORKS) {
      for (const domain of framework.domains) {
        for (const practice of domain.practices) {
          expect(known, `${framework.id}/${domain.key} maps unknown practice '${practice}'`).toContain(practice);
        }
      }
    }
  });

  it('covers every practice in every framework — a lens must not silently drop a measurement', () => {
    const known = agenticMaturity.sections.map((s) => s.key);
    for (const framework of MATURITY_FRAMEWORKS) {
      const covered = new Set(framework.domains.flatMap((d) => d.practices));
      for (const practice of known) {
        expect([...covered], `${framework.id} never reports '${practice}'`).toContain(practice);
      }
    }
  });

  it('falls back to the default lens for an unknown id rather than throwing', () => {
    expect(maturityFramework('nonsense').id).toBe('cmmi');
    expect(maturityFramework(undefined).id).toBe('cmmi');
    expect(maturityFramework('itil').id).toBe('itil');
  });

  it('serves a client-safe summary with no functions on it', () => {
    const list = listMaturityFrameworks();
    expect(list.map((f) => f.id)).toEqual(['cmmi', 'cobit', 'itil']);
    expect(JSON.parse(JSON.stringify(list))).toEqual(list);
  });
});

describe('applyMaturityFramework', () => {
  it('returns the result untouched under the default lens', () => {
    expect(applyMaturityFramework(scored, maturityFramework('cmmi'))).toBe(scored);
  });

  it('never moves the score or the plan — a lens regroups, it does not re-measure', () => {
    for (const id of ['cobit', 'itil'] as const) {
      const lensed = applyMaturityFramework(scored, maturityFramework(id));
      expect(lensed.score).toBe(scored.score);
      expect(lensed.scoreLabel).toBe(scored.scoreLabel);
      expect(lensed.headline).toBe(scored.headline);
      // Remediation stays at practice grain, because that is where somebody acts.
      expect(lensed.recommendations).toEqual(scored.recommendations);
    }
  });

  it('averages the practices a COBIT domain spans', () => {
    const cobit = applyMaturityFramework(scored, maturityFramework('cobit'));
    const apo = cobit.metrics.find((m) => m.key === 'apo')!;
    // project_management (4) + agentic_ops (3) → 3.5, rounded to 4.
    expect(apo.label).toBe('Align, Plan and Organise');
    expect(apo.tier).toBe(4);
    expect(apo.hint).toContain('Project Management');
    expect(apo.hint).toContain('Agentic AI Operations');
  });

  it('ignores an unassessed practice instead of scoring it zero', () => {
    const cobit = applyMaturityFramework(scored, maturityFramework('cobit'));
    // MEA spans quality (3) and governance (unassessed) — it must report 3, not 1.5.
    expect(cobit.metrics.find((m) => m.key === 'mea')!.tier).toBe(3);
    // EDM spans governance ALONE, which was not assessed — so the domain is not
    // assessed either. Reporting Level 0 here would be a claim about the workspace.
    const edm = cobit.metrics.find((m) => m.key === 'edm')!;
    expect(edm.tier).toBeUndefined();
    expect(edm.value).toBe('Not assessed');
  });

  it('reports the ITIL value chain in its own vocabulary', () => {
    const itil = applyMaturityFramework(scored, maturityFramework('itil'));
    expect(itil.metrics.map((m) => m.key)).toEqual(['plan', 'improve', 'design_transition', 'obtain_build', 'deliver_support', 'govern']);
    expect(itil.metrics.find((m) => m.key === 'deliver_support')!.tier).toBe(2); // devops
  });

  it('is stable over a result whose metrics carry no keys', () => {
    const unkeyed: ToolResult = { headline: 'x', metrics: [{ label: 'Window', value: '90 days' }], recommendations: [] };
    const lensed = applyMaturityFramework(unkeyed, maturityFramework('cobit'));
    // Nothing to fold in, so every domain reports as unassessed — never a crash
    // and never a fabricated level.
    expect(lensed.metrics.every((m) => m.value === 'Not assessed')).toBe(true);
  });
});
