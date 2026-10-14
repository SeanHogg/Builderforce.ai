import { describe, expect, it } from 'vitest';
import { issueFingerprint, VITAL_BUCKETS, vitalBucket, type ReplayChunk, type ReplayMark } from '@builderforce/interaction-contract';
import { rollupCells, type RollupContext } from './interactionAggregate';

const SITE = '7d4b8c52-0d36-4c5e-9a43-2f1d6b0e9a10';

function chunk(marks: ReplayMark[], over: Partial<ReplayChunk> = {}): ReplayChunk {
  return {
    v: 1,
    visitorId: 'visitor_0001',
    visitId: 'visit_00001',
    seq: 0,
    startedAt: Date.UTC(2026, 9, 12, 10),
    release: 'abc123def456',
    recorderVersion: '1.0.0',
    device: { class: 'desktop', w: 1440, h: 900 },
    browser: 'Chrome',
    os: 'macOS',
    referrer: 'google.com',
    newVisitor: true,
    keep: null,
    sampleWeight: 1,
    marks,
    ...over,
  };
}

const ctx = (over: Partial<RollupContext> = {}): RollupContext => ({
  siteId: SITE, day: '2026-10-12', country: 'US', visit: null, ...over,
});

describe('rollupCells', () => {
  it('counts the session, entry and new visitor once, on seq 0, at the entry route', () => {
    const cells = rollupCells(chunk([
      { kind: 'page', key: '/pricing', atMs: 0 },
      { kind: 'page', key: '/signup', atMs: 4_000 },
    ]), ctx());
    const pricing = cells.routes.find((r) => r.route === '/pricing')!;
    const signup = cells.routes.find((r) => r.route === '/signup')!;
    expect(pricing).toMatchObject({ sessions: 1, entries: 1, newVisitors: 1, pageviews: 1, releaseKey: 'abc123def456', deviceClass: 'desktop' });
    expect(signup).toMatchObject({ sessions: 0, entries: 0, pageviews: 1 });
  });

  it('does not count a session again on a later chunk of the same visit', () => {
    const cells = rollupCells(chunk([{ kind: 'page', key: '/a', atMs: 10 }], { seq: 3 }), ctx({
      visit: { route: '/home', activeMs: 0, converted: false, frustrated: false, issueFps: [] },
    }));
    expect(cells.routes.reduce((n, r) => n + r.sessions, 0)).toBe(0);
    expect(cells.breakdowns).toEqual([]);
  });

  it('attributes clicks to the page the visitor was on and templates the route', () => {
    const cells = rollupCells(chunk([
      { kind: 'page', key: '/orders/12345', atMs: 0 },
      { kind: 'click', key: 'button.buy', label: 'Buy', atMs: 50, gx: 10, gy: 20 },
      { kind: 'click', key: 'button.buy', label: 'Buy', atMs: 60, gx: 10, gy: 20 },
    ]), ctx());
    expect(cells.heat).toEqual([
      expect.objectContaining({ route: '/orders/:id', kind: 'click', selector: 'button.buy', label: 'Buy', gx: 10, gy: 20, n: 2 }),
    ]);
    expect(cells.live).toMatchObject({ route: '/orders/:id', x: 10, y: 20 });
  });

  it('carries the route across chunks through the visit state', () => {
    const cells = rollupCells(chunk([{ kind: 'dead', key: 'h2.title', atMs: 5, gx: 1, gy: 2 }], { seq: 1 }), ctx({
      visit: { route: '/docs', activeMs: 0, converted: false, frustrated: false, issueFps: [] },
    }));
    expect(cells.heat[0]).toMatchObject({ route: '/docs', kind: 'dead' });
  });

  it('turns scroll marks into a decile cell and a depth sum', () => {
    const cells = rollupCells(chunk([
      { kind: 'page', key: '/', atMs: 0 },
      { kind: 'scroll', key: '/', atMs: 900, value: 7 },
    ]), ctx());
    expect(cells.heat).toEqual([expect.objectContaining({ kind: 'scroll', selector: '', gx: 0, gy: 7, n: 1 })]);
    expect(cells.routes.find((r) => r.route === '/')!.scrollDepthSum).toBe(7);
  });

  it('buckets vitals with the contract histogram', () => {
    const cells = rollupCells(chunk([
      { kind: 'page', key: '/', atMs: 0 },
      { kind: 'vital', key: 'LCP', atMs: 1, value: 2_300 },
      { kind: 'vital', key: 'NOPE', atMs: 2, value: 5 },
    ]), ctx());
    expect(cells.vitals).toEqual([
      expect.objectContaining({ metric: 'LCP', bucket: vitalBucket(VITAL_BUCKETS.LCP, 2_300), n: 1, route: '/' }),
    ]);
  });

  it('counts a frustrated session and each issue once per visit', () => {
    const first = rollupCells(chunk([
      { kind: 'page', key: '/cart', atMs: 0 },
      { kind: 'rage', key: 'button.pay', atMs: 10, gx: 3, gy: 4 },
      { kind: 'rage', key: 'button.pay', atMs: 20, gx: 3, gy: 4 },
    ]), ctx());
    const fp = issueFingerprint({ siteId: SITE, route: '/cart', kind: 'rage', subject: 'button.pay' });
    expect(first.issues).toEqual([expect.objectContaining({ fingerprint: fp, kind: 'rage', sessions: 1 })]);
    expect(first.routes.find((r) => r.route === '/cart')!.frustrated).toBe(1);

    const again = rollupCells(chunk([{ kind: 'rage', key: 'button.pay', atMs: 30, gx: 3, gy: 4 }], { seq: 1 }), ctx({ visit: first.next }));
    expect(again.issues).toEqual([]);
    expect(again.routes.reduce((n, r) => n + r.frustrated, 0)).toBe(0);
  });

  it('counts errors per mark and a conversion once', () => {
    const cells = rollupCells(chunk([
      { kind: 'page', key: '/checkout', atMs: 0 },
      { kind: 'error', key: 'fp1', label: 'TypeError', atMs: 1 },
      { kind: 'error', key: 'fp1', label: 'TypeError', atMs: 2 },
    ], { keep: 'goal' }), ctx());
    const checkout = cells.routes.find((r) => r.route === '/checkout')!;
    expect(checkout.errors).toBe(2);
    expect(checkout.conversions).toBe(1);
    expect(cells.next.converted).toBe(true);
  });

  it('attributes the active-time delta and counts an exit on the final chunk', () => {
    const cells = rollupCells(chunk([], { seq: 2, activeMs: 9_000, end: true }), ctx({
      visit: { route: '/thanks', activeMs: 4_000, converted: false, frustrated: false, issueFps: [] },
    }));
    expect(cells.routes).toEqual([expect.objectContaining({ route: '/thanks', activeMsSum: 5_000, exits: 1 })]);
    expect(cells.breakdowns).toEqual([{ dim: 'exit', value: '/thanks', sessions: 1 }]);
    expect(cells.next.activeMs).toBe(9_000);
  });

  it('writes the seq-0 breakdowns only', () => {
    const cells = rollupCells(chunk([{ kind: 'page', key: '/', atMs: 0 }]), ctx());
    expect(cells.breakdowns.map((b) => b.dim).sort()).toEqual(['browser', 'country', 'device', 'entry', 'os', 'referrer']);
  });
});
