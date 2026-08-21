import { describe, expect, it } from 'vitest';
import {
  CREATION_OBJECT_KINDS, SEQUENCE_DIRECTIONS, SHARED_OBJECT_KINDS, renameLegacyKind,
} from '@builderforce/creation-canvas-contract';
import { SHARED_OBJECT_SPECS, SHARED_LABELS, SHARED_STATUSES } from './sharedCanvasObjects';
import './specObjectSets';
import { EMPTY_SPEC_BOARD, specFieldValue, specMutableFields, specObjectNamespace } from './specObjects';

const spec = (kind: string) => SHARED_OBJECT_SPECS.find((entry) => entry.kind === kind);

describe('the cross-domain vocabulary', () => {
  it('declares one spec per contract kind, and no more', () => {
    expect(SHARED_OBJECT_SPECS.map((entry) => entry.kind).sort()).toEqual([...SHARED_OBJECT_KINDS].sort());
  });

  it('has a label and a status fallback for every kind', () => {
    for (const entry of SHARED_OBJECT_SPECS) {
      expect(SHARED_LABELS[entry.kind]).toBeTruthy();
      expect(SHARED_STATUSES[entry.defaultStatus]).toBeTruthy();
    }
  });

  it('resolves every kind under the shared i18n namespace', () => {
    for (const entry of SHARED_OBJECT_SPECS) {
      expect(specObjectNamespace(entry.kind)).toBe('creationCanvas.shared');
    }
  });
});

describe('the ONE multi-touch cadence', () => {
  it('is a single kind carrying its direction as a value', () => {
    // Two of these shipped independently — a seller's `sequence` and a recruiter's
    // `outreachSequence` — and a third was about to be written for a job seeker. That is
    // the moment a tolerated duplicate becomes a knowingly created one, which is the
    // same argument `funnel` settled for the marketing and hiring funnels.
    expect(spec('sequence')).toBeTruthy();
    expect(spec('sequence')?.fields.map((field) => field.name)).toContain('direction');
    expect(CREATION_OBJECT_KINDS).not.toContain('outreachSequence');
  });

  it('registers `sequence` exactly once across every vocabulary', () => {
    expect(CREATION_OBJECT_KINDS.filter((kind) => kind === 'sequence')).toHaveLength(1);
  });

  it('migrates a board a recruiter saved before the merge', () => {
    // A kind the registry no longer knows renders as nothing, so the rename is a
    // read-time map over durable rows — the same mechanism `interview` needed.
    expect(renameLegacyKind('outreachSequence')).toBe('sequence');
    expect(renameLegacyKind('sequence')).toBe('sequence');
  });

  it('serves the seeker the recruiter was already served', () => {
    // The direction that did not exist before, and the whole reason this was a merge
    // rather than a third kind.
    expect([...SEQUENCE_DIRECTIONS]).toEqual(['sales', 'hiring', 'seeking', 'support']);
  });

  it('still refuses to let a model edit the runner cursor', () => {
    // Carried over from the sell-motion spec and load-bearing: editing enrolments could
    // re-send a breakup email to somebody who already replied, which is the one outreach
    // failure that loses a deal outright.
    expect(specMutableFields('sequence')).not.toContain('enrolments');
    expect(specMutableFields('sequence')).toContain('direction');
  });

  it('never starts a blank cadence in a state that sends', () => {
    // Only `running` makes the runner send, so a default claiming it would put a card
    // that looks live in front of somebody who has written no steps.
    expect(spec('sequence')?.defaultStatus).toBe('draft');
    expect(SHARED_STATUSES.draft?.toLowerCase()).not.toBe('running');
  });

  it('is reachable from the section every one of its audiences opens', () => {
    // A kind lives in exactly one palette section. `Revenue` hides it from a recruiter
    // and `Hiring` hides it from a seller; `Integrations` is where `inbox`,
    // `emailCampaign` and `socialCampaign` already are.
    expect(spec('sequence')?.group).toBe('Integrations');
  });
});

describe('the shared funnel', () => {
  it('is still ONE kind carrying its domain as a value', () => {
    expect(spec('funnel')?.fields.map((field) => field.name)).toContain('funnelDomain');
    expect(CREATION_OBJECT_KINDS).not.toContain('hiringFunnel');
    expect(CREATION_OBJECT_KINDS).not.toContain('marketingFunnel');
  });
});

describe('the ONE poll — the fold that ended a duplicate declaration', () => {
  const value = (name: string, data: Record<string, unknown>) => {
    const field = spec('poll')?.fields.find((entry) => entry.name === name);
    return field ? specFieldValue(field, data, EMPTY_SPEC_BOARD) : undefined;
  };
  const QUIZ = {
    kind: 'poll', title: 'Q1', pollFormat: 'quiz',
    options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', correct: true }],
    results: [{ label: 'A', value: 3 }, { label: 'B', value: 9 }],
  };

  it('is declared exactly once, by the cross-domain vocabulary', () => {
    // The defect this closes: `poll` was declared as a teaching kind AND as the
    // facilitation primitive, and `CREATION_OBJECT_KINDS` concatenates both lists — so
    // the registry indexed one kind twice and whichever spec loaded last silently won.
    expect(CREATION_OBJECT_KINDS.filter((kind) => kind === 'poll')).toEqual(['poll']);
    expect(SHARED_OBJECT_KINDS).toContain('poll');
    expect(specObjectNamespace('poll')).toBe('creationCanvas.shared');
  });

  it('keeps the one number the lecture poll had that this one did not', () => {
    expect(value('correctRate', QUIZ)).toBe(75);
  });

  it('reports nothing rather than a rate on a poll with no right answer', () => {
    expect(value('correctRate', { ...QUIZ, options: [{ id: 'a', label: 'A' }] })).toBeUndefined();
    // No votes yet is not "0% correct" — it is nobody having answered.
    expect(value('correctRate', { ...QUIZ, results: [] })).toBeUndefined();
  });

  it('will not let a model write a result somebody typed', () => {
    for (const field of ['results', 'responseCount', 'answers', 'joinUrl', 'correctRate']) {
      expect(specMutableFields('poll'), field).not.toContain(field);
    }
  });
});
