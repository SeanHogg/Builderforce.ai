/**
 * The ONE answer to "which ref does Restructure act on, and may it be clicked now" for every stage entry point (a
 * station card, a symbol card, an outline row). The target is the first ref carrying a restructurable anti-pattern;
 * the action is ready unless the file's definitions are being read right now (`useRestructure().status === 'loading'`):
 * a click loads them (the host's loader) when the drill has not, so "not loaded yet" is never a reason to disable.
 */

import type { SymbolFacts } from '../../surface/symbolFacts';

/** The first ref of `refs` that carries a restructurable anti-pattern, or `undefined` (no Restructure offered). */
export function restructureTargetOf(facts: Pick<SymbolFacts, 'antiPatternOf'>, refs: readonly string[]): string | undefined {
    return refs.find((r) => facts.antiPatternOf(r)?.restructurable === true);
}

/** The target and whether its action is clickable (disabled with the loading tooltip only while a read is in flight). */
export function restructureOf(facts: Pick<SymbolFacts, 'antiPatternOf'>, refs: readonly string[], loading: boolean): { ref: string | undefined; ready: boolean } {
    return { ref: restructureTargetOf(facts, refs), ready: !loading };
}
