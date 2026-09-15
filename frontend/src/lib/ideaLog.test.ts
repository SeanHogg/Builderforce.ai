import { describe, expect, it } from 'vitest';
import { IDEA_STAGES } from '@builderforce/creation-canvas-contract';
import {
  ideaFromScratch, ideaLogEntries, ideaStage, ideaStageCounts, ideaTestedBy, untestedIdeaCount, withTestedBy,
} from './ideaLog';

const idea = (id: string, data: Record<string, unknown> = {}) => ({ id, data: { kind: 'idea', title: id, ...data } });

describe('what a line typed into the scratchpad becomes', () => {
  it('titles the idea with its first line and keeps the whole note as the scratch', () => {
    const now = new Date('2026-09-15T10:00:00.000Z');
    expect(ideaFromScratch('  Dog-walking marketplace\nfor apartment towers\n\nmaybe B2B?  ', now)).toEqual({
      title: 'Dog-walking marketplace',
      scratch: 'Dog-walking marketplace\nfor apartment towers\n\nmaybe B2B?',
      stage: 'captured',
      capturedAt: '2026-09-15T10:00:00.000Z',
    });
  });

  it('clips a paragraph-long first line to one card-header line', () => {
    const long = 'x'.repeat(200);
    const captured = ideaFromScratch(long)!;
    expect(captured.title.length).toBe(80);
    expect(captured.title.endsWith('…')).toBe(true);
    // The scratch is never clipped — it is the record of what was written.
    expect(captured.scratch).toBe(long);
  });

  it('refuses blank input, so an empty card can never be captured', () => {
    expect(ideaFromScratch('')).toBeNull();
    expect(ideaFromScratch('   \n\t ')).toBeNull();
  });
});

describe('the stage vocabulary', () => {
  it('reads a stage outside the vocabulary as captured — the stage that claims the least', () => {
    expect(ideaStage({ stage: 'validated' })).toBe('validated');
    expect(ideaStage({ stage: 'in progress' })).toBe('captured');
    expect(ideaStage({})).toBe('captured');
  });

  it('counts every stage, zero included', () => {
    const counts = ideaStageCounts(ideaLogEntries([idea('a', { stage: 'parked' }), idea('b'), idea('c', { stage: 'nonsense' })]));
    expect(Object.keys(counts)).toEqual([...IDEA_STAGES]);
    expect(counts.captured).toBe(2);
    expect(counts.parked).toBe(1);
    expect(counts.promoted).toBe(0);
  });
});

describe('evidence refs', () => {
  it('deduplicates the way the board matches refs, and splits a comma-written string', () => {
    expect(ideaTestedBy({ testedBy: ['Interview: Acme', 'interview:  acme', ' ', 'Pricing test'] })).toEqual(['Interview: Acme', 'Pricing test']);
    expect(ideaTestedBy({ testedBy: 'Interview A, Interview B' })).toEqual(['Interview A', 'Interview B']);
    expect(ideaTestedBy({})).toEqual([]);
  });

  it('adds a ref once', () => {
    expect(withTestedBy({ testedBy: ['Interview A'] }, 'Interview B')).toEqual(['Interview A', 'Interview B']);
    expect(withTestedBy({ testedBy: ['Interview A'] }, 'interview a')).toEqual(['Interview A']);
  });
});

describe('the log', () => {
  it('lists only ideas, newest first, with undated ones after every dated one', () => {
    const entries = ideaLogEntries([
      idea('old', { capturedAt: '2026-09-01T00:00:00Z' }),
      { id: 'note', data: { kind: 'note', title: 'not an idea' } },
      idea('undated'),
      idea('new', { capturedAt: '2026-09-14T00:00:00Z' }),
      idea('garbage-date', { capturedAt: 'yesterday' }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(['new', 'old', 'undated', 'garbage-date']);
  });

  it('counts only OPEN ideas that name no evidence as untested', () => {
    const entries = ideaLogEntries([
      idea('open-untested'),
      idea('open-tested', { stage: 'exploring', testedBy: ['Interview A'] }),
      idea('validating-untested', { stage: 'validating' }),
      // An exit stage with no evidence is a decision already made, not a gap.
      idea('dropped', { stage: 'dropped' }),
      idea('promoted', { stage: 'promoted' }),
    ]);
    expect(untestedIdeaCount(entries)).toBe(2);
  });
});
