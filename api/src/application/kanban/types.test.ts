import { describe, it, expect } from 'vitest';
import { templateRosterRoles } from './types';
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from './templateCatalog';

describe('templateRosterRoles', () => {
  it('unions the distinct roles a template references, flagging required ones', () => {
    const std = getBuiltinTemplate('standard-swe')!;
    const roles = templateRosterRoles(std);
    const byKey = new Map(roles.map((r) => [r.roleKey, r]));

    // Architect appears as a required reviewer on ready, in_review and done.
    expect(byKey.get('architect')?.required).toBe(true);
    expect(byKey.get('architect')?.lanes).toEqual(expect.arrayContaining(['ready', 'in_review', 'done']));

    // Every reviewer/role requirement surfaces exactly once.
    const keys = roles.map((r) => r.roleKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['business-analyst', 'product-manager', 'developer', 'code-reviewer', 'qa-tester']));
  });

  it('ignores diagnostic requirements (they are not roster roles)', () => {
    const roles = templateRosterRoles({
      lanes: [{
        key: 'x', name: 'X', position: 0, isTerminal: false, gate: 'auto', requirementGate: 'soft',
        requirements: [
          { kind: 'diagnostic', ref: 'security-posture', isRequired: true, position: 0 },
          { kind: 'role', ref: 'developer', responsibility: 'owner', isRequired: true, position: 1 },
        ],
      }],
    });
    expect(roles.map((r) => r.roleKey)).toEqual(['developer']);
  });
});

describe('BUILTIN_TEMPLATES', () => {
  it('every built-in has unique lane keys and a terminal lane', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const keys = t.lanes.map((l) => l.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(t.lanes.some((l) => l.isTerminal)).toBe(true);
    }
  });
});
