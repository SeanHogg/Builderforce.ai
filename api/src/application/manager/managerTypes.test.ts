import { describe, it, expect } from 'vitest';
import {
  normalizeManagerType, customTypeRoleKey, resolveManagerType,
  deriveManagerTypeFromRole, MANAGER_TYPES, DEFAULT_MANAGER_TYPE,
} from './managerTypes';
import type { JobRole } from '../kanban/types';

describe('normalizeManagerType', () => {
  it('keeps known built-in ids', () => {
    for (const t of MANAGER_TYPES) expect(normalizeManagerType(t.id)).toBe(t.id);
  });
  it('keeps well-formed custom role ids', () => {
    expect(normalizeManagerType('role:data-platform')).toBe('role:data-platform');
    expect(normalizeManagerType('role:support')).toBe('role:support');
  });
  it('falls back to general for unknown / malformed input', () => {
    expect(normalizeManagerType('nope')).toBe(DEFAULT_MANAGER_TYPE);
    expect(normalizeManagerType('role:')).toBe(DEFAULT_MANAGER_TYPE);
    expect(normalizeManagerType('role:Bad Key')).toBe(DEFAULT_MANAGER_TYPE);
    expect(normalizeManagerType(null)).toBe(DEFAULT_MANAGER_TYPE);
    expect(normalizeManagerType(42)).toBe(DEFAULT_MANAGER_TYPE);
  });
});

describe('customTypeRoleKey', () => {
  it('extracts the role key from a custom id, null otherwise', () => {
    expect(customTypeRoleKey('role:data-platform')).toBe('data-platform');
    expect(customTypeRoleKey('qa')).toBeNull();
    expect(customTypeRoleKey('general')).toBeNull();
  });
});

describe('built-in types', () => {
  it('every built-in declares a discipline and is marked builtin', () => {
    for (const t of MANAGER_TYPES) {
      expect(t.builtin).toBe(true);
      expect(t.discipline).toBeTruthy();
      expect(t.directive.length).toBeGreaterThan(10);
    }
  });
  it('resolveManagerType falls back to general for a custom id (needs tenant lookup)', () => {
    expect(resolveManagerType('role:x').id).toBe('general');
    expect(resolveManagerType('qa').id).toBe('qa');
  });
});

describe('deriveManagerTypeFromRole', () => {
  const role: JobRole = {
    key: 'data-platform', name: 'Data Platform', description: 'Owns the data lake and pipelines.',
    discipline: 'data', builtin: false, position: 10,
  };
  it('turns a custom job role into a manager type', () => {
    const mt = deriveManagerTypeFromRole(role);
    expect(mt.id).toBe('role:data-platform');
    expect(mt.roleKey).toBe('data-platform');
    expect(mt.discipline).toBe('data');
    expect(mt.builtin).toBe(false);
    expect(mt.directive).toContain('Data Platform');
    expect(mt.directive).toContain('data lake');
  });
  it('synthesizes a directive even without a description', () => {
    const mt = deriveManagerTypeFromRole({ ...role, description: undefined });
    expect(mt.directive).toContain('Data Platform');
    expect(mt.description).toContain('Data Platform');
  });
});
