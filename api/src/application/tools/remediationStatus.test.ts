/**
 * Unit tests for deriveRemediation — the title-join that turns a diagnostic's
 * filed tickets into the project card / analytics remediation badge.
 */
import { describe, it, expect } from 'vitest';
import { deriveRemediation, isRemediationTitleFor } from './remediationStatus';

const NAME = 'SOC 2 Readiness Audit';
const t = (title: string, status: string, githubPrUrl: string | null = null) => ({ title, status, githubPrUrl });

describe('isRemediationTitleFor', () => {
  it('matches per-gap and bundled title shapes, not a different audit', () => {
    expect(isRemediationTitleFor('SOC 2 Readiness Audit: Add CC6.1 control', NAME)).toBe(true);
    expect(isRemediationTitleFor('SOC 2 Readiness Audit — Acme', NAME)).toBe(true);
    expect(isRemediationTitleFor('SOC 2 Readiness Audit', NAME)).toBe(true);
    expect(isRemediationTitleFor('Privacy & Data-Law Compliance: Add unsubscribe', NAME)).toBe(false);
    expect(isRemediationTitleFor('SOC 2 Readiness Audit Extended: x', 'SOC 2 Readiness Audit Extended')).toBe(true);
  });
});

describe('deriveRemediation', () => {
  it('reports none when no ticket matches', () => {
    expect(deriveRemediation(NAME, [t('Unrelated task', 'todo')])).toEqual({ state: 'none', total: 0, open: 0, prUrl: null });
  });

  it('reports filed when tickets exist but no PR', () => {
    const r = deriveRemediation(NAME, [t(`${NAME}: A`, 'todo'), t(`${NAME}: B`, 'in_progress')]);
    expect(r.state).toBe('filed');
    expect(r.total).toBe(2);
    expect(r.open).toBe(2);
    expect(r.prUrl).toBeNull();
  });

  it('reports pr_open when an open ticket has a PR', () => {
    const r = deriveRemediation(NAME, [t(`${NAME}: A`, 'in_review', 'https://gh/pr/1'), t(`${NAME}: B`, 'todo')]);
    expect(r.state).toBe('pr_open');
    expect(r.prUrl).toBe('https://gh/pr/1');
    expect(r.open).toBe(2);
  });

  it('reports resolved when every matched ticket is done', () => {
    const r = deriveRemediation(NAME, [t(`${NAME}: A`, 'done', 'https://gh/pr/1'), t(`${NAME}: B`, 'done')]);
    expect(r.state).toBe('resolved');
    expect(r.open).toBe(0);
    expect(r.total).toBe(2);
  });
});
