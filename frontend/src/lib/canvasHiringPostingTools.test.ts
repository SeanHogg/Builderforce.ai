/**
 * FO-B3's projection, asserted directly.
 *
 * The tool itself needs a board and a network; these four functions do not, and they are
 * where every claim FO-B3 makes actually lives: that a count comes from the record, that
 * a card's own money and seniority prose is never parsed into a column that wants a
 * number, and that `postingId` reaches the card at all — a field silently dropped by
 * `sanitizeCreationObjectPatch` would make the whole binding a no-op that looks like a
 * success.
 */
import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import { distributionListingFromCard, distributionRowsFrom, jobPostingFieldsFrom, postingDraftFromCard, postingSummary } from './canvasHiringPostingTools';
import { creationObjectMutableFields, sanitizeCreationObjectPatch } from '@/components/creation-canvas/creationObjectRegistry';
import { HIRING_OBJECT_SPECS } from './hiringObjects';
import './specObjectSets';
import type { CanvasPosting, PostingDistribution } from './hiringApi';

const AT = '2026-08-25T09:30:00.000Z';

const posting = (over: Partial<CanvasPosting> = {}): CanvasPosting => ({
  postingId: 'e2b1c0d4-0000-4000-8000-000000000001',
  title: 'Senior React Engineer',
  status: 'open',
  postingType: 'fte',
  engagementType: 'fte',
  discipline: 'engineering',
  specialty: null,
  experienceLevel: 'expert',
  visibility: 'public',
  pipelineRef: 'e2b1c0d4-0000-4000-8000-000000000001',
  applicantCount: 41,
  activeApplicantCount: 33,
  unreviewedCount: 9,
  rejectedCount: 8,
  sources: [{ source: 'careers-site', count: 26 }, { source: 'referral', count: 15 }],
  distributions: [],
  lastApplicationAt: '2026-08-24T18:02:00.000Z',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-08-24T18:02:00.000Z',
  ...over,
});

describe('the requisition binding (FO-B3)', () => {
  it('puts the posting id and the real count on the card', () => {
    const fields = jobPostingFieldsFrom(posting(), AT);
    expect(fields.postingId).toBe('e2b1c0d4-0000-4000-8000-000000000001');
    expect(fields.applicantCount).toBe(41);
    expect(fields.status).toBe('open');
  });

  it('leaves the fields the record has no column for alone', () => {
    // The record owns status, the counts and the id. It must not be able to blank the
    // comp band, the headcount or the hiring manager a recruiter typed on the card.
    const fields = jobPostingFieldsFrom(posting(), AT);
    for (const untouched of ['compBand', 'headcount', 'hiringManager', 'targetStartDate', 'postingUrl', 'mustHaves']) {
      expect(fields).not.toHaveProperty(untouched);
    }
  });

  it('reaches the card — every field it writes is mutable on the kind', () => {
    // The failure this catches is silent by construction: `sanitizeCreationObjectPatch`
    // filters an LLM-authored patch against the kind's mutable fields, so a field marked
    // `derived` would be dropped on the way to the board and the tool would report a
    // success that changed nothing.
    const fields = jobPostingFieldsFrom(posting(), AT);
    const mutable = new Set(creationObjectMutableFields('jobPosting'));
    for (const key of Object.keys(fields)) {
      expect(mutable, `jobPosting.${key} must be writable for the sync to reach the board`).toContain(key);
    }
    // And through the real filter, which is what the canvas context actually applies.
    expect(sanitizeCreationObjectPatch('jobPosting', fields)).toEqual(fields);
  });

  it('names what was counted and when, so an old number cannot pass as live', () => {
    const summary = postingSummary(posting(), AT);
    expect(summary).toContain('41 applications');
    expect(summary).toContain('9 of them not yet looked at');
    expect(summary).toContain('careers-site');
    expect(summary).toContain('2026-08-25 09:30');
  });

  it('says nothing has been received rather than drawing a zero', () => {
    const summary = postingSummary(posting({ applicantCount: 0, activeApplicantCount: 0, unreviewedCount: 0, rejectedCount: 0, sources: [] }), AT);
    expect(summary).toContain('No applications yet');
    expect(summary).not.toContain('0 applications');
  });

  it('omits a seniority the record never stated instead of inventing one', () => {
    expect(jobPostingFieldsFrom(posting({ experienceLevel: null }), AT)).not.toHaveProperty('level');
    expect(jobPostingFieldsFrom(posting(), AT).level).toBe('expert');
  });
});

describe('the draft a board-authored card contributes', () => {
  const card = {
    employmentType: 'permanent',
    level: 'Senior (L5)',
    compBand: '£85,000–95,000, DOE',
    headcount: 2,
    summary: 'We are hiring a senior engineer for the payments surface.',
    mustHaves: ['React', 'TypeScript'],
    niceToHaves: ['Rust'],
    responsibilities: [{ title: 'Own the checkout', detail: 'End to end, including the payment retries.' }],
  };

  it('maps the employment type onto both shape columns', () => {
    const draft = postingDraftFromCard(card, 'Senior React Engineer');
    expect(draft.postingType).toBe('fte');
    expect(draft.engagementType).toBe('fte');
    expect(postingDraftFromCard({ employmentType: 'contract' }, 'X').engagementType).toBe('fixed_bid');
  });

  it('leaves both shape columns unset for an employment type it does not know', () => {
    // Not a guess and not a default: `upsertJobPosting` has its own documented fallback,
    // and a second opinion here would be a third place that decides what a posting is.
    const draft = postingDraftFromCard({ employmentType: 'secondment' }, 'X');
    expect(draft).not.toHaveProperty('postingType');
    expect(draft).not.toHaveProperty('engagementType');
  });

  it('never parses the comp band or the seniority prose into a column', () => {
    const draft = postingDraftFromCard(card, 'Senior React Engineer') as Record<string, unknown>;
    expect(draft).not.toHaveProperty('rateMinCents');
    expect(draft).not.toHaveProperty('budgetTotalCents');
    expect(draft).not.toHaveProperty('experienceLevel');
    expect(JSON.stringify(draft)).not.toContain('85');
  });

  it('screens against the must-haves only', () => {
    const draft = postingDraftFromCard(card, 'Senior React Engineer');
    expect(draft.requirements).toBe('React\nTypeScript');
    expect(draft.requirements).not.toContain('Rust');
    expect(draft.skills).toEqual(['React', 'TypeScript', 'Rust']);
  });

  it('composes a body from the pitch AND the work', () => {
    const draft = postingDraftFromCard(card, 'Senior React Engineer');
    expect(draft.description).toContain('payments surface');
    expect(draft.description).toContain('Own the checkout — End to end');
  });

  it('is empty rather than fabricated for a card with only a title', () => {
    const draft = postingDraftFromCard({}, 'Senior React Engineer');
    expect(draft).toEqual({ title: 'Senior React Engineer' });
  });
});

describe('the identity field is declared, labelled and authorable', () => {
  const spec = HIRING_OBJECT_SPECS.find((entry) => entry.kind === 'jobPosting');

  it('exists on the kind as bookkeeping, not as authored work', () => {
    const field = spec?.fields.find((entry) => entry.name === 'postingId');
    expect(field?.bookkeeping).toBe(true);
    // `derived` would keep it out of `specMutableFields` and therefore off the board.
    expect(field?.derived).toBeUndefined();
  });

  it('has a label rather than rendering its own dotted key', () => {
    expect(en.creationCanvas.hiring.field.postingId).toBeTruthy();
  });
});

const distribution = (over: Partial<PostingDistribution> = {}): PostingDistribution => ({
  postingId: 'e2b1c0d4-0000-4000-8000-000000000001',
  connectorKey: 'lever-postings',
  board: 'Lever Postings',
  connectionId: 'conn-1',
  externalId: 'lever-9',
  url: 'https://jobs.lever.co/acme/lever-9',
  status: 'posted',
  postedAt: '2026-10-09T08:00:00.000Z',
  lastError: null,
  updatedAt: '2026-10-09T08:00:00.000Z',
  applicantCount: 4,
  ...over,
});

describe('the distribution projection (FO-B4)', () => {
  it('draws the card rows from the record, with applicants attributed per board', () => {
    const rows = distributionRowsFrom([
      distribution(),
      distribution({ connectorKey: 'indeed-jobs', board: 'Indeed', status: 'failed', externalId: null, url: 'https://example.test/x', postedAt: null, lastError: 'Unauthorized', applicantCount: 0 }),
    ]);
    expect(rows).toEqual([
      { board: 'Lever Postings', status: 'posted', postedAt: '2026-10-09', url: 'https://jobs.lever.co/acme/lever-9', applicants: 4 },
      // A failed board carries no url, even if one were somehow on the row.
      { board: 'Indeed', status: 'failed', postedAt: '', url: '', applicants: 0 },
    ]);
  });

  it('is written by the sync, so the card cannot keep a publication the table does not hold', () => {
    expect(jobPostingFieldsFrom(posting(), AT).distribution).toEqual([]);
    const fields = jobPostingFieldsFrom(posting({ distributions: [distribution({ applicantCount: 2 })] }), AT);
    expect(fields.distribution).toEqual([{ board: 'Lever Postings', status: 'posted', postedAt: '2026-10-09', url: 'https://jobs.lever.co/acme/lever-9', applicants: 2 }]);
  });

  it('never names a zero-count board as where applications came from', () => {
    const summary = postingSummary(posting({
      applicantCount: 3, activeApplicantCount: 3, unreviewedCount: 0, rejectedCount: 0,
      sources: [{ source: 'indeed-jobs', count: 0, board: 'Indeed' }],
    }), AT);
    expect(summary).not.toContain('Most came from');
    expect(postingSummary(posting({ sources: [{ source: 'lever-postings', count: 26, board: 'Lever Postings' }] }), AT)).toContain('Lever Postings (26)');
  });

  it('declares a label for the applicants column', () => {
    expect(en.creationCanvas.hiring.column.applicants).toBeTruthy();
  });
});

describe('the listing a card contributes to a board', () => {
  it('sends only what the recruiter wrote', () => {
    expect(distributionListingFromCard({
      location: 'Remote (EU timezones)', employmentType: 'Permanent', level: 'Senior (L5)', postingUrl: 'https://careers.acme.test/jobs/1',
    })).toEqual({
      location: 'Remote (EU timezones)', remote: true, employmentType: 'permanent', seniority: 'Senior (L5)', applyUrl: 'https://careers.acme.test/jobs/1',
    });
  });

  it('never infers "not remote" from a city, and never sends a non-http apply link', () => {
    expect(distributionListingFromCard({ location: 'Berlin — hybrid', postingUrl: 'javascript:alert(1)' })).toEqual({ location: 'Berlin — hybrid' });
    expect(distributionListingFromCard({})).toEqual({});
  });
});
