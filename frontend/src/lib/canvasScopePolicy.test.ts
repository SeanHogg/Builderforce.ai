import { describe, expect, it } from 'vitest';
import { scopeChangeEffect, type ScopeAxis } from './canvasScopePolicy';

/**
 * The rules are a table, so the test is a table. The point of these assertions is
 * the SPLIT: exactly one axis is an identity change, and only that one is allowed
 * to end a call or close a board.
 */
describe('scopeChangeEffect', () => {
  const filters: ScopeAxis[] = ['project', 'company'];

  it.each(filters)('%s is a filter: the board stays and the room is untouched', (axis) => {
    const effect = scopeChangeEffect(axis, true);
    expect(effect.canvas).toBe('keep-out-of-scope');
    expect(effect.room).toBe('keep');
    expect(effect.workbench).toBe('refetch');
    expect(effect.confirm).toBe(false);
  });

  it('tenant is an identity change: the board closes and the call ends', () => {
    const effect = scopeChangeEffect('tenant', true);
    expect(effect.canvas).toBe('close');
    expect(effect.room).toBe('leave');
    expect(effect.workbench).toBe('reopen');
    expect(effect.confirm).toBe(true);
    expect(effect.confirmKey).toBe('leaveRoomOnTenantSwitch');
  });

  it('does not interrupt a tenant switch when there is nobody to interrupt', () => {
    const effect = scopeChangeEffect('tenant', false);
    expect(effect.canvas).toBe('close');
    expect(effect.room).toBe('keep');
    expect(effect.confirm).toBe(false);
    expect(effect.confirmKey).toBeUndefined();
  });

  it('switching canvas swaps the board inside the mounted stage', () => {
    const effect = scopeChangeEffect('canvas', true);
    expect(effect.canvas).toBe('swap');
    expect(effect.room).toBe('keep');
    expect(effect.workbench).toBe('keep');
  });

  it('tenant is the ONLY axis that ever leaves a room', () => {
    const axes: ScopeAxis[] = ['tenant', 'company', 'project', 'canvas'];
    const leaving = axes.filter((axis) => scopeChangeEffect(axis, true).room === 'leave');
    expect(leaving).toEqual(['tenant']);
  });
});
