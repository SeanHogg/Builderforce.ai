/**
 * Stamp a memory fact with who produced it before it is written locally.
 *
 * `packages/local-first/src/factProvenance.ts` records a different axis
 * (`source: 'local' | 'imported'`) and does not export a stamper for
 * `'user' | 'agent' | 'import'`. This module owns that allow-list. An unknown
 * or missing source is refused: the input fact is never mutated, and it is
 * not echoed on the refusal.
 */

export const FACT_SOURCES = ['user', 'agent', 'import'] as const;

export type FactSource = (typeof FACT_SOURCES)[number];

const FACT_SOURCE_SET: ReadonlySet<string> = new Set(FACT_SOURCES);

export function isFactSource(source: unknown): source is FactSource {
  return typeof source === 'string' && FACT_SOURCE_SET.has(source);
}

export interface StampedFact<T> {
  readonly ok: true;
  readonly fact: T & { readonly source: FactSource; readonly origin: 'local' };
}

export interface StampFactRefusal {
  readonly ok: false;
  readonly code: 'unknown_source';
}

export type StampFactResult<T> = StampedFact<T> | StampFactRefusal;

/**
 * Return a new fact whose `source` is one of `user`, `agent`, or `import`
 * and whose `origin` is `local`. Any other source, including a missing one,
 * returns `{ ok: false, code: 'unknown_source' }` and does not return the fact.
 * The input is not mutated.
 */
export function stampFact<T extends object>(fact: T, source?: unknown): StampFactResult<T> {
  if (!isFactSource(source)) {
    return { ok: false, code: 'unknown_source' };
  }
  return {
    ok: true,
    fact: { ...fact, source, origin: 'local' },
  };
}
