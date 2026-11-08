import { describe, it, expect } from 'vitest';
import { refusalFromRow } from './autoRunSkipReader';

const ts = new Date('2026-11-08T12:00:00Z');

describe('refusalFromRow', () => {
  it('reads the reason a skip row recorded', () => {
    expect(refusalFromRow({ toolName: 'auto_run_skipped', args: JSON.stringify({ reason: 'cooldown_active' }), ts }))
      .toEqual({ reason: 'cooldown_active', at: ts });
  });

  it('maps an auto_run_error row to trigger_error (a throw has no reason field)', () => {
    expect(refusalFromRow({ toolName: 'auto_run_error', args: JSON.stringify({ error: 'boom' }), ts }))
      .toEqual({ reason: 'trigger_error', at: ts });
    expect(refusalFromRow({ toolName: 'auto_run_error', args: null, ts })?.reason).toBe('trigger_error');
  });

  it('drops off-vocabulary, will_run, unparseable and unrelated rows', () => {
    expect(refusalFromRow({ toolName: 'auto_run_skipped', args: JSON.stringify({ reason: 'made_up' }), ts })).toBeNull();
    expect(refusalFromRow({ toolName: 'auto_run_skipped', args: JSON.stringify({ reason: 'will_run' }), ts })).toBeNull();
    expect(refusalFromRow({ toolName: 'auto_run_skipped', args: '{not json', ts })).toBeNull();
    expect(refusalFromRow({ toolName: 'auto_run_skipped', args: null, ts })).toBeNull();
    expect(refusalFromRow({ toolName: 'auto_run_dispatched', args: JSON.stringify({ reason: 'no_agent' }), ts })).toBeNull();
  });
});
