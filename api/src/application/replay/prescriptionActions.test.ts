/**
 * The prescription actions and their human gates (PRD 33 §5.1.4, D13):
 *   • Fix it opens a ticket with the brief and the replay-moment trailer, and
 *     dispatches a coding agent ONLY for a hosted site with a chosen agent — to
 *     build a PREVIEW; nothing goes live from Fix it;
 *   • Publish moves the live pointer only on a person's call, once a preview exists;
 *   • Test it creates a DRAFT test; only Start makes it run;
 *   • Follow up shows who and what first, and enrols only matched contacts;
 *   • Dismiss needs a reason; every action is traced `replay.prescription.<action>`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  row: null as unknown as Record<string, unknown>,
  site: null as unknown as Record<string, unknown>,
  createTask: vi.fn(),
  dispatch: vi.fn(),
  trace: vi.fn(async () => {}),
  createPrescriptionTest: vi.fn(async () => 55),
  startPrescriptionTest: vi.fn(async () => {}),
  moveSiteTo: vi.fn(async () => {}),
  liveVersionToken: vi.fn(async () => 'live-token'),
  previewFollowUp: vi.fn(async () => ({ matched: [], unmatched: 0, draft: { subject: 's', body: 'b' }, platformLeadIds: [], enrolled: 0 })),
  enrolFollowUp: vi.fn(async () => 2),
  resolveKnownContacts: vi.fn(),
}));

vi.mock('../task/TaskService', () => ({
  TaskService: vi.fn(function TaskService() { return { createTask: mocks.createTask }; }),
}));
vi.mock('../task/taskCreationHook', () => ({ taskCreatedHook: () => undefined }));
vi.mock('../../infrastructure/repositories/TaskRepository', () => ({ TaskRepository: vi.fn() }));
vi.mock('../../infrastructure/repositories/ProjectRepository', () => ({ ProjectRepository: vi.fn() }));
vi.mock('../runtime/dispatchCloudRun', () => ({
  dispatchCloudRunForTask: mocks.dispatch,
  dispatchError: (e: unknown) => ({ executionId: null, refusal: { reason: 'dispatch_error', message: String(e) } }),
}));
vi.mock('../../buildRuntimeService', () => ({ buildRuntimeService: () => ({}) }));
vi.mock('../activity/activityLog', () => ({
  resolveHumanActor: vi.fn(async (_e: unknown, _d: unknown, _t: number, id: string) => ({ type: 'human', ref: id, name: id })),
  SYSTEM_ACTOR: { type: 'system', ref: null, name: 'System' },
}));
vi.mock('./replaySites', () => ({ getSiteForTenant: vi.fn(async () => mocks.site) }));
vi.mock('./prescriptionReads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./prescriptionReads')>()),
  loadPrescriptionRow: vi.fn(async () => mocks.row),
}));
vi.mock('./prescriptionReleases', () => ({
  createPrescriptionTest: mocks.createPrescriptionTest,
  startPrescriptionTest: mocks.startPrescriptionTest,
  moveSiteTo: mocks.moveSiteTo,
  liveVersionToken: mocks.liveVersionToken,
  hostedProjectOf: (site: { projectId: number }) => site.projectId,
}));
vi.mock('./prescriptionFollowUp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./prescriptionFollowUp')>()),
  previewFollowUp: mocks.previewFollowUp,
  enrolFollowUp: mocks.enrolFollowUp,
}));
vi.mock('./resolveKnownContacts', () => ({ resolveKnownContacts: mocks.resolveKnownContacts }));
vi.mock('./replayTrace', () => ({
  recordReplayTrace: mocks.trace,
  REPLAY_TRACE_VERBS: {
    prescriptionFix: 'replay.prescription.fix', prescriptionTest: 'replay.prescription.test',
    prescriptionStartTest: 'replay.prescription.start-test', prescriptionFollowUp: 'replay.prescription.follow-up',
    prescriptionTicket: 'replay.prescription.ticket', prescriptionDismiss: 'replay.prescription.dismiss',
    prescriptionPublishPreview: 'replay.prescription.publish-preview', prescriptionRevert: 'replay.prescription.revert',
    prescriptionCopyPrompt: 'replay.prescription.copy-prompt', prescriptionApplyPage: 'replay.prescription.apply-page',
    prescriptionApplyInComposer: 'replay.prescription.apply-in-composer',
  },
}));
const pageMocks = vi.hoisted(() => ({
  prescriptionPrompt: vi.fn(async (_e: unknown, _d: unknown, _s: unknown, id: string, audience: string) => ({
    audience, prompt: `PROMPT ${audience} ${id}`, selectors: ['getByRole("button", { name: "Pay" })'], prescriptionIds: [id],
  })),
  pagePrompt: vi.fn(async (_e: unknown, _d: unknown, _s: unknown, _path: string, audience: string) => ({
    audience, prompt: `PAGE ${audience}`, selectors: ['a', 'b'], prescriptionIds: ['99999999-2222-4333-8444-555555555555', 'other-rx'],
  })),
}));
vi.mock('./pagePrompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pagePrompts')>()),
  prescriptionPrompt: pageMocks.prescriptionPrompt,
  pagePrompt: pageMocks.pagePrompt,
}));
vi.mock('./ReplayReadService', () => ({
  ReplayReadService: vi.fn(function ReplayReadService() { return { releases: async () => [{ releaseKey: 'r9' }] }; }),
}));
vi.mock('./ReplayHeatmapService', () => ({
  ReplayHeatmapService: vi.fn(function ReplayHeatmapService() { return { routes: async () => [{ route: '/' }] }; }),
}));

import { replayMomentFromDescription } from '@builderforce/interaction-contract';
import { runPrescriptionAction } from './prescriptionActions';

const SITE_ID = '11111111-2222-4333-8444-555555555555';
const RX = '99999999-2222-4333-8444-555555555555';
const SCOPE = { tenantId: 7, siteId: SITE_ID };
const NOW = new Date('2026-10-13T12:00:00.000Z');
const HOSTED = { id: SITE_ID, tenantId: 7, kind: 'hosted', projectId: 42, label: 'Shop', status: 'active' };
const EXTERNAL = { id: SITE_ID, tenantId: 7, kind: 'external', projectId: null, label: 'shop.example', status: 'active' };

function baseRow(over: Record<string, unknown> = {}) {
  return {
    id: RX, siteId: SITE_ID, ruleId: 'rage_on_element', area: 'ux', source: 'rule', subjectKey: '/checkout|button.pay', pagePath: '/checkout',
    captureId: null, status: 'proposed', prescription: 'Make Pay respond #0.', change: { kind: 'code', target: 'button.pay', description: 'Debounce' },
    visual: null, impact: { estimate: 4, low: 1, high: 8, unit: 'conversions', confidence: 'medium', horizonDays: 30, estimated: true },
    finding: { params: { route: '/checkout', share: 5 }, evidence: [{ recordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001', atMs: 6000 }], selector: 'button.pay', label: 'Pay', issueId: 'i1' },
    actionKind: null, actionRef: null, acceptance: { metric: 'rage_rate', direction: 'down', minVisits: 200 },
    measured: null, dismissReason: null, decidedBy: null, createdAt: NOW, updatedAt: NOW,
    ...over,
  };
}

/** select → queued rows; update records its set and returns the row with it applied. */
function fakeDb(selects: unknown[][] = []) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => {
      const rows = selects.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'innerJoin']) chain[m] = () => chain;
      chain.limit = async () => rows;
      return chain;
    },
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updates.push(set);
        return { where: () => ({ returning: async () => [{ ...mocks.row, ...set }] }) };
      },
    }),
  };
  return { db: db as never, updates };
}

const act = (db: never, action: string, input: Record<string, unknown> = {}) =>
  runPrescriptionAction({} as never, db, SCOPE, RX, action, input, { actorId: 'u1', now: NOW });

beforeEach(() => {
  mocks.row = baseRow();
  mocks.site = HOSTED;
  for (const fn of [mocks.createTask, mocks.dispatch, mocks.trace, mocks.createPrescriptionTest, mocks.startPrescriptionTest, mocks.moveSiteTo, mocks.previewFollowUp, mocks.enrolFollowUp]) fn.mockClear();
  mocks.createTask.mockResolvedValue({ toPlain: () => ({ id: 77 }) });
  mocks.dispatch.mockResolvedValue({ executionId: 900 });
});

describe('fix', () => {
  it('on a hosted app with a chosen agent: a ticket with the brief + moment, and a run that builds a PREVIEW', async () => {
    const { db, updates } = fakeDb([[{ id: 'agent-1' }]]);
    const out = await act(db, 'fix', { agentRef: 'agent-1' });

    const [dto, tenantId] = mocks.createTask.mock.calls[0]!;
    expect(tenantId).toBe(7);
    expect(dto).toMatchObject({ projectId: 42, assignedAgentRef: 'agent-1', createdVia: 'insights_prescription' });
    expect(dto.description).toContain('PREVIEW');
    expect(dto.description).toContain('Make Pay respond #0.');
    expect(replayMomentFromDescription(dto.description)).toMatchObject({ siteId: SITE_ID, releaseKey: 'r9', route: '/checkout', metric: 'frustrated' });

    const params = mocks.dispatch.mock.calls[0]![4];
    expect(params).toMatchObject({ taskId: 77, tenantId: 7 });
    expect(JSON.parse(params.payload)).toMatchObject({ cloudAgentRef: 'agent-1', prescriptionFix: { prescriptionId: RX, preview: true } });
    expect(mocks.moveSiteTo).not.toHaveBeenCalled(); // nothing goes live from Fix it

    expect(updates[0]).toMatchObject({ status: 'applied', actionKind: 'fix', actionRef: 't=77' });
    expect(out).toMatchObject({ taskId: 77, executionId: 900, refusal: null });
    expect(mocks.trace).toHaveBeenCalledWith({}, db, expect.objectContaining({ verb: 'replay.prescription.fix', siteId: SITE_ID, actorId: 'u1' }));
  });

  it('without an agent, or on an external site, is a ticket only — and asks for a PR when a repo is connected', async () => {
    const noAgent = fakeDb();
    const out = await act(noAgent.db, 'fix');
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(out.refusal).toMatch(/No coding agent/);

    mocks.site = EXTERNAL;
    const external = fakeDb([[{ id: 'repo-1' }]]);
    await act(external.db, 'fix', { agentRef: 'agent-1', projectId: 5 });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    const [dto] = mocks.createTask.mock.calls[1]!;
    expect(dto).toMatchObject({ projectId: 5, assignedAgentRef: null });
    expect(dto.description).toContain('pull request');
  });

  it('needs a project for an external site', async () => {
    mocks.site = EXTERNAL;
    await expect(act(fakeDb().db, 'fix')).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

describe('publish-preview and revert', () => {
  it('is not open before the fix built a preview', async () => {
    mocks.row = baseRow({ status: 'applied', actionKind: 'fix', actionRef: 't=77' });
    await expect(act(fakeDb().db, 'publish-preview')).rejects.toMatchObject({ name: 'ConflictError' });
    expect(mocks.moveSiteTo).not.toHaveBeenCalled();
  });

  it('publishes the preview on a person\'s call, remembering what was live for Revert', async () => {
    mocks.row = baseRow({ status: 'applied', actionKind: 'fix', actionRef: 't=77;p=preview-token' });
    const { db, updates } = fakeDb();
    await act(db, 'publish-preview');
    expect(mocks.moveSiteTo).toHaveBeenCalledWith({}, db, HOSTED, 'preview-token');
    expect(updates[0]).toMatchObject({ status: 'measuring', actionRef: 't=77;p=preview-token;l=live-token' });
  });

  it('reverts only a worse verdict, to the release that was live', async () => {
    mocks.row = baseRow({ status: 'no_effect', actionKind: 'fix', actionRef: 't=77;p=preview-token;l=live-token' });
    await expect(act(fakeDb().db, 'revert')).rejects.toMatchObject({ name: 'ConflictError' });
    mocks.row = baseRow({ status: 'worse', actionKind: 'fix', actionRef: 't=77;p=preview-token;l=live-token' });
    const { db, updates } = fakeDb();
    await act(db, 'revert');
    expect(mocks.moveSiteTo).toHaveBeenCalledWith({}, db, HOSTED, 'live-token');
    expect(updates[0]).toMatchObject({ actionRef: 't=77;p=preview-token' });
    expect(mocks.trace).toHaveBeenCalledWith({}, db, expect.objectContaining({ verb: 'replay.prescription.revert' }));
  });
});

describe('test and start-test', () => {
  it('creates a DRAFT test that stays applied until a person starts it', async () => {
    mocks.row = baseRow({ status: 'applied', actionKind: 'fix', actionRef: 't=77;p=preview-token' });
    const created = fakeDb();
    await act(created.db, 'test');
    expect(mocks.createPrescriptionTest).toHaveBeenCalledWith(created.db, HOSTED, mocks.row, 'preview-token');
    expect(mocks.startPrescriptionTest).not.toHaveBeenCalled();
    expect(created.updates[0]).toMatchObject({ status: 'applied', actionKind: 'test', actionRef: 't=77;x=55;p=preview-token' });

    mocks.row = baseRow({ status: 'applied', actionKind: 'test', actionRef: 't=77;x=55;p=preview-token' });
    const started = fakeDb();
    await act(started.db, 'start-test');
    expect(mocks.startPrescriptionTest).toHaveBeenCalledWith({}, started.db, HOSTED, 55, expect.objectContaining({ ref: 'u1' }));
    expect(started.updates[0]).toMatchObject({ status: 'measuring' });
  });
});

describe('follow-up', () => {
  it('previews who and what first and writes nothing; enrols on confirm', async () => {
    mocks.row = baseRow({ ruleId: 'pricing_hesitation', area: 'sales', subjectKey: 'pricing:/pricing', pagePath: '/pricing' });
    const preview = fakeDb();
    const out = await act(preview.db, 'follow-up');
    expect(out.followUp).toMatchObject({ draft: { subject: 's' } });
    expect(preview.updates).toHaveLength(0);
    expect(mocks.trace).not.toHaveBeenCalled();
    expect(mocks.enrolFollowUp).not.toHaveBeenCalled();

    const SEQ = 'bbbbbbbb-cccc-4ddd-8eee-000000000001';
    const confirmed = fakeDb();
    await act(confirmed.db, 'follow-up', { confirm: true, sequenceObjectId: SEQ });
    expect(mocks.enrolFollowUp).toHaveBeenCalledWith({}, confirmed.db, SCOPE, mocks.row, expect.objectContaining({ sequenceObjectId: SEQ }));
    expect(confirmed.updates[0]).toMatchObject({ status: 'applied', actionKind: 'follow_up', actionRef: `s=${SEQ}` });
    expect(mocks.trace).toHaveBeenCalledWith({}, confirmed.db, expect.objectContaining({ verb: 'replay.prescription.follow-up' }));
  });
});

describe('enrolFollowUp (the real enrolment)', () => {
  it('enrols only contacts the resolver matched — a chosen id it did not match is ignored — and sends nothing itself', async () => {
    const { enrolFollowUp } = await vi.importActual<typeof import('./prescriptionFollowUp')>('./prescriptionFollowUp');
    mocks.resolveKnownContacts.mockResolvedValue({
      matched: [{ contactId: 'c-ana', name: 'Ana', email: 'ana@example.com', visitorIds: ['v1'] }],
      unmatched: 3,
      anonymous: 0,
    });
    const writes: Array<Record<string, unknown>> = [];
    const answers: unknown[][] = [
      [{ id: 'seq-1', sessionId: 'sess-1', content: { title: 'Pricing follow-up', enrolments: [] } }], // the sequence
      [{ visitorId: 'v1' }], // the cohort's visitors
    ];
    const db = {
      select: () => {
        const rows = answers.shift() ?? [];
        const chain: Record<string, unknown> = {};
        for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
        chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
        return chain;
      },
      update: () => ({ set: (set: Record<string, unknown>) => { writes.push(set); return { where: async () => undefined }; } }),
    };
    const added = await enrolFollowUp({} as never, db as never, SCOPE, baseRow({ pagePath: '/pricing' }) as never, {
      sequenceObjectId: 'bbbbbbbb-cccc-4ddd-8eee-000000000001', contactIds: ['c-ana', 'c-stranger'], now: NOW,
    });
    expect(added).toBe(1);
    const content = writes[0]!.content as { enrolments: Array<Record<string, unknown>> };
    expect(content.enrolments).toEqual([
      { contactRef: 'ana@example.com', name: 'Ana', enrolledAtISO: NOW.toISOString(), stepsSent: 0, lastSentAtISO: '', repliedAtISO: '', stoppedAtISO: '' },
    ]);
  });
});

describe('dismiss', () => {
  it('needs a reason, then records it and who decided', async () => {
    await expect(act(fakeDb().db, 'dismiss', { reason: '  ' })).rejects.toMatchObject({ name: 'ValidationError' });
    const { db, updates } = fakeDb();
    await act(db, 'dismiss', { reason: 'Seasonal traffic' });
    expect(updates[0]).toMatchObject({ status: 'dismissed', dismissReason: 'Seasonal traffic', decidedBy: 'u1' });
    expect(mocks.trace).toHaveBeenCalledWith({}, db, expect.objectContaining({ verb: 'replay.prescription.dismiss' }));
  });

  it('refuses an unknown action', async () => {
    await expect(act(fakeDb().db, 'launch')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('the §5.2 page actions', () => {
  beforeEach(() => {
    pageMocks.prescriptionPrompt.mockClear();
    pageMocks.pagePrompt.mockClear();
  });

  it('copy-prompt answers the compiled prompt and marks the fix applied by hand (manual), without storing the prompt', async () => {
    const { db, updates } = fakeDb();
    const out = await act(db, 'copy-prompt', { audience: 'site_builder' });
    expect(pageMocks.prescriptionPrompt).toHaveBeenCalledWith({}, db, SCOPE, RX, 'site_builder');
    expect(out).toMatchObject({ prompt: `PROMPT site_builder ${RX}` });
    expect(updates[0]).toMatchObject({ status: 'applied', actionKind: 'copy_prompt', actionRef: 'manual' });
    expect(JSON.stringify(updates[0])).not.toContain('PROMPT');
    const traced = (mocks.trace.mock.calls[0] as unknown as [unknown, unknown, { metadata: Record<string, unknown> }])[2];
    expect(traced.metadata.prompt).toBeUndefined();
  });

  it('copy-prompt on an already applied fix answers the prompt and writes nothing', async () => {
    mocks.row = baseRow({ status: 'applied', actionKind: 'copy_prompt', actionRef: 'manual' });
    const { db, updates } = fakeDb();
    const out = await act(db, 'copy-prompt');
    expect(out.prompt).toContain('coding_agent');
    expect(updates).toHaveLength(0);
  });

  it('apply-page bundles every accepted fix on the page into one prompt and applies the others too', async () => {
    const { db, updates } = fakeDb();
    const out = await act(db, 'apply-page');
    expect(pageMocks.pagePrompt).toHaveBeenCalledWith({}, db, SCOPE, '/checkout', 'coding_agent');
    expect(out.prescriptionIds).toEqual([RX, 'other-rx']);
    expect(updates[0]).toMatchObject({ status: 'applied', actionKind: 'apply_page', actionRef: 'manual' }); // the siblings
    expect(updates[1]).toMatchObject({ status: 'applied', actionKind: 'apply_page', actionRef: 'manual' }); // this fix
  });

  it('apply-in-composer returns the composer prompt and the selectors for previewPick chips, pending the canvas publish', async () => {
    const { db, updates } = fakeDb();
    const out = await act(db, 'apply-in-composer');
    expect(pageMocks.prescriptionPrompt).toHaveBeenCalledWith({}, db, SCOPE, RX, 'composer');
    expect(out).toMatchObject({ prompt: `PROMPT composer ${RX}`, selectors: ['getByRole("button", { name: "Pay" })'] });
    expect(updates[0]).toMatchObject({ status: 'applied', actionKind: 'apply_in_composer', actionRef: 'composer' });
  });

  it('apply-in-composer is not open on an external site', async () => {
    mocks.site = EXTERNAL;
    await expect(act(fakeDb().db, 'apply-in-composer')).rejects.toMatchObject({ name: 'ConflictError' });
  });
});
