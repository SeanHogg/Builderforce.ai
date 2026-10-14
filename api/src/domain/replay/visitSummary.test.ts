import { describe, expect, it } from 'vitest';
import { issueFingerprint, type ReplayChunk, type ReplayMark } from '@builderforce/interaction-contract';
import { foldVisit, VISIT_ARRAY_CAP, VISIT_STEPS_CAP } from './visitSummary';

const SITE = '7d4b8c52-0d36-4c5e-9a43-2f1d6b0e9a10';
const START = Date.UTC(2026, 9, 12, 10, 0, 0);

function chunk(marks: ReplayMark[], over: Partial<ReplayChunk> = {}): ReplayChunk {
  return {
    v: 1,
    visitorId: 'visitor_0001',
    visitId: 'visit_00001',
    seq: 0,
    startedAt: START,
    release: 'rel-1',
    recorderVersion: '1.2.3',
    device: { class: 'phone', w: 390, h: 844 },
    newVisitor: true,
    keep: 'sample',
    sampleWeight: 4,
    marks,
    ...over,
  };
}

describe('foldVisit', () => {
  it('starts a row from the first kept chunk', () => {
    const row = foldVisit(null, chunk([
      { kind: 'page', key: '/pricing', atMs: 0 },
      { kind: 'click', key: 'a.cta', label: 'Start', atMs: 1_500, gx: 1, gy: 1 },
    ], { browser: 'Safari', os: 'iOS', referrer: 'news.ycombinator.com', activeMs: 1_200 }), new Date(START + 10_000), SITE);

    expect(row).toMatchObject({
      visitId: 'visit_00001',
      visitorId: 'visitor_0001',
      entryPath: '/pricing',
      exitPath: '/pricing',
      pageCount: 1,
      clickCount: 1,
      releaseKey: 'rel-1',
      recorderVersion: '1.2.3',
      deviceClass: 'phone',
      viewportW: 390,
      viewportH: 844,
      browser: 'Safari',
      os: 'iOS',
      referrerHost: 'news.ycombinator.com',
      keepReason: 'sample',
      sampleWeight: 4,
      activeMs: 1_200,
      chunkCount: 1,
      routes: ['/pricing'],
      clicked: ['a.cta'],
      steps: ['page:/pricing'],
    });
    expect(row.startedAt.getTime()).toBe(START);
    expect(row.lastEventAt.getTime()).toBe(START + 1_500);
    expect(row.durationMs).toBe(1_500);
    expect(row.endedAt).toBeNull();
  });

  it('accumulates counters and keeps the first entry path and keep reason', () => {
    const first = foldVisit(null, chunk([{ kind: 'page', key: '/a', atMs: 0 }]), new Date(START + 1_000), SITE);
    const second = foldVisit(first, chunk([
      { kind: 'page', key: '/b/42', atMs: 6_000 },
      { kind: 'rage', key: 'button.x', atMs: 6_100, gx: 2, gy: 2 },
      { kind: 'error', key: 'efp', label: 'Boom', atMs: 6_200 },
      { kind: 'quickback', key: '/b/42', atMs: 6_300 },
    ], { seq: 1, keep: 'frustration', activeMs: 5_000, end: true }), new Date(START + 7_000), SITE);

    expect(second).toMatchObject({
      entryPath: '/a',
      exitPath: '/b/:id',
      pageCount: 2,
      rageCount: 1,
      errorCount: 1,
      quickbackCount: 1,
      keepReason: 'sample',
      chunkCount: 2,
      routes: ['/a', '/b/:id'],
      frustrations: ['rage', 'error', 'quickback'],
      steps: ['page:/a', 'page:/b/:id'],
    });
    expect(second.endedAt?.getTime()).toBe(START + 6_300);
    expect(second.issueFps).toContain(issueFingerprint({ siteId: SITE, route: '/b/:id', kind: 'rage', subject: 'button.x' }));
    expect(second.issueFps).toContain(issueFingerprint({ siteId: SITE, route: '/b/:id', kind: 'quickback', subject: '/b/:id' }));
  });

  it('never moves lastEventAt past ingest time or backwards', () => {
    const row = foldVisit(null, chunk([{ kind: 'page', key: '/', atMs: 999_999 }]), new Date(START + 5_000), SITE);
    expect(row.lastEventAt.getTime()).toBe(START + 5_000);
    const next = foldVisit(row, chunk([{ kind: 'page', key: '/x', atMs: 10 }], { seq: 1 }), new Date(START + 6_000), SITE);
    expect(next.lastEventAt.getTime()).toBe(START + 5_000);
  });

  it('records custom events, smart events and conversion', () => {
    const row = foldVisit(null, chunk([
      { kind: 'page', key: '/checkout', atMs: 0 },
      { kind: 'event', key: 'video_play', atMs: 10 },
    ]), new Date(START + 1_000), SITE);
    expect(row.events).toEqual(['begin checkout', 'video_play']);
    expect(row.steps).toEqual(['page:/checkout', 'event:begin checkout', 'event:video_play']);
    expect(row.converted).toBe(true);
  });

  it('merges identity, traits, variant and sticky tags under the cap', () => {
    const first = foldVisit(null, chunk([], { tags: { plan: 'pro' }, identify: { id: 'u-1', traits: { tier: 'a' } }, variant: 'B' }), new Date(START), SITE);
    const second = foldVisit(first, chunk([], { seq: 1, tags: { plan: 'team', ab: 'x' }, identify: { id: 'u-1', traits: { region: 'eu' } } }), new Date(START + 1), SITE);
    expect(second.tags).toEqual({ plan: 'team', ab: 'x' });
    expect(second.identifiedId).toBe('u-1');
    expect(second.traits).toEqual({ tier: 'a', region: 'eu' });
    expect(second.variant).toBe('B');
  });

  it('caps the arrays and the step sequence', () => {
    const marks: ReplayMark[] = [];
    for (let i = 0; i < 80; i++) {
      marks.push({ kind: 'page', key: `/p${i}`, atMs: i * 2 });
      marks.push({ kind: 'click', key: `#b${i}`, atMs: i * 2 + 1, gx: 0, gy: 0 });
    }
    const row = foldVisit(null, chunk(marks), new Date(START + 1_000), SITE);
    expect(row.routes).toHaveLength(VISIT_ARRAY_CAP);
    expect(row.clicked).toHaveLength(VISIT_ARRAY_CAP);
    expect(row.steps).toHaveLength(VISIT_STEPS_CAP);
    expect(row.pageCount).toBe(80);
  });
});
