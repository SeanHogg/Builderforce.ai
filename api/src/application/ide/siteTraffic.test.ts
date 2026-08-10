import { describe, expect, it } from 'vitest';
import {
  SiteTrafficBuffer,
  isPageView,
  utcDay,
  visitorHash,
} from './siteTraffic';

const base = { siteId: 1, tenantId: 7, projectId: 3, day: '2026-08-06', bytes: 100 };

describe('utcDay', () => {
  it('is the UTC calendar day, not the local one', () => {
    expect(utcDay(Date.parse('2026-08-06T23:30:00Z'))).toBe('2026-08-06');
    expect(utcDay(Date.parse('2026-08-07T00:30:00Z'))).toBe('2026-08-07');
  });
});

describe('isPageView', () => {
  it('counts the root, client routes and .html as views', () => {
    expect(isPageView('')).toBe(true);
    expect(isPageView('/')).toBe(true);
    expect(isPageView('/pricing')).toBe(true);
    expect(isPageView('/app/settings/billing')).toBe(true);
    expect(isPageView('/about.html')).toBe(true);
  });

  it('counts anything with an asset extension as an asset', () => {
    expect(isPageView('/assets/app.4f3a12ab.js')).toBe(false);
    expect(isPageView('/styles.css')).toBe(false);
    expect(isPageView('/logo.svg')).toBe(false);
    expect(isPageView('/favicon.ico')).toBe(false);
  });
});

describe('visitorHash', () => {
  it('is stable for the same visitor on the same day', async () => {
    const a = await visitorHash('salt', '1.2.3.4', 'UA', '2026-08-06');
    const b = await visitorHash('salt', '1.2.3.4', 'UA', '2026-08-06');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });

  it('ROTATES daily, so it cannot track a person across days', async () => {
    const day1 = await visitorHash('salt', '1.2.3.4', 'UA', '2026-08-06');
    const day2 = await visitorHash('salt', '1.2.3.4', 'UA', '2026-08-07');
    expect(day1).not.toBe(day2);
  });

  it('differs by visitor and by salt', async () => {
    const a = await visitorHash('salt', '1.2.3.4', 'UA', '2026-08-06');
    expect(await visitorHash('salt', '9.9.9.9', 'UA', '2026-08-06')).not.toBe(a);
    expect(await visitorHash('other-salt', '1.2.3.4', 'UA', '2026-08-06')).not.toBe(a);
  });
});

describe('SiteTrafficBuffer', () => {
  it('separates page views from asset hits and sums bytes', () => {
    const buffer = new SiteTrafficBuffer({ maxPending: 100, maxAgeMs: 1_000_000 });
    buffer.record({ ...base, pageView: true });
    buffer.record({ ...base, pageView: false, bytes: 50 });
    buffer.record({ ...base, pageView: false, bytes: 25 });
    const [delta] = buffer.drain();
    expect(delta).toMatchObject({ pageViews: 1, assetHits: 2, bytesServed: 175, siteId: 1, day: '2026-08-06' });
  });

  it('keys separately per site AND per day', () => {
    const buffer = new SiteTrafficBuffer({ maxPending: 100, maxAgeMs: 1_000_000 });
    buffer.record({ ...base, pageView: true });
    buffer.record({ ...base, siteId: 2, pageView: true });
    buffer.record({ ...base, day: '2026-08-07', pageView: true });
    expect(buffer.drain()).toHaveLength(3);
  });

  it('counts a repeat visitor once per day', () => {
    const buffer = new SiteTrafficBuffer({ maxPending: 100, maxAgeMs: 1_000_000 });
    buffer.record({ ...base, pageView: true, visitor: 'v1' });
    buffer.record({ ...base, pageView: true, visitor: 'v1' });
    buffer.record({ ...base, pageView: true, visitor: 'v2' });
    const [delta] = buffer.drain();
    expect(delta).toMatchObject({ pageViews: 3, visitors: 2 });
  });

  it('signals a flush once the size rule is met', () => {
    const buffer = new SiteTrafficBuffer({ maxPending: 3, maxAgeMs: 1_000_000 });
    expect(buffer.record({ ...base, pageView: true })).toBe(false);
    expect(buffer.record({ ...base, pageView: true })).toBe(false);
    expect(buffer.record({ ...base, pageView: true })).toBe(true);
  });

  it('signals a flush on the AGE rule even when the buffer is nearly empty', () => {
    // A site with one visitor an hour must still get its count persisted.
    let now = 1_000;
    const buffer = new SiteTrafficBuffer({ maxPending: 1_000, maxAgeMs: 10_000, now: () => now });
    expect(buffer.record({ ...base, pageView: true })).toBe(false);
    now += 10_001;
    expect(buffer.record({ ...base, pageView: true })).toBe(true);
  });

  it('resets the age clock on drain, so one stale entry does not force every flush', () => {
    let now = 1_000;
    const buffer = new SiteTrafficBuffer({ maxPending: 1_000, maxAgeMs: 10_000, now: () => now });
    buffer.record({ ...base, pageView: true });
    now += 20_000;
    expect(buffer.shouldFlush()).toBe(true);
    buffer.drain();
    expect(buffer.shouldFlush()).toBe(false);
    expect(buffer.record({ ...base, pageView: true })).toBe(false);
  });

  it('KEEPS visitor hashes across a drain — else the same person re-counts every batch', () => {
    const buffer = new SiteTrafficBuffer({ maxPending: 1, maxAgeMs: 1_000_000 });
    buffer.record({ ...base, pageView: true, visitor: 'v1' });
    expect(buffer.drain()[0]).toMatchObject({ visitors: 1 });
    buffer.record({ ...base, pageView: true, visitor: 'v1' });
    expect(buffer.drain()[0]).toMatchObject({ visitors: 0, pageViews: 1 });
  });

  it('stops counting new visitors past the memory cap rather than growing without bound', () => {
    const buffer = new SiteTrafficBuffer({ maxPending: 1_000_000, maxAgeMs: 1_000_000, maxVisitorHashes: 2 });
    for (const v of ['a', 'b', 'c', 'd']) buffer.record({ ...base, pageView: true, visitor: v });
    const [delta] = buffer.drain();
    // Undercounting is the safe direction for an explicitly-approximate metric.
    expect(delta!.visitors).toBe(2);
    expect(delta!.pageViews).toBe(4);
  });

  it('drain empties the buffer', () => {
    const buffer = new SiteTrafficBuffer();
    buffer.record({ ...base, pageView: true });
    expect(buffer.drain()).toHaveLength(1);
    expect(buffer.drain()).toHaveLength(0);
    expect(buffer.pendingCount).toBe(0);
  });
});
