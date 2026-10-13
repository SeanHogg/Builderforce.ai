/**
 * The Insights Brain tools: read-only, named by the advertised-name contract,
 * hidden from a workspace without Insights (and refused if called anyway), and
 * scoped to the calling project's hosted site — never another site.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tenantHasFeature: vi.fn(),
  projectSiteDto: vi.fn(),
  overview: vi.fn(),
  listRecordings: vi.fn(),
  listPrescriptions: vi.fn(),
  getPrescription: vi.fn(),
}));
vi.mock('../tenant/featureEntitlements', () => ({ tenantHasFeature: mocks.tenantHasFeature }));
vi.mock('../replay/replaySiteAdmin', () => ({ projectSiteDto: mocks.projectSiteDto }));
vi.mock('../replay/ReplayOverviewService', () => ({
  ReplayOverviewService: vi.fn(function ReplayOverviewService() { return { overview: mocks.overview }; }),
}));
vi.mock('../replay/ReplayReadService', () => ({
  ReplayReadService: vi.fn(function ReplayReadService() { return { listRecordings: mocks.listRecordings }; }),
}));
vi.mock('../replay/ReplayFunnelService', () => ({ ReplayFunnelService: vi.fn() }));
vi.mock('../replay/replaySummaries', () => ({ summarizeRecording: vi.fn() }));
vi.mock('../replay/prescriptionReads', () => ({ listPrescriptions: mocks.listPrescriptions, getPrescription: mocks.getPrescription }));

import { REPLAY_TOOL_IDS, REPLAY_TOOLS } from './replayToolCatalog';
import { entitledBuiltinTools } from './builtinToolEntitlements';
import { advertisedName } from './toolNaming';

const SITE = '11111111-2222-4333-8444-555555555555';
const getProject = vi.fn();
const ctx = { db: {} as never, tenantId: 7, env: {} as never, userId: 'u1', projects: { getProject } as never, tasks: {} as never };
const tool = (id: string) => REPLAY_TOOLS.find((t) => t.tool === id)!;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  getProject.mockReset();
  getProject.mockResolvedValue({ id: 3 });
  mocks.tenantHasFeature.mockResolvedValue(true);
  mocks.projectSiteDto.mockResolvedValue({ id: SITE, kind: 'hosted', projectId: 3, status: 'active' });
});

describe('REPLAY_TOOLS', () => {
  it('declares exactly the read-only Insights tools, each named by advertisedName', () => {
    expect(REPLAY_TOOLS.map((t) => t.tool)).toEqual([...REPLAY_TOOL_IDS]);
    for (const t of REPLAY_TOOLS) {
      expect(t.mutates, t.tool).toBe(false);
      expect(advertisedName(t.tool)).toMatch(/^builtin_replay_/);
      expect(t.parameters).toMatchObject({ required: expect.arrayContaining(['projectId']) });
    }
  });

  it('answers from the project\'s hosted site, never another', async () => {
    mocks.overview.mockResolvedValueOnce({ sessions: 5, estimated: false });
    const out = await tool('replay.overview').run(ctx as never, { projectId: 3, days: 7 });
    expect(out).toEqual({ sessions: 5, estimated: false });
    expect(getProject).toHaveBeenCalledWith(3, 7);
    expect(mocks.projectSiteDto).toHaveBeenCalledWith({}, {}, 7, 3);
    expect(mocks.overview).toHaveBeenCalledWith({ tenantId: 7, siteId: SITE }, { days: 7, filter: null });
  });

  it('refuses a project with no recording site', async () => {
    mocks.projectSiteDto.mockResolvedValueOnce(null);
    await expect(tool('replay.overview').run(ctx as never, { projectId: 3 })).rejects.toThrow(/not recording visits/);
  });

  it('refuses a run without Insights, even though the model named the tool', async () => {
    mocks.tenantHasFeature.mockResolvedValue(false);
    await expect(tool('replay.search_recordings').run(ctx as never, { projectId: 3 })).rejects.toThrow(/does not have Insights/);
    expect(mocks.listRecordings).not.toHaveBeenCalled();
  });

  it('rejects an invalid filter and returns one-line digests for a search', async () => {
    await expect(tool('replay.search_recordings').run(ctx as never, { projectId: 3, filter: { all: [{ field: 'nope' }] } })).rejects.toThrow(/filter/);
    mocks.listRecordings.mockResolvedValueOnce({
      items: [{ id: 'r1', startedAt: '2026-10-12T00:00:00.000Z', deviceClass: 'phone', durationMs: 5_000, entryPath: '/', exitPath: '/x', pageCount: 2, counts: { rage: 1, dead: 0, errors: 0 }, converted: false, releaseKey: '', tags: {} }],
      nextCursor: null,
    });
    const out = await tool('replay.search_recordings').run(ctx as never, { projectId: 3, limit: 999 });
    expect(out).toEqual({ recordings: [{ id: 'r1', startedAt: '2026-10-12T00:00:00.000Z', digest: 'phone 5s · / → /x · 2 pages · 1 rage' }], more: false });
    expect(mocks.listRecordings.mock.calls[0]![1]).toMatchObject({ limit: 25 });
  });
});

describe('the prescription tools', () => {
  const fix = (i: number) => ({
    id: `rx-${i}`, rank: i, ruleId: 'rage_on_element', area: 'ux', pagePath: '/checkout', status: 'proposed',
    finding: { params: { share: 5 }, evidence: [], selector: 'button.pay', label: 'Pay', fingerprint: 'fp', affected: 9 },
    impact: { estimate: null, low: 1, high: 4, unit: 'conversions', confidence: 'low', horizonDays: 30, estimated: true },
    prescription: 'Make Pay respond #0.', change: { kind: 'code', target: 'button.pay', description: 'Debounce' },
    acceptance: { metric: 'rage_rate', direction: 'down', minVisits: 200 }, measured: null,
  });

  it('lists the ranked fixes of the project\'s site, read-only, capped', async () => {
    mocks.listPrescriptions.mockResolvedValueOnce(Array.from({ length: 20 }, (_, i) => fix(i + 1)));
    const out = await tool('replay.prescriptions').run(ctx as never, { projectId: 3, area: 'ux' }) as { prescriptions: unknown[]; more: boolean };
    expect(mocks.listPrescriptions).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: SITE }, { area: 'ux', status: null });
    expect(out.prescriptions).toHaveLength(15);
    expect(out.more).toBe(true);
    expect(out.prescriptions[0]).toMatchObject({ id: 'rx-1', ruleId: 'rage_on_element', page: '/checkout', finding: { share: 5 } });
  });

  it('returns one fix\'s drafted change without acting on it', async () => {
    mocks.getPrescription.mockResolvedValueOnce(fix(1));
    const out = await tool('replay.prescription_draft').run(ctx as never, { projectId: 3, prescriptionId: 'rx-1' });
    expect(mocks.getPrescription).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: SITE }, 'rx-1');
    expect(out).toMatchObject({ id: 'rx-1', change: { target: 'button.pay' }, acceptance: { metric: 'rage_rate' } });
    expect(tool('replay.prescription_draft').mutates).toBe(false);
  });
});

describe('entitledBuiltinTools', () => {
  const catalog = [{ tool: 'tasks.list' }, ...REPLAY_TOOL_IDS.map((tool) => ({ tool }))];

  it('hides the Insights tools from a workspace without Insights', async () => {
    mocks.tenantHasFeature.mockResolvedValue(false);
    expect((await entitledBuiltinTools({} as never, 7, null, catalog)).map((t) => t.tool)).toEqual(['tasks.list']);
    expect(mocks.tenantHasFeature).toHaveBeenCalledWith({}, 7, null, 'sessionReplay');
  });

  it('shows them to a workspace holding Insights', async () => {
    expect(await entitledBuiltinTools({} as never, 7, null, catalog)).toHaveLength(catalog.length);
  });

  it('does not resolve entitlements when no gated tool is in the list', async () => {
    await entitledBuiltinTools({} as never, 7, null, [{ tool: 'tasks.list' }]);
    expect(mocks.tenantHasFeature).not.toHaveBeenCalled();
  });
});
