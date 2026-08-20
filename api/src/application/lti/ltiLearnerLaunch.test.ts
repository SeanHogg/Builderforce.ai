import { describe, expect, it, vi } from 'vitest';
import { fakeDb, whereColumns, type FakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { LtiLaunchContext } from '../../domain/lti/ltiClaims';
import {
  findLearnerSubmission, isLearnerSubmission, learnerAssignmentCopy, learnerBoardTitle,
  learnerRefKey, learnerSubmissionCopy,
} from '../../domain/lti/learnerBoards';
import { bridgeLaunch } from './ltiLaunchBridge';
import type { LtiRegistration } from './LtiService';

/**
 * What a learner's launch is allowed to reach.
 *
 * The property under test is a DISCLOSURE property, not a routing one: a
 * student's launch must land on a board that holds their own work and nothing
 * else. Two of these tests would still pass if the bridge simply opened the
 * cohort board, so each one asserts what was NOT written as well as where the
 * launch went — the classmate's submission, and the mark on it.
 *
 * The database is doubled rather than stood up: every decision here is about
 * which rows are read and what content is composed from them, and a real Postgres
 * would test Neon instead of the rules. `resolveSegment` is mocked because it
 * memoises per tenant in the isolate, which would make the queue a test consumed
 * depend on which test ran first.
 */

vi.mock('../../infrastructure/auth/segmentResolver', () => ({
  resolveSegment: async () => 'segment-1',
}));

const TENANT = 7;
const BINDING_ID = 11;
const COHORT_SESSION = '00000000-0000-4000-8000-0000000000c0';
const LEARNER_SESSION = '00000000-0000-4000-8000-0000000000e1';

const REGISTRATION: LtiRegistration = {
  id: 3,
  label: 'University LMS',
  issuer: 'https://lms.university.edu',
  clientId: 'builderforce-tool',
  deploymentIds: ['dep-1'],
  authLoginUrl: 'https://lms.university.edu/authorize',
  accessTokenUrl: 'https://lms.university.edu/token',
  keySetUrl: 'https://lms.university.edu/jwks',
  toolKeyId: 'tool-1',
  toolPublicJwk: { kty: 'RSA' },
  tenantId: TENANT,
};

const learnerLaunch = (over: Partial<LtiLaunchContext> = {}): LtiLaunchContext => ({
  messageType: 'LtiResourceLinkRequest',
  issuer: REGISTRATION.issuer,
  clientId: REGISTRATION.clientId,
  deploymentId: 'dep-1',
  subject: 'S1234567',
  name: 'Alex Learner',
  email: 'alex@university.edu',
  roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
  capability: 'learn',
  contextId: 'course-99',
  contextLabel: 'PHYS2041',
  contextTitle: 'Quantum Mechanics',
  resourceLinkId: 'link-1',
  resourceLinkTitle: 'Essay 1',
  targetLinkUri: 'https://api.builderforce.ai/api/lti/launch',
  lineItemsUrl: null,
  lineItemUrl: 'https://lms.university.edu/lineitems/42',
  agsScopes: [],
  membershipsUrl: null,
  custom: {},
  ...over,
});

/** The cohort board's `assignment` object, as a staff launch left it. */
const ASSIGNMENT_CONTENT = {
  title: 'Essay 1',
  status: 'published',
  brief: 'Derive the time-independent Schrödinger equation.',
  cohortRef: 'PHYS2041',
  ltiLineItemUrl: 'https://lms.university.edu/lineitems/42',
};

/** What `assignment.distribute` wrote for our learner, and for a classmate. */
const OWN_SUBMISSION = {
  title: 'Alex Learner — Essay 1',
  learnerRef: 'S1234567',
  learnerName: 'Alex Learner',
  assignmentRef: 'Essay 1',
  status: 'notSubmitted',
  declaration: 'Written by me.',
};
const CLASSMATE_SUBMISSION = {
  title: 'Jordan Other — Essay 1',
  learnerRef: 'S7654321',
  learnerName: 'Jordan Other',
  assignmentRef: 'Essay 1',
  mark: 82,
  feedback: 'Excellent derivation.',
};

/** `fakeDb` plus the `batch` a board insert issues. The batched statements are
 *  built (and therefore recorded in `calls`) before `batch` is called, so the
 *  double consumes nothing for them and the queue stays readable. */
function bridgeDb(results: Array<unknown[] | Error>): FakeDb & { batch: (s: unknown[]) => Promise<unknown[]> } {
  return Object.assign(fakeDb(results), { batch: async (_statements: unknown[]) => [] });
}

/** The rows handed to the one `insert` that writes canvas objects. */
function seededObjects(db: FakeDb): Array<Record<string, unknown>> {
  const call = db.calls.find((entry) => entry.kind === 'insert' && Array.isArray(entry.payload));
  return (call?.payload as Array<Record<string, unknown>> | undefined) ?? [];
}

/** The queue every learner launch consumes before it reaches its own decision:
 *  the OAuth binding, the workspace membership, the course binding, the resource
 *  binding and the assignment object. */
const preamble = (): Array<unknown[]> => [
  [{ userId: 'user-alex' }],
  [{ id: 1 }],
  [{ id: BINDING_ID, tenantId: TENANT, sessionId: COHORT_SESSION, cohortObjectId: 'cohort-1' }],
  [{ id: 21, assignmentObjectId: 'assignment-1' }],
  [{ content: ASSIGNMENT_CONTENT }],
];

describe('learnerRefKey', () => {
  it('normalises exactly as the canvas `specRefKey` does', () => {
    expect(learnerRefKey('  Essay   1 ')).toBe('essay 1');
    expect(learnerRefKey('ESSAY 1')).toBe(learnerRefKey('essay 1'));
    expect(learnerRefKey(null)).toBe('');
  });

  it('clamps to the column width on both sides of the join, so a long title still matches itself', () => {
    const long = `${'x'.repeat(400)} tail`;
    expect(learnerRefKey(long)).toHaveLength(160);
    expect(learnerRefKey(learnerRefKey(long))).toBe(learnerRefKey(long));
  });
});

describe('isLearnerSubmission', () => {
  it('needs BOTH refs to match', () => {
    expect(isLearnerSubmission(OWN_SUBMISSION, 'essay 1', 's1234567')).toBe(true);
    expect(isLearnerSubmission(CLASSMATE_SUBMISSION, 'essay 1', 's1234567')).toBe(false);
    expect(isLearnerSubmission(OWN_SUBMISSION, 'essay 2', 's1234567')).toBe(false);
  });

  it('refuses to match on an empty key rather than matching everything', () => {
    expect(isLearnerSubmission({ assignmentRef: '', learnerRef: '' }, '', '')).toBe(false);
  });

  it('picks the learner\'s own row out of a cohort\'s worth of submissions', () => {
    const found = findLearnerSubmission(
      [
        { objectId: 'other', content: CLASSMATE_SUBMISSION },
        { objectId: 'mine', content: OWN_SUBMISSION },
      ],
      'essay 1',
      's1234567',
    );
    expect(found?.objectId).toBe('mine');
  });
});

describe('what may be copied onto a learner board', () => {
  it('drops the marking a marker wrote and keeps the learner\'s own substance', () => {
    const copy = learnerSubmissionCopy({ ...OWN_SUBMISSION, mark: 61, feedback: 'Provisional.', placements: [{ criterion: 'Rigour' }] });
    expect(copy).not.toHaveProperty('mark');
    expect(copy).not.toHaveProperty('feedback');
    expect(copy).not.toHaveProperty('placements');
    expect(copy.declaration).toBe('Written by me.');
  });

  it('drops the AGS line item from the brief — a grade-write endpoint is not a brief', () => {
    const copy = learnerAssignmentCopy(ASSIGNMENT_CONTENT);
    expect(copy).not.toHaveProperty('ltiLineItemUrl');
    expect(copy.brief).toBe(ASSIGNMENT_CONTENT.brief);
  });

  it('titles the board after the work, not after the learner', () => {
    expect(learnerBoardTitle('Essay 1', 'Quantum Mechanics')).toBe('Essay 1 — Quantum Mechanics');
    expect(learnerBoardTitle('  ', '')).toBe('Assignment');
  });
});

describe('bridgeLaunch · a learner', () => {
  it('resumes the board already recorded for them, and mints nothing', async () => {
    const db = bridgeDb([
      ...preamble(),
      [{ id: 55, sessionId: LEARNER_SESSION, learnerUserId: 'user-alex' }],
      [],
    ]);

    const result = await bridgeLaunch(db as unknown as Db, REGISTRATION, learnerLaunch());

    expect(result).toMatchObject({ ok: true, sessionId: LEARNER_SESSION, redirect: `/create/${LEARNER_SESSION}`, capability: 'learn' });
    // No board was created: nothing inserted a set of canvas objects.
    expect(seededObjects(db)).toEqual([]);
    // The lookup is tenant-scoped AND keyed on the normalised refs.
    const lookup = db.calls.find((entry) => entry.kind === 'select'
      && whereColumns(entry.where).includes('learner_ref'));
    expect(whereColumns(lookup?.where)).toEqual(
      expect.arrayContaining(['tenant_id', 'binding_id', 'assignment_ref', 'learner_ref']),
    );
  });

  it('mints their own board from the distributed submission, and copies nobody else\'s work', async () => {
    const db = bridgeDb([
      ...preamble(),
      [],
      [
        { id: 'obj-other', content: CLASSMATE_SUBMISSION },
        { id: 'obj-mine', content: { ...OWN_SUBMISSION, mark: 55, feedback: 'Not released yet.' } },
      ],
      [{ id: 91 }],
    ]);

    const result = await bridgeLaunch(db as unknown as Db, REGISTRATION, learnerLaunch());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirect).toBe(`/create/${result.sessionId}`);
    expect(result.sessionId).not.toBe(COHORT_SESSION);

    const objects = seededObjects(db);
    expect(objects.map((object) => object.kind)).toEqual(['assignment', 'submission']);

    // No cohort object: the cohort IS the roster.
    expect(objects.some((object) => object.kind === 'cohort')).toBe(false);

    const submission = objects.find((object) => object.kind === 'submission')?.content as Record<string, unknown>;
    expect(submission.learnerRef).toBe('S1234567');
    // The classmate's work and mark are nowhere on the board.
    const serialised = JSON.stringify(objects);
    expect(serialised).not.toContain('S7654321');
    expect(serialised).not.toContain('Jordan Other');
    expect(serialised).not.toContain('Excellent derivation');
    // Nor is their OWN provisional mark: it reaches them through the gradebook.
    expect(submission).not.toHaveProperty('mark');
    expect(submission).not.toHaveProperty('feedback');

    // And the board was remembered, under the normalised refs.
    const recorded = db.calls.find((entry) => entry.kind === 'insert'
      && !!entry.payload && !Array.isArray(entry.payload)
      && 'learnerRef' in (entry.payload as Record<string, unknown>));
    expect(recorded?.payload).toMatchObject({
      tenantId: TENANT,
      bindingId: BINDING_ID,
      assignmentRef: 'essay 1',
      learnerRef: 's1234567',
      learnerUserId: 'user-alex',
    });
  });

  it('refuses honestly when the instructor has not distributed the work yet', async () => {
    const db = bridgeDb([
      ...preamble(),
      [],
      [{ id: 'obj-other', content: CLASSMATE_SUBMISSION }],
    ]);

    const result = await bridgeLaunch(db as unknown as Db, REGISTRATION, learnerLaunch());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error).toContain('has not handed this assignment out yet');
    // The refusal no longer promises a destination that does not exist.
    expect(result.error).not.toContain('open the assignment in your LMS');
    expect(seededObjects(db)).toEqual([]);
  });

  it('never opens the cohort board — a course-navigation launch has no assignment to open', async () => {
    const db = bridgeDb([
      [{ userId: 'user-alex' }],
      [{ id: 1 }],
      [{ id: BINDING_ID, tenantId: TENANT, sessionId: COHORT_SESSION, cohortObjectId: 'cohort-1' }],
    ]);

    const result = await bridgeLaunch(db as unknown as Db, REGISTRATION, learnerLaunch({ resourceLinkId: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('has not been opened on Builderforce yet');
  });
});
