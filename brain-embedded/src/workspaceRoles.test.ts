import { describe, expect, it } from 'vitest';
import { isManagerRole } from './workspaceRoles';

describe('isManagerRole', () => {
  it('lets owners, admins and managers manage, in any case', () => {
    expect(isManagerRole('Owner')).toBe(true);
    expect(isManagerRole('admin')).toBe(true);
    expect(isManagerRole('manager')).toBe(true);
    expect(isManagerRole('developer')).toBe(false);
    expect(isManagerRole(null)).toBe(false);
    expect(isManagerRole(undefined)).toBe(false);
  });
});
