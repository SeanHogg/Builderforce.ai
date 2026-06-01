import { describe, expect, it } from 'vitest';
import { buildPrdWorkflowSpec, defaultPrdSections } from './generatePrd';

describe('defaultPrdSections', () => {
  it('returns the canonical section ids in order', () => {
    expect(defaultPrdSections()).toEqual([
      'overview',
      'goals',
      'requirements',
      'acceptance_criteria',
      'out_of_scope',
    ]);
  });

  it('returns a fresh array each call (no shared mutation)', () => {
    const a = defaultPrdSections();
    a.push('mutated');
    expect(defaultPrdSections()).not.toContain('mutated');
  });
});

describe('buildPrdWorkflowSpec', () => {
  it('produces a planning workflow with a prd-author first step that has no deps', () => {
    const spec = buildPrdWorkflowSpec('Add SSO login');
    expect(spec.workflowType).toBe('planning');
    expect(spec.steps.length).toBeGreaterThanOrEqual(1);
    const first = spec.steps[0]!;
    expect(first.agentRole).toBe('prd-author');
    expect(first.dependsOn).toEqual([]);
    expect(first.description).toContain('Add SSO login');
  });

  it('references all canonical sections in the author step', () => {
    const spec = buildPrdWorkflowSpec('Ticket');
    const first = spec.steps[0]!;
    for (const section of defaultPrdSections()) {
      expect(first.description).toContain(section);
    }
  });

  it('chains a review step that depends on the author step', () => {
    const spec = buildPrdWorkflowSpec('Ticket');
    expect(spec.steps[1]!.dependsOn).toEqual(['0']);
  });

  it('handles empty/whitespace ticket descriptions gracefully', () => {
    const spec = buildPrdWorkflowSpec('   ');
    expect(spec.steps[0]!.description).toContain('(no description provided)');
  });
});
