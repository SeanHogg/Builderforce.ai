import { describe, expect, it } from 'vitest';
import { stampFact, type FactSource } from './stampFactSource';

const SOURCES: readonly FactSource[] = ['user', 'agent', 'import'];

describe('stampFact', () => {
  it('stamps a valid source and a local origin onto a new fact', () => {
    for (const source of SOURCES) {
      const fact = { id: 'f1', statement: 'remembered', source: 'server', origin: 'remote' };
      const result = stampFact(fact, source);

      expect(result).toEqual({
        ok: true,
        fact: { id: 'f1', statement: 'remembered', source, origin: 'local' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.fact).not.toBe(fact);
        expect(result.fact.source).toBe(source);
        expect(result.fact.origin).toBe('local');
      }
    }
  });

  it('does not mutate the input fact', () => {
    const fact = { id: 'f1', statement: 'remembered', source: 'server', origin: 'remote', nested: { n: 1 } };
    const snapshot = structuredClone(fact);

    const result = stampFact(fact, 'agent');

    expect(fact).toEqual(snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      result.fact.statement = 'changed';
      expect(fact.statement).toBe('remembered');
      expect(result.fact.nested).toBe(fact.nested);
    }
  });

  it('refuses a missing source and does not return the fact', () => {
    const fact = { id: 'f1', statement: 'remembered' };

    expect(stampFact(fact)).toEqual({ ok: false, code: 'unknown_source' });
    expect(stampFact(fact, undefined)).toEqual({ ok: false, code: 'unknown_source' });
    expect(stampFact(fact, null)).toEqual({ ok: false, code: 'unknown_source' });

    const refused = stampFact(fact);
    expect(refused).not.toHaveProperty('fact');
    expect(Object.keys(refused).sort()).toEqual(['code', 'ok']);
    expect(fact).toEqual({ id: 'f1', statement: 'remembered' });
  });

  it('refuses any source outside the allow-list and does not return the fact', () => {
    const fact = { id: 'f1', statement: 'remembered', secret: 'keep' };
    const rejected = ['', 'User', 'AGENT', 'imported', 'local', 'server', ' user', 'user ', 1, true, { source: 'user' }];

    for (const source of rejected) {
      const refused = stampFact(fact, source);
      expect(refused).toEqual({ ok: false, code: 'unknown_source' });
      expect(refused).not.toHaveProperty('fact');
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.code).toBe('unknown_source');
      }
    }
    expect(fact).toEqual({ id: 'f1', statement: 'remembered', secret: 'keep' });
  });

  it('returns a fresh refusal object and never the input fact', () => {
    const fact = { id: 'f1' };
    const first = stampFact(fact, 'other');
    const second = stampFact(fact, 'other');

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(first).not.toBe(fact);
    expect(JSON.stringify(first)).not.toContain('f1');
  });
});
