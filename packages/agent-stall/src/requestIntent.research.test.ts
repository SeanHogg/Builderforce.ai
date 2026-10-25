import { describe, expect, it } from 'vitest';
import { asksForChange } from './requestIntent';

// A research brief asks for findings, not an effect on the world — whoever wrote it: the
// person, or an owner briefing a sub-agent. "Research X and write a summary" names a
// change verb only for the report it wants back.
describe('asksForChange — research shapes are questions', () => {
  it('reads a research brief as a question', () => {
    for (const t of [
      'Research how the run store persists steps and write a summary with file paths.',
      'Investigate why the fold drops messages',
      'Find every caller of buildWorkingTranscript',
      'Trace the abort signal from the composer to the shell',
      'Audit the tool catalog for duplicate names',
      'Look into the failing CI job',
    ]) expect(asksForChange(t)).toBe(false);
  });

  it('still reads a work order as a change request', () => {
    expect(asksForChange('Implement WS1: write the contract and the package skeleton')).toBe(true);
    expect(asksForChange('Fix the fold so it never drops a message')).toBe(true);
  });
});
