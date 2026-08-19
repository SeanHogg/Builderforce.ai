import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_CEILING,
  erasureDecision,
  fieldsConfidentiality,
  fieldsMayCross,
  objectConfidentiality,
  objectMayCross,
  partitionForBoundary,
  withheldNotice,
  type ConfidentialityCandidate,
} from './canvasConfidentiality';
import { CANVAS_BOUNDARIES } from '@builderforce/creation-canvas-contract';

const node = (kind: string, confidentiality?: unknown, title = 'Card'): ConfidentialityCandidate =>
  ({ id: `${kind}-1`, data: { kind, title, ...(confidentiality === undefined ? {} : { confidentiality }) } });

describe('the level an object is held at', () => {
  it('defaults an unlabelled card to internal', () => {
    expect(objectConfidentiality(node('note'))).toBe('internal');
  });

  it('defaults the kinds where not thinking about it IS the disclosure to restricted', () => {
    for (const kind of ['case', 'compBand', 'performanceReview', 'employee', 'candidate', 'scorecard', 'offer', 'incident']) {
      expect(objectConfidentiality(node(kind))).toBe('restricted');
    }
  });

  it('defaults the two kinds whose whole purpose is publication to public', () => {
    expect(objectConfidentiality(node('jobPosting'))).toBe('public');
    expect(objectConfidentiality(node('form'))).toBe('public');
  });

  it('lets an explicit label override the kind default in both directions', () => {
    expect(objectConfidentiality(node('case', 'internal'))).toBe('internal');
    expect(objectConfidentiality(node('note', 'restricted'))).toBe('restricted');
  });

  it('falls back to the KIND DEFAULT on an unparseable value, never to public', () => {
    // The whole point: a typo must not be the thing that opens a boundary.
    expect(objectConfidentiality(node('case', 'Public'))).toBe('restricted');
    expect(objectConfidentiality(node('case', ''))).toBe('restricted');
    expect(objectConfidentiality(node('case', null))).toBe('restricted');
    expect(objectConfidentiality(node('case', 42))).toBe('restricted');
  });

  it('answers the same question from a bare field bag', () => {
    expect(fieldsConfidentiality({ kind: 'case' })).toBe('restricted');
    expect(fieldsMayCross({ kind: 'case' }, 'export')).toBe(false);
  });
});

describe('what each boundary admits', () => {
  it('lets restricted cross NOTHING', () => {
    for (const boundary of CANVAS_BOUNDARIES) {
      expect(objectMayCross(node('case'), boundary)).toBe(false);
    }
  });

  it('lets public cross everything', () => {
    for (const boundary of CANVAS_BOUNDARIES) {
      expect(objectMayCross(node('jobPosting'), boundary)).toBe(true);
    }
  });

  it('admits internal at every deliberate act and refuses it at the guest palette', () => {
    expect(objectMayCross(node('note'), 'export')).toBe(true);
    expect(objectMayCross(node('note'), 'share')).toBe(true);
    expect(objectMayCross(node('note'), 'publicMedia')).toBe(true);
    expect(objectMayCross(node('note'), 'aiContext')).toBe(true);
    // The one boundary nobody chooses card by card.
    expect(objectMayCross(node('note'), 'guest')).toBe(false);
  });

  it('states a ceiling for every declared boundary', () => {
    for (const boundary of CANVAS_BOUNDARIES) {
      expect(BOUNDARY_CEILING[boundary]).toBeTruthy();
    }
  });
});

describe('partitioning a board', () => {
  const board = [node('note', undefined, 'Launch plan'), node('case', undefined, 'Grievance — A'), node('jobPosting', undefined, 'Backend engineer')];

  it('keeps what may cross and names what may not', () => {
    const partition = partitionForBoundary(board, 'export');
    expect(partition.allowed.map((entry) => entry.id)).toEqual(['note-1', 'jobPosting-1']);
    expect(partition.withheld).toEqual([{ id: 'case-1', kind: 'case', title: 'Grievance — A', level: 'restricted' }]);
  });

  it('preserves order', () => {
    expect(partitionForBoundary(board, 'guest').allowed.map((entry) => entry.id)).toEqual(['jobPosting-1']);
  });

  it('returns no notice when nothing was withheld, so a caller cannot render "0 withheld"', () => {
    expect(withheldNotice(partitionForBoundary([node('jobPosting')], 'guest'))).toBeNull();
  });

  it('caps the notice rather than listing the board back', () => {
    const many = Array.from({ length: 9 }, (_, index) => node('case', undefined, `Case ${index}`));
    const notice = withheldNotice(partitionForBoundary(many, 'export'))!;
    expect(notice.count).toBe(9);
    expect(notice.titles).toHaveLength(5);
  });

  it('titles an untitled withheld card rather than reporting an empty string', () => {
    expect(partitionForBoundary([node('case', undefined, '')], 'export').withheld[0]!.title).toBe('(untitled)');
  });
});

describe('retention — the rule that points the other way', () => {
  it('gives a candidate an erasure right that the claim window still delays', () => {
    expect(erasureDecision('candidate', daysAgo(30)).mayErase).toBe(false);
    expect(erasureDecision('candidate', daysAgo(30)).daysRemaining).toBe(335);
    expect(erasureDecision('candidate', daysAgo(400)).mayErase).toBe(true);
  });

  it('refuses to erase an employee record however long it has run', () => {
    expect(erasureDecision('employee', daysAgo(10_000)).mayErase).toBe(false);
    expect(erasureDecision('employee', daysAgo(10_000)).rule.erasable).toBe(false);
  });

  it('measures an employment record from the end of the relationship, not creation', () => {
    expect(erasureDecision('employee', daysAgo(1)).rule.clock).toBe('relationshipEnded');
    expect(erasureDecision('candidate', daysAgo(1)).rule.clock).toBe('created');
  });

  it('erases an ordinary card on request with no waiting period', () => {
    expect(erasureDecision('note', daysAgo(0)).mayErase).toBe(true);
  });

  it('treats a missing date as day zero rather than as permission', () => {
    expect(erasureDecision('candidate', null).mayErase).toBe(false);
    expect(erasureDecision('candidate', 'not-a-date').mayErase).toBe(false);
  });
});

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}
