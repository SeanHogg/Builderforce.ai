import { describe, it, expect } from 'vitest';
import {
  agentRoleKeys, agentIsRoleCapable, personaForRole, producerRoleForActionType, type RoleCapableAgentRow,
} from './roleCapability';

describe('producerRoleForActionType', () => {
  it('maps coding action types to developer', () => {
    for (const t of ['sql', 'frontend_ui', 'backend_api', 'refactor', 'bugfix', 'data_migration']) {
      expect(producerRoleForActionType(t)).toBe('developer');
    }
  });
  it('maps non-coding action types to their producer role', () => {
    expect(producerRoleForActionType('tests')).toBe('qa-tester');
    expect(producerRoleForActionType('docs')).toBe('tech-writer');
    expect(producerRoleForActionType('devops_ci')).toBe('devops');
  });
  it('imposes no constraint for ambiguous/other', () => {
    expect(producerRoleForActionType('other')).toBeUndefined();
    expect(producerRoleForActionType(null)).toBeUndefined();
    expect(producerRoleForActionType(undefined)).toBeUndefined();
  });
});

describe('agentRoleKeys / agentIsRoleCapable (#467 regression)', () => {
  // Ada — a built-in Product Manager agent. She must NEVER be developer-capable, so
  // she can never be auto-dispatched to write code on an Implementation stage.
  const ada: RoleCapableAgentRow = { id: 'product-manager-t1', name: 'Ada', title: 'Sr. Product Manager', skills: '["product-management","roadmapping"]', builtinKind: 'product_manager', roleKeys: null };

  it('a Product Manager agent is product-capable but NOT developer-capable', () => {
    const keys = agentRoleKeys(ada);
    expect(keys.has('product-manager')).toBe(true);
    expect(keys.has('product-owner')).toBe(true);
    expect(agentIsRoleCapable(ada, 'developer')).toBe(false);
    expect(agentIsRoleCapable(ada, 'product-manager')).toBe(true);
  });

  it('explicit role_keys make an agent capable', () => {
    const dev: RoleCapableAgentRow = { id: 'a2', name: 'Builder', title: null, skills: null, builtinKind: null, roleKeys: ['developer'] };
    expect(agentIsRoleCapable(dev, 'developer')).toBe(true);
    expect(agentIsRoleCapable(dev, 'security')).toBe(false);
  });

  it('builtin_kind validator is capable of review/validation roles', () => {
    const v: RoleCapableAgentRow = { id: 'validator-t1', name: 'Validator', title: null, skills: null, builtinKind: 'validator', roleKeys: null };
    expect(agentIsRoleCapable(v, 'validator')).toBe(true);
    expect(agentIsRoleCapable(v, 'code-reviewer')).toBe(true);
    expect(agentIsRoleCapable(v, 'team-lead')).toBe(true);
  });

  it('fuzzy title/skill match is the last-resort fallback', () => {
    const fuzzy: RoleCapableAgentRow = { id: 'a3', name: 'Security Bot', title: 'Security Engineer', skills: null, builtinKind: null, roleKeys: null };
    expect(agentIsRoleCapable(fuzzy, 'security')).toBe(true);
  });

  it('empty roleKey imposes no constraint', () => {
    expect(agentIsRoleCapable(ada, '')).toBe(true);
    expect(agentIsRoleCapable(ada, null)).toBe(true);
  });
});

describe('personaForRole', () => {
  it('aliases kanban role keys to runtime personas', () => {
    expect(personaForRole('developer')).toBe('code-creator');
    expect(personaForRole('qa-tester')).toBe('test-generator');
    expect(personaForRole('architect')).toBe('architecture-advisor');
    expect(personaForRole('code-reviewer')).toBe('code-reviewer');
    expect(personaForRole('validator')).toBe('validator-agent');
  });
});
