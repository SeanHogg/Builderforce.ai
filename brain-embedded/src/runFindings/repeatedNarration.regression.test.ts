/**
 * `repeated_narration` reports exactly what memory's B7 fold (`foldRepeatedNarration`) folds — one similarity,
 * not a second detector that disagrees with the fold.
 */
import { describe, expect, it } from 'vitest';
import { detectRunFindings } from './detectRunFindings';
import { TraceBuilder, type BuiltCall } from './fixtures/traceBuilder';

const write = (path: string): BuiltCall => ({ name: 'write_file', args: { path, content: 'export const a = 1;\n' } });
const narration = (b: TraceBuilder) =>
  detectRunFindings(b.events, b.messages()).findings.filter((f) => f.kind === 'repeated_narration');

describe('repeated_narration agrees with the B7 fold', () => {
  it('regression: a high min-set overlap the fold keeps (Jaccard under the threshold, not contained) is not a repeat', () => {
    // Old overlap coefficient: 4/5 = 0.8 (fired). Jaccard: 4/9, and neither set contains the other: the fold keeps it.
    const b = new TraceBuilder()
      .turn({ role: 'code', calls: [write('a.ts')], text: 'alpha beta gamma delta epsilon' })
      .turn({ role: 'code', calls: [write('b.ts')], text: 'alpha beta gamma delta zeta theta iota kappa' });
    expect(narration(b)).toEqual([]);
  });

  it('regression: a narration that is the previous one plus a qualifier is a repeat (containment)', () => {
    const b = new TraceBuilder()
      .turn({ role: 'code', calls: [write('a.ts')], text: 'Continuing the wiring.' })
      .turn({ role: 'code', calls: [write('b.ts')], text: 'Continuing the wiring once more, now.' });
    expect(narration(b)[0]).toMatchObject({ params: { turns: 2 } });
  });

  it('regression: a turn the fold ignores (no calls) never becomes the original a repeat names', () => {
    const b = new TraceBuilder()
      .turn({ role: 'code', calls: [write('a.ts')], text: 'Continuing with the wiring of the panel.' })
      .turn({ role: 'code', calls: [], text: 'Continuing with the wiring of the panel.' })
      .turn({ role: 'code', calls: [write('c.ts')], text: 'Continuing with the wiring of the panel.' });
    const [found] = narration(b);
    expect(found).toMatchObject({ params: { turns: 2 } });
    // Turns are 1-based: the call-less middle turn (2) is not the original; turn 1 is.
    expect(found!.evidence.map((e) => e.turn)).toEqual([1, 3]);
  });

  it('regression: a repeat is matched against the last KEPT narration, as the fold does', () => {
    const b = new TraceBuilder()
      .turn({ role: 'code', calls: [write('a.ts')], text: 'Continuing with the wiring of the panel.' })
      .turn({ role: 'code', calls: [write('b.ts')], text: 'Continuing with the wiring of the panel.' })
      .turn({ role: 'code', calls: [write('c.ts')], text: 'Continuing with the wiring of the panel.' });
    expect(narration(b)[0]).toMatchObject({ params: { turns: 3 } });
  });
});
