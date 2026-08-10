import { describe, it, expect } from 'vitest';
import { allowanceState } from './chatDiagnostics';
import { parseMessageProvenance, withProvenanceMetadata } from './provenance';

describe('allowanceState', () => {
  it('never reports exhausted for an UNCAPPED tenant, however large usage grows', () => {
    // The reported case: a superadmin-member tenant showed 559,139,119 used and was
    // told it had 0 left, while the gateway was letting every turn through.
    expect(allowanceState({ unlimited: true, remaining: -1, percentUsed: 0 })).toBe('ok');
    expect(allowanceState({ unlimited: true, remaining: 0, percentUsed: 100 })).toBe('ok');
  });

  it('reports exhausted only when a real cap is spent', () => {
    expect(allowanceState({ unlimited: false, remaining: 0, percentUsed: 100 })).toBe('exhausted');
    expect(allowanceState({ unlimited: false, remaining: -5, percentUsed: 100 })).toBe('exhausted');
  });

  it('warns from 80% and stays quiet below it', () => {
    expect(allowanceState({ unlimited: false, remaining: 10_000, percentUsed: 80 })).toBe('warn');
    expect(allowanceState({ unlimited: false, remaining: 40_000, percentUsed: 79 })).toBe('ok');
  });

  it('has no opinion without a meter', () => {
    expect(allowanceState(null)).toBe('ok');
    expect(allowanceState(undefined)).toBe('ok');
  });
});

describe('parseMessageProvenance', () => {
  const meta = (provenance: unknown) => ({ metadata: JSON.stringify({ provenance }) });

  it('keeps the MODEL when the gateway reported no account', () => {
    // Previously the whole record was dropped, so a turn served by an unknown
    // account had no attribution at all — exactly when the user needs it.
    const prov = parseMessageProvenance(meta({ model: 'openai/gpt-4o-mini' }));
    expect(prov?.model).toBe('openai/gpt-4o-mini');
    expect(prov?.account).toBeUndefined();
  });

  it('ignores an account value that is not part of the wire contract', () => {
    const prov = parseMessageProvenance(meta({ model: 'x/y', account: 'nonsense' }));
    expect(prov?.model).toBe('x/y');
    expect(prov?.account).toBeUndefined();
  });

  it('still round-trips a full record', () => {
    const prov = parseMessageProvenance(meta({ model: 'anthropic/claude', account: 'own', vendor: 'anthropic' }));
    expect(prov).toEqual({ model: 'anthropic/claude', account: 'own', vendor: 'anthropic' });
  });

  it('still requires a model — no model, no provenance', () => {
    expect(parseMessageProvenance(meta({ account: 'own' }))).toBeNull();
    expect(parseMessageProvenance(meta({ model: '' }))).toBeNull();
    expect(parseMessageProvenance({ metadata: null })).toBeNull();
    expect(parseMessageProvenance({ metadata: 'not json' })).toBeNull();
  });

  it('preserves sibling metadata keys when writing model-only provenance', () => {
    const serialized = withProvenanceMetadata({ model: 'm' }, { authoredBy: { kind: 'agent', ref: 'a' } });
    const parsed = JSON.parse(serialized as string) as Record<string, unknown>;
    expect(parsed.authoredBy).toEqual({ kind: 'agent', ref: 'a' });
    expect(parseMessageProvenance({ metadata: serialized ?? null })?.model).toBe('m');
  });
});
