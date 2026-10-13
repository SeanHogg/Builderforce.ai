import { describe, expect, it } from 'vitest';
import { issueFingerprint, type ReplayMark } from '@builderforce/interaction-contract';
import { attributeRoutes, issueOf, issueTitle, rollupRoute, ROUTE_MAX } from './markWalk';

const SITE = '7d4b8c52-0d36-4c5e-9a43-2f1d6b0e9a10';

describe('attributeRoutes', () => {
  it('gives every mark the page the visitor was on, in time order', () => {
    const marks: ReplayMark[] = [
      { kind: 'click', key: '#late', atMs: 30 },
      { kind: 'page', key: '/a', atMs: 10 },
      { kind: 'click', key: '#early', atMs: 5 },
    ];
    const { attributed, endRoute } = attributeRoutes(marks, '/start');
    expect(attributed.map((a) => [a.mark.key, a.route])).toEqual([['#early', '/start'], ['/a', '/a'], ['#late', '/a']]);
    expect(endRoute).toBe('/a');
  });

  it('lets a quick back name its own route without moving the visitor', () => {
    const { attributed, endRoute } = attributeRoutes([{ kind: 'quickback', key: '/b', atMs: 1 }], '/a');
    expect(attributed[0]!.route).toBe('/b');
    expect(endRoute).toBe('/a');
  });
});

describe('rollupRoute', () => {
  it('templates id segments and caps the length', () => {
    expect(rollupRoute('/orders/123?x=1')).toBe('/orders/:id');
    expect(rollupRoute(`/${'a'.repeat(500)}`).length).toBeLessThanOrEqual(ROUTE_MAX);
    expect(rollupRoute('')).toBe('');
  });
});

describe('issueOf', () => {
  it('fingerprints an element issue by selector and a page issue by route', () => {
    const rage = issueOf(SITE, { mark: { kind: 'rage', key: 'button.pay', label: 'Pay', atMs: 1 }, route: '/cart' });
    expect(rage).toEqual({
      fingerprint: issueFingerprint({ siteId: SITE, route: '/cart', kind: 'rage', subject: 'button.pay' }),
      kind: 'rage',
      route: '/cart',
      subject: 'button.pay',
      title: 'Rage clicks on Pay',
    });
    const back = issueOf(SITE, { mark: { kind: 'quickback', key: '/cart', atMs: 1 }, route: '/cart' });
    expect(back?.subject).toBe('/cart');
  });

  it('opens no issue for a plain click or page', () => {
    expect(issueOf(SITE, { mark: { kind: 'click', key: 'a', atMs: 1 }, route: '/' })).toBeNull();
    expect(issueOf(SITE, { mark: { kind: 'page', key: '/', atMs: 1 }, route: '/' })).toBeNull();
  });
});

describe('issueTitle', () => {
  it('falls back to the subject when there is no label', () => {
    expect(issueTitle('error', 'fp123')).toBe('JS error: fp123');
  });
});
