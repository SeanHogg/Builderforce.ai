import { describe, it, expect } from 'vitest';
import { templateRosterRoles } from './types';
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from './templateCatalog';
import { BACKLOG_LANE_GATE } from '../swimlane/defaultSwimlanes';

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

  it('every built-in seeds its backlog lane human-gated (operator decision 2026-11-07)', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const backlog = t.lanes.find((l) => l.key === 'backlog');
      if (!backlog) continue;
      expect(backlog.gate, t.id).toBe(BACKLOG_LANE_GATE);
      expect(backlog.gate, t.id).toBe('human');
    }
    // The assertion must not pass vacuously: at least the flagship has a backlog lane.
    expect(getBuiltinTemplate('standard-swe')!.lanes.some((l) => l.key === 'backlog')).toBe(true);
  });
});
