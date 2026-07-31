import { describe, it, expect } from 'vitest';
import {
  consolidationMetadata,
  consolidationMarkerContent,
  isConsolidationMarker,
  lastConsolidationIndex,
  scopeToConsolidation,
  CONSOLIDATION_MARKER_PREFIX,
} from './consolidation';

const msg = (content: string, metadata: string | null = null) => ({ content, metadata });

describe('consolidation markers', () => {
  it('flags a message tagged in metadata', () => {
    expect(isConsolidationMarker(msg('x', consolidationMetadata()))).toBe(true);
    expect(isConsolidationMarker(msg('x', null))).toBe(false);
    expect(isConsolidationMarker(msg('x', '{"feedback":"up"}'))).toBe(false);
    expect(isConsolidationMarker(msg('x', 'not json'))).toBe(false);
  });

  it('finds the LAST marker index', () => {
    const list = [
      msg('a'),
      msg('sum1', consolidationMetadata()),
      msg('b'),
      msg('sum2', consolidationMetadata()),
      msg('c'),
    ];
    expect(lastConsolidationIndex(list)).toBe(3);
    expect(lastConsolidationIndex([msg('a'), msg('b')])).toBe(-1);
  });

  it('scopes the seed from the last marker (inclusive)', () => {
    const list = [msg('a'), msg('b'), msg('sum', consolidationMetadata()), msg('c')];
    expect(scopeToConsolidation(list).map((m) => m.content)).toEqual(['sum', 'c']);
  });

  it('returns the full list unchanged when there is no marker', () => {
    const list = [msg('a'), msg('b')];
    expect(scopeToConsolidation(list)).toBe(list);
  });

  it('wraps a summary with the visible marker prefix', () => {
    const content = consolidationMarkerContent('  hello  ');
    expect(content).toBe(`${CONSOLIDATION_MARKER_PREFIX}hello`);
  });
});
