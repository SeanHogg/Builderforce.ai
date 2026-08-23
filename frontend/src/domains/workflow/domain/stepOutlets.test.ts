import { describe, expect, it } from 'vitest';
import {
  appendOutlet, isMultiOutletKind, outletForHandle, patchOutlet, removeOutlet, stepOutlets, writeStepOutlets,
} from './stepOutlets';

describe('stepOutlets', () => {
  it('gives every ordinary step exactly one unconditional outlet', () => {
    expect(stepOutlets('llm', {})).toEqual([{ id: 'out', name: '' }]);
    expect(isMultiOutletKind('llm')).toBe(false);
  });

  it('projects a router\'s routes JSON into named outlets plus a fallback', () => {
    const config = { routes: '[{"name":"Paid","condition":"status == \\"paid\\""}]', fallback: 'Unpaid' };
    expect(stepOutlets('router', config)).toEqual([
      { id: 'outlet:0', name: 'Paid', condition: 'status == "paid"' },
      { id: 'outlet:else', name: 'Unpaid', fallback: true },
    ]);
  });

  it('projects a switch\'s cases, which match a value rather than a condition', () => {
    const config = { cases: '[{"match":"ready","name":"Ready"}]' };
    expect(stepOutlets('switch', config)).toEqual([
      { id: 'outlet:0', name: 'Ready', match: 'ready' },
      { id: 'outlet:else', name: 'Else', fallback: true },
    ]);
  });

  it('gives a branch the fixed pair the executor actually tags', () => {
    expect(stepOutlets('branch', {}).map((outlet) => outlet.name)).toEqual(['true', 'false']);
  });

  it('survives a half-typed routes value instead of losing every outlet', () => {
    expect(stepOutlets('router', { routes: '[{"name":"Pa' }).map((outlet) => outlet.id)).toEqual(['outlet:else']);
  });

  it('folds an edited outlet list back into the config the executor reads', () => {
    const patch = writeStepOutlets('router', [
      { id: 'outlet:0', name: 'Paid', condition: 'paid' },
      { id: 'outlet:else', name: 'Else', fallback: true },
    ]);
    expect(JSON.parse(String(patch.routes))).toEqual([{ name: 'Paid', condition: 'paid' }]);
    expect(patch.fallback).toBe('Else');
  });

  it('round-trips through append / patch / remove', () => {
    let config: Record<string, unknown> = { ...appendOutlet('switch', {}) };
    expect(stepOutlets('switch', config)).toHaveLength(2);
    config = { ...config, ...patchOutlet('switch', config, 'outlet:0', { name: 'Ready', match: 'ready' }) };
    expect(stepOutlets('switch', config)[0]).toMatchObject({ name: 'Ready', match: 'ready' });
    config = { ...config, ...removeOutlet('switch', config, 'outlet:0') };
    expect(stepOutlets('switch', config).map((outlet) => outlet.id)).toEqual(['outlet:else']);
  });

  it('refuses to remove the fallback — a decision needs somewhere to go', () => {
    const config = { cases: '[{"match":"a","name":"A"}]', fallback: 'Else' };
    const next = { ...config, ...removeOutlet('switch', config, 'outlet:else') };
    expect(stepOutlets('switch', next).some((outlet) => outlet.fallback)).toBe(true);
  });

  it('keeps an edge attached across a RENAME, because ids are positional', () => {
    const before = { routes: '[{"name":"Then","condition":"x"}]', fallback: 'Else' };
    const after = { ...before, ...patchOutlet('router', before, 'outlet:0', { name: 'Paid' }) };
    expect(outletForHandle('router', after, 'outlet:0')?.name).toBe('Paid');
  });

  it('resolves nothing for an edge drawn from no outlet at all', () => {
    expect(outletForHandle('router', {}, null)).toBeNull();
  });
});
