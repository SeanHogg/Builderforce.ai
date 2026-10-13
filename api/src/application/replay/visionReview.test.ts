/**
 * The ONE vision request per page (PRD 33 §5.2, D13): `acceptObserved` keeps an
 * observation only when it names a rect-map element AND cites a measured fact; a
 * patch that fails validation is dropped; the request carries the fold screenshots in
 * the image-part shape the gateway's capability gate detects.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageRect } from '@builderforce/interaction-contract';
import { requestCarriesImages } from '../llm/vendors/capabilityGate';
import { EMPTY_VITALS, type PageFacts } from '../../domain/replay/prescriptions/pageFacts';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
  requestRender: vi.fn(async () => true),
  budget: true,
  kv: new Map<string, unknown>(),
  page: null as unknown,
}));

vi.mock('../llm/tenantProxy', () => ({ tenantProxyForPlan: vi.fn(async () => ({ proxy: { complete: mocks.complete } })) }));
vi.mock('./replayAiBudget', () => ({ withinReplayAiBudget: vi.fn(async () => mocks.budget) }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: vi.fn(async (_e: unknown, k: string) => mocks.kv.get(k) ?? null),
  setCached: vi.fn(async (_e: unknown, k: string, v: unknown) => { mocks.kv.set(k, v); }),
}));
vi.mock('./replayCacheKeys', async (importOriginal) => ({ ...(await importOriginal<typeof import('./replayCacheKeys')>()), bumpSiteVersion: vi.fn(async () => {}) }));
vi.mock('./pageCaptureStore', () => ({
  listCaptures: vi.fn(async () => [
    { id: 'cap-d', path: '/pricing', releaseKey: 'r1', deviceClass: 'desktop', foldScreenshotKey: 'k1', rectMapKey: 'k2' },
    { id: 'cap-p', path: '/pricing', releaseKey: 'r1', deviceClass: 'phone', foldScreenshotKey: 'k3', rectMapKey: 'k4' },
  ]),
  readRectMap: vi.fn(async (_e: unknown, row: { id: string }) => (row.id === 'cap-d' ? RECTS : [])),
  foldDataUrl: vi.fn(async (_e: unknown, row: { id: string }) => `data:image/jpeg;base64,${row.id}`),
  toCaptureDto: vi.fn(),
}));
vi.mock('./pageAggregates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pageAggregates')>()),
  buildPageFacts: vi.fn(async () => [mocks.page]),
}));
vi.mock('./pageCapture', () => ({ siteOrigin: vi.fn(async () => 'https://shop.example') }));
vi.mock('./pageRender', () => ({ requestRender: mocks.requestRender }));

import { acceptObserved, buildVisionMessages, parseVisionReply, reviewPage, VISION_MAX_FINDINGS } from './visionReview';

const RECTS: PageRect[] = [
  { selector: 'getByRole("button", { name: "Learn more" })', x: 10, y: 300, w: 80, h: 30, label: 'Learn more', role: 'cta' },
  { selector: 'getByRole("heading", { name: "Shoes" })', x: 10, y: 40, w: 400, h: 60, label: 'Shoes', role: 'heading' },
];
const FACTS = { 'desktop.content.ctaAboveFold': 1, conversionRate: 0.02 };
const CTA = RECTS[0]!.selector;

const finding = (over: Record<string, unknown> = {}) => ({
  elementSelector: CTA,
  area: 'content',
  observation: 'The only call to action is grey and says nothing.',
  supportingMetric: 'conversionRate',
  prescription: 'Say what the button does.',
  visualPatch: { ops: [{ op: 'setText', selector: CTA, text: 'Start your free trial' }] },
  ...over,
});

describe('acceptObserved', () => {
  it('keeps an anchored, cited finding with its validated patch', () => {
    expect(acceptObserved(finding(), RECTS, FACTS, { palette: [] })).toMatchObject({
      selector: CTA, label: 'Learn more', area: 'content', supportingMetric: 'conversionRate', metricValue: 0.02, patchRejected: null,
      patch: { ops: [{ op: 'setText' }] },
    });
  });

  it('drops a finding whose selector is not in the rect map', () => {
    expect(acceptObserved(finding({ elementSelector: 'getByText("Invented")' }), RECTS, FACTS)).toBeNull();
    expect(acceptObserved(finding({ elementSelector: undefined }), RECTS, FACTS)).toBeNull();
  });

  it('drops a finding citing a metric the page never measured', () => {
    expect(acceptObserved(finding({ supportingMetric: 'bounceRate' }), RECTS, FACTS)).toBeNull();
    expect(acceptObserved(finding({ supportingMetric: '' }), RECTS, FACTS)).toBeNull();
  });

  it('drops an empty observation, and keeps the finding without an invalid patch', () => {
    expect(acceptObserved(finding({ observation: '  ' }), RECTS, FACTS)).toBeNull();
    const out = acceptObserved(finding({ visualPatch: { ops: [{ op: 'setStyle', selector: CTA, property: 'color', value: '#ff0000' }] } }), RECTS, FACTS, { palette: ['#111111'] });
    expect(out).toMatchObject({ patch: null, patchRejected: expect.stringMatching(/palette/) });
    expect(acceptObserved(finding({ area: 'sales' }), RECTS, FACTS)!.area).toBe('ux');
  });
});

describe('the request', () => {
  it('carries the screenshots as image parts the capability gate detects', () => {
    const messages = buildVisionMessages({ text: 'facts', images: ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'] });
    expect(requestCarriesImages(messages)).toBe(true);
    const user = messages[1]!.content as Array<{ type: string }>;
    expect(user.map((p) => p.type)).toEqual(['text', 'image_url', 'image_url']);
  });

  it('parses at most five findings from an array or a { findings } object', () => {
    const many = JSON.stringify(Array.from({ length: 9 }, () => finding()));
    expect(parseVisionReply(many)).toHaveLength(VISION_MAX_FINDINGS);
    expect(parseVisionReply(`\`\`\`json\n{"findings":[${JSON.stringify(finding())}]}\n\`\`\``)).toHaveLength(1);
    expect(parseVisionReply('no json here')).toEqual([]);
  });
});

function page(): PageFacts {
  const content = { aboveFoldText: '', aboveFoldWords: 0, valuePropAboveFold: true, ctaLabels: ['Learn more'], ctaCount: 1, ctaAboveFold: 1, readabilityGrade: 8, readingTimeSec: 60, formFields: 0, trustSignals: ['review'], palette: ['#111111'] };
  return {
    path: '/pricing',
    captures: { desktop: { captureId: 'cap-d', releaseKey: 'r1', seo: null, content, labPerf: null, a11y: null }, phone: null },
    behaviour: { all: { sessions: 500, conversions: 10, frustrated: 20 }, desktop: { sessions: 300, conversions: 8, frustrated: 5 }, phone: { sessions: 200, conversions: 2, frustrated: 15 } },
    site: { sessions: 5_000, conversions: 200 },
    vitals: { desktop: { ...EMPTY_VITALS }, phone: { ...EMPTY_VITALS } },
    search: { connected: false },
  };
}

function fakeDb() {
  return {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mocks.inserts.push(v);
        return { onConflictDoNothing: () => ({ returning: async () => [{ id: `rx-${mocks.inserts.length}`, visual: v.visual }] }) };
      },
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  };
}

describe('reviewPage', () => {
  beforeEach(() => {
    mocks.inserts = [];
    mocks.kv.clear();
    mocks.budget = true;
    mocks.page = page();
    mocks.requestRender.mockClear();
    mocks.complete.mockReset().mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify([
        finding({ supportingMetric: 'desktop.content.ctaAboveFold' }),
        finding({ elementSelector: 'getByText("Ghost")' }),
        finding({ supportingMetric: 'madeUp' }),
      ]) } }] })),
    });
  });

  const SITE = { id: 's1', tenantId: 7, kind: 'hosted', projectId: 42 } as never;

  it('sends ONE request with both folds and stores only the accepted observation, then queues its render', async () => {
    const out = await reviewPage({} as never, fakeDb() as never, SITE, '/pricing');
    expect(out).toEqual({ reviewed: true, accepted: 1, skipped: null });
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    const { messages } = mocks.complete.mock.calls[0]![0] as { messages: unknown[] };
    expect(requestCarriesImages(messages)).toBe(true);
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0]).toMatchObject({ ruleId: 'vision_observed', source: 'observed', pagePath: '/pricing', captureId: 'cap-d', area: 'content' });
    expect(mocks.requestRender).toHaveBeenCalledTimes(1);
  });

  it('runs once per page and release', async () => {
    await reviewPage({} as never, fakeDb() as never, SITE, '/pricing');
    expect(await reviewPage({} as never, fakeDb() as never, SITE, '/pricing')).toMatchObject({ reviewed: false, skipped: 'already_reviewed' });
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it('spends nothing when the AI budget is gone', async () => {
    mocks.budget = false;
    expect(await reviewPage({} as never, fakeDb() as never, SITE, '/pricing')).toMatchObject({ reviewed: false, skipped: 'ai_budget' });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
