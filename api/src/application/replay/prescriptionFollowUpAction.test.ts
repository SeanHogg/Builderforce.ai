/**
 * Follow up → "Draft a new sequence" (PRD 33 §5.1.4, D13):
 *   • the model reads ONLY the finding and its cited evidence (no page text), and a
 *     drafted step survives only if it cites a line; at most three steps;
 *   • the draft shares THE Insights AI budget and is cached per fix;
 *   • the preview carries the draft and writes nothing;
 *   • confirm creates the sequence through THE object placement as a DRAFT cadence,
 *     THEN enrols the matched contacts into it — and nothing is sent at enrolment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  condense: vi.fn(),
  takeBudget: vi.fn(async () => {}),
  peek: vi.fn(async () => null as unknown),
  set: vi.fn(async () => {}),
  place: vi.fn(),
  preview: vi.fn(async () => ({ matched: [], unmatched: 0, draft: { subject: 's', body: 'b' }, platformLeadIds: [], enrolled: 0 })),
  enrol: vi.fn(async () => 2),
  reachable: vi.fn(async () => {}),
  loadSequence: vi.fn(async () => ({ id: 'seq', content: {}, sessionId: 'board-1' })),
  sendFromMailbox: vi.fn(),
  calls: [] as string[],
}));

vi.mock('../llm/condense', () => ({ condenseTranscript: mocks.condense }));
vi.mock('./replayAiBudget', () => ({ takeReplayAiBudget: mocks.takeBudget }));
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>()),
  peekCached: mocks.peek,
  setCached: mocks.set,
}));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.mock('../canvas/placeCanvasObject', () => ({ placeCanvasObject: mocks.place }));
vi.mock('../mailbox/mailboxService', () => ({ sendFromMailbox: mocks.sendFromMailbox }));
vi.mock('./prescriptionFollowUp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./prescriptionFollowUp')>()),
  previewFollowUp: mocks.preview,
  enrolFollowUp: mocks.enrol,
  assertFollowUpReachable: mocks.reachable,
  loadSequence: mocks.loadSequence,
}));
vi.mock('./replayTrace', () => ({ REPLAY_TRACE_VERBS: { prescriptionFollowUp: 'replay.prescription.follow-up' } }));

import { FOLLOW_UP_PRESCRIPTION_ACTION } from './prescriptionFollowUpAction';
import { draftFollowUpSequence, followUpSequenceTranscript, parseSequenceDraft } from './prescriptionFollowUpDraft';

const SITE_ID = '11111111-2222-4333-8444-555555555555';
const RX = '99999999-2222-4333-8444-555555555555';
const REC = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const NOW = new Date('2026-10-13T12:00:00.000Z');
const SCOPE = { tenantId: 7, siteId: SITE_ID };
const HOSTED = { id: SITE_ID, tenantId: 7, kind: 'hosted', projectId: 42, label: 'Shop', apiKeyId: null, settings: {}, status: 'active', createdAt: NOW.toISOString() };

const row = (over: Record<string, unknown> = {}) => ({
  id: RX, siteId: SITE_ID, ruleId: 'objection_pattern', area: 'sales', pagePath: null, status: 'proposed',
  prescription: 'Answer the price question on the plans page #0.',
  finding: {
    params: { pattern: 'Visitors ask whether the price includes setup', examples: 3 },
    evidence: [{ recordingId: REC, atMs: 65_000 }],
    selector: '#hero h1', label: 'Unlimited plans for everyone',
  },
  ...over,
});

/** A select chain answering the queued rows in order (the board lookup). */
function fakeDb(selects: unknown[][] = []) {
  const db = {
    select: () => {
      const rows = selects.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy']) chain[m] = () => chain;
      chain.limit = async () => rows;
      return chain;
    },
  };
  return db as never;
}

const ctx = (input: Record<string, unknown>, db = fakeDb()) => ({
  env: {} as never, db, scope: SCOPE, site: HOSTED as never, row: row() as never,
  refs: { taskId: null, testId: null, previewRelease: null, liveRelease: null, sequenceObjectId: null },
  input, actorId: 'u1', now: NOW,
});

const MODEL_REPLY = JSON.stringify({
  name: 'Setup costs follow-up',
  steps: [
    { delayDays: 3, subject: 'Is setup included?', body: 'Hi {{firstName}}, setup is part of every plan. {{discount}}', cites: [0] },
    { delayDays: 0, subject: 'A quick question', body: 'Hi {{firstName}}, did the pricing answer your question?', cites: [1] },
    { delayDays: 7, subject: 'Uncited', body: 'Made up', cites: [] },
    { delayDays: 9, subject: 'Out of range', body: 'Nope', cites: [42] },
  ],
});

beforeEach(() => {
  for (const fn of [mocks.condense, mocks.takeBudget, mocks.peek, mocks.set, mocks.place, mocks.preview, mocks.enrol, mocks.reachable, mocks.loadSequence, mocks.sendFromMailbox]) fn.mockClear();
  mocks.peek.mockResolvedValue(null);
  mocks.condense.mockResolvedValue({ text: MODEL_REPLY });
  mocks.calls = [];
});

describe('the drafted sequence is cited and limited', () => {
  it('reads only the finding and its cited evidence — never the element label (page text)', () => {
    const { transcript, lines } = followUpSequenceTranscript(row() as never);
    expect(transcript).toContain('[#0] finding objection_pattern: pattern=Visitors ask whether the price includes setup');
    expect(transcript).toContain('[#1] prescription: Answer the price question');
    expect(transcript).toContain(`[#2] evidence: recording ${REC} at 01:05`);
    expect(transcript).not.toContain('Unlimited plans');
    expect(lines).toBe(3);
  });

  it('keeps only steps citing a real line, strips unknown placeholders, orders by delay', () => {
    const draft = parseSequenceDraft(MODEL_REPLY, 3)!;
    expect(draft.name).toBe('Setup costs follow-up');
    expect(draft.steps).toEqual([
      { subject: 'A quick question', body: 'Hi {{firstName}}, did the pricing answer your question?', delayDays: 0 },
      { subject: 'Is setup included?', body: 'Hi {{firstName}}, setup is part of every plan.', delayDays: 3 },
    ]);
  });

  it('never keeps more than three steps, and nothing uncited', () => {
    const many = JSON.stringify({ name: 'n', steps: [0, 1, 2, 3, 4].map((d) => ({ delayDays: d, subject: `s${d}`, body: `b${d}`, cites: [0] })) });
    expect(parseSequenceDraft(many, 1)!.steps).toHaveLength(3);
    expect(parseSequenceDraft(JSON.stringify({ name: 'n', steps: [{ subject: 's', body: 'b', cites: [] }] }), 3)).toBeNull();
  });

  it('spends THE Insights AI budget once, then answers from the cache', async () => {
    const draft = await draftFollowUpSequence({} as never, 7, row() as never, NOW);
    expect(mocks.takeBudget).toHaveBeenCalledWith({}, 7, { now: NOW });
    expect(mocks.condense).toHaveBeenCalledWith({}, 7, expect.objectContaining({ transcript: expect.stringContaining('[#0] finding objection_pattern') }));
    expect(mocks.set).toHaveBeenCalledWith({}, `replay:rx-followup-draft:${RX}`, draft, expect.anything());

    mocks.peek.mockResolvedValueOnce(draft);
    mocks.takeBudget.mockClear();
    mocks.condense.mockClear();
    expect(await draftFollowUpSequence({} as never, 7, row() as never, NOW)).toBe(draft);
    expect(mocks.takeBudget).not.toHaveBeenCalled();
    expect(mocks.condense).not.toHaveBeenCalled();
  });

  it('falls back to the fixed first touch when the model gives nothing usable (and caches nothing)', async () => {
    mocks.condense.mockResolvedValueOnce({ error: 'nothing' });
    const draft = await draftFollowUpSequence({} as never, 7, row({ ruleId: 'pricing_hesitation', pagePath: '/pricing' }) as never, NOW);
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0]).toMatchObject({ subject: 'A question about pricing?', delayDays: 0 });
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe('the follow-up action', () => {
  it('previews the drafted sequence with the people, and writes nothing', async () => {
    const out = await FOLLOW_UP_PRESCRIPTION_ACTION.run(ctx({ draftSequence: true }) as never);
    expect(out.acted).toBe(false);
    expect(out.set).toEqual({});
    expect(out.result?.followUp?.draftSequence?.steps).toHaveLength(2);
    expect(mocks.place).not.toHaveBeenCalled();
    expect(mocks.enrol).not.toHaveBeenCalled();
  });

  it('a plain preview draws no model call', async () => {
    const out = await FOLLOW_UP_PRESCRIPTION_ACTION.run(ctx({}) as never);
    expect(out.result?.followUp?.draftSequence).toBeUndefined();
    expect(mocks.condense).not.toHaveBeenCalled();
  });

  it('confirm creates the edited sequence as a DRAFT cadence on the app board, THEN enrols into it — sending nothing', async () => {
    mocks.place.mockImplementation(async () => { mocks.calls.push('place'); return { objectId: 'seq-new', revision: 5, placed: true }; });
    mocks.enrol.mockImplementation(async () => { mocks.calls.push('enrol'); return 2; });
    const edited = { name: 'Setup follow-up', steps: [{ subject: 'Setup is included', body: 'Hi {{firstName}}, it is.', delayDays: 0 }, { subject: 'Still deciding?', body: 'Reply any time.', delayDays: 4 }] };
    const out = await FOLLOW_UP_PRESCRIPTION_ACTION.run(ctx({ confirm: true, newSequence: edited, contactIds: ['c-ana'] }, fakeDb([[{ sessionId: 'board-app' }]])) as never);

    expect(mocks.reachable).toHaveBeenCalledWith({}, expect.anything(), SCOPE, expect.objectContaining({ id: RX }), { contactIds: ['c-ana'], now: NOW });
    expect(mocks.calls).toEqual(['place', 'enrol']);
    const placed = mocks.place.mock.calls[0]![2] as Record<string, unknown>;
    expect(placed).toMatchObject({ sessionId: 'board-app', kind: 'sequence', resourceType: 'replay_prescription', resourceId: RX, userId: 'u1' });
    expect(placed.content).toMatchObject({
      kind: 'sequence', title: 'Setup follow-up', sequenceState: 'draft', direction: 'sales', stopOnReply: true, enrolments: [],
      steps: [
        { dayOffset: 0, channel: 'email', subject: 'Setup is included', body: 'Hi {{firstName}}, it is.' },
        { dayOffset: 4, channel: 'email', subject: 'Still deciding?', body: 'Reply any time.' },
      ],
    });
    expect(mocks.enrol).toHaveBeenCalledWith({}, expect.anything(), SCOPE, expect.objectContaining({ id: RX }), { sequenceObjectId: 'seq-new', contactIds: ['c-ana'], now: NOW });
    expect(out.set).toMatchObject({ status: 'applied', actionKind: 'follow_up', refs: { sequenceObjectId: 'seq-new' } });
    expect(out.result?.followUp?.createdSequence).toEqual({ id: 'seq-new', name: 'Setup follow-up' });
    expect(mocks.sendFromMailbox).not.toHaveBeenCalled();
  });

  it('refuses before putting anything on a board when nobody can be enrolled', async () => {
    mocks.reachable.mockRejectedValueOnce(Object.assign(new Error('none'), { name: 'ValidationError' }));
    await expect(FOLLOW_UP_PRESCRIPTION_ACTION.run(ctx({ confirm: true, newSequence: { name: 'n', steps: [{ subject: 's', body: 'b', delayDays: 0 }] } }) as never))
      .rejects.toMatchObject({ name: 'ValidationError' });
    expect(mocks.place).not.toHaveBeenCalled();
    expect(mocks.enrol).not.toHaveBeenCalled();
  });

  it('a new sequence needs a sendable step', async () => {
    await expect(FOLLOW_UP_PRESCRIPTION_ACTION.run(ctx({ confirm: true, newSequence: { name: 'n', steps: [{ subject: ' ', body: '', delayDays: 0 }] } }) as never))
      .rejects.toMatchObject({ name: 'ValidationError' });
    expect(mocks.place).not.toHaveBeenCalled();
  });

  it('an existing sequence is still enrolled into directly', async () => {
    const SEQ = 'bbbbbbbb-cccc-4ddd-8eee-000000000001';
    await FOLLOW_UP_PRESCRIPTION_ACTION.run(ctx({ confirm: true, sequenceObjectId: SEQ }) as never);
    expect(mocks.place).not.toHaveBeenCalled();
    expect(mocks.enrol).toHaveBeenCalledWith({}, expect.anything(), SCOPE, expect.anything(), expect.objectContaining({ sequenceObjectId: SEQ }));
  });
});
