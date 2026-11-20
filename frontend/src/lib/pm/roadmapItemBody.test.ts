import { describe, expect, it } from 'vitest';
import { roadmapItemBody, roadmapStatusForDisplay, roadmapStatusIsOffVocabulary } from './roadmapItemBody';

const draft = { title: '  Billing  ', horizon: 'next', status: 'in progress', theme: '', targetDate: '' };

describe('roadmapItemBody', () => {
  it('regression: a title-only edit omits status, so a legacy stored value is not rewritten or refused', () => {
    const body = roadmapItemBody(draft, { isEdit: true, statusChanged: false });
    expect(body).not.toHaveProperty('status');
    expect(body).toMatchObject({ title: 'Billing', horizon: 'next', theme: null, targetDate: null });
  });

  it('an edit that picked a status sends it', () => {
    expect(roadmapItemBody({ ...draft, status: 'shipped' }, { isEdit: true, statusChanged: true })).toMatchObject({ status: 'shipped' });
  });

  it('a create always sends a status from the vocabulary', () => {
    expect(roadmapItemBody({ ...draft, status: '' }, { isEdit: false, statusChanged: false })).toMatchObject({ status: 'planned' });
  });
});

describe('roadmapStatusForDisplay', () => {
  it('shows a known status as is and an off-vocabulary one as the first choice (display only)', () => {
    expect(roadmapStatusForDisplay('shipped')).toBe('shipped');
    expect(roadmapStatusForDisplay('in progress')).toBe('planned');
    expect(roadmapStatusForDisplay('')).toBe('planned');
  });

  it('regression: a legacy delivered spelling or another case displays as shipped', () => {
    for (const stored of ['done', 'released', 'completed', 'complete', 'Shipped', 'RELEASED']) {
      expect(roadmapStatusForDisplay(stored), stored).toBe('shipped');
    }
    expect(roadmapStatusForDisplay('In_Progress')).toBe('in_progress');
  });
});

describe('roadmapStatusIsOffVocabulary', () => {
  it('regression: a stored off-vocabulary status is flagged, so the select shows it instead of passing it off as planned', () => {
    expect(roadmapStatusIsOffVocabulary('in progress')).toBe(true);
    expect(roadmapStatusIsOffVocabulary('someday')).toBe(true);
  });

  it('a known status, a legacy alias, or an empty (new item) status is not off-vocabulary', () => {
    for (const status of ['planned', 'In_Progress', 'shipped', 'released', 'Done', '', '  ']) {
      expect(roadmapStatusIsOffVocabulary(status), status).toBe(false);
    }
  });
});
