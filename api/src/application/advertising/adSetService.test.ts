import { describe, expect, it } from 'vitest';
import { ensureCampaignUtmTag, tagDestination } from './adSetService';
import { utmCampaignFor } from './adUtm';
import type { Db } from '../../infrastructure/database/connection';

/**
 * THE ATTRIBUTION CONTRACT, which is the whole reason this module exists.
 *
 * `adUtm.ts` shipped with the ports and had ZERO callers, so none of what it promises
 * was ever true of a real ad: every destination URL reached its network untagged, and
 * joining spend to sessions fell back to matching campaign NAMES — which splits one
 * campaign's history in two the first time somebody renames it.
 *
 * These assert the two properties that make owned tagging work: the tag is stamped
 * before any adapter sees the URL, and it never changes once minted.
 */

/** A fake `Db` for the ONE query shape `ensureCampaignUtmTag` performs. */
function fakeDb(campaign: { id: number; name: string; utmCampaign: string | null } | null) {
  const updates: Array<Record<string, unknown>> = [];
  // The row the fake owns, so an update is visible to the re-read that follows it —
  // which is exactly what the write-once path depends on.
  let row = campaign ? { ...campaign } : null;

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
          // The real predicate carries `utm_campaign IS NULL`, so an update only lands
          // when the row is still untagged. The fake honours that rather than
          // pretending every write wins, because the concurrency rule is the point.
          if (row && row.utmCampaign == null && typeof values.utmCampaign === 'string') {
            row = { ...row, utmCampaign: values.utmCampaign };
          }
        },
      }),
    }),
  } as unknown as Db;

  return { db, updates, current: () => row };
}

describe('adSetService — owned UTM tagging', () => {
  describe('tagDestination', () => {
    it('stamps source, medium, campaign and the ad name onto a plain URL', () => {
      const tagged = tagDestination('meta', 'launch-abc1234', 'Spring hero video', 'https://example.com/pricing');
      const url = new URL(tagged!);
      expect(url.searchParams.get('utm_source')).toBe('meta');
      expect(url.searchParams.get('utm_medium')).toBe('cpc');
      expect(url.searchParams.get('utm_campaign')).toBe('launch-abc1234');
      // `utm_content` names the AD, which is what lets two creatives in one campaign
      // be compared without inventing a second tagging scheme.
      expect(url.searchParams.get('utm_content')).toBe('spring-hero-video');
      expect(url.pathname).toBe('/pricing');
    });

    it('never clobbers a param the caller wrote themselves', () => {
      const tagged = tagDestination(
        'meta', 'launch-abc1234', 'Hero',
        'https://example.com/?utm_source=newsletter&ref=partner',
      );
      const url = new URL(tagged!);
      // Their decision, not an accident — overwriting it would silently rewrite an
      // attribution scheme the moment this feature shipped.
      expect(url.searchParams.get('utm_source')).toBe('newsletter');
      expect(url.searchParams.get('ref')).toBe('partner');
      expect(url.searchParams.get('utm_campaign')).toBe('launch-abc1234');
    });

    it('is idempotent, so a retry or a re-publish cannot double-append', () => {
      const once = tagDestination('meta', 'launch-abc1234', 'Hero', 'https://example.com/');
      const twice = tagDestination('meta', 'launch-abc1234', 'Hero', once);
      expect(twice).toBe(once);
    });

    it('keeps an existing query string and fragment intact', () => {
      const tagged = tagDestination('x', 'launch-abc1234', 'Hero', 'https://example.com/docs?page=2#install');
      const url = new URL(tagged!);
      expect(url.searchParams.get('page')).toBe('2');
      // A fragment appended AFTER the query is the difference between a working deep
      // link and a 404 that only happens on paid traffic.
      expect(url.hash).toBe('#install');
    });

    it('returns a URL it cannot parse UNCHANGED rather than guessing', () => {
      expect(tagDestination('meta', 'launch-abc1234', 'Hero', 'not a url')).toBe('not a url');
      // An untagged click is a gap in a report; a corrupted destination is money spent
      // landing nowhere.
      expect(tagDestination('meta', 'launch-abc1234', 'Hero', 'mailto:sales@example.com'))
        .toBe('mailto:sales@example.com');
    });

    it('leaves the URL alone when there is no campaign tag to apply', () => {
      // Better an untagged click than a click attributed to a campaign we cannot
      // prove it belongs to.
      expect(tagDestination('meta', null, 'Hero', 'https://example.com/')).toBe('https://example.com/');
    });

    it('passes null and undefined through, so "no destination" stays no destination', () => {
      expect(tagDestination('meta', 'launch-abc1234', 'Hero', null)).toBeNull();
      expect(tagDestination('meta', 'launch-abc1234', 'Hero', undefined)).toBeUndefined();
    });
  });

  describe('ensureCampaignUtmTag', () => {
    it('mints a tag from the campaign identity and stores it', async () => {
      const { db, updates, current } = fakeDb({ id: 7, name: 'Spring Launch', utmCampaign: null });
      const tag = await ensureCampaignUtmTag(db, 1, 'meta', 'ext-123');

      expect(tag).toBe(utmCampaignFor('meta', 'ext-123', 'Spring Launch'));
      expect(tag).toMatch(/^spring-launch-[a-z0-9]{7}$/);
      expect(updates).toHaveLength(1);
      expect(current()?.utmCampaign).toBe(tag);
    });

    it('KEEPS an existing tag, whatever the campaign has been renamed to since', async () => {
      // The whole point. Re-deriving would produce `black-friday-…` here, and the same
      // campaign would then report as two campaigns that each look half as effective.
      const { db, updates } = fakeDb({ id: 7, name: 'Black Friday (renamed)', utmCampaign: 'spring-launch-abc1234' });
      const tag = await ensureCampaignUtmTag(db, 1, 'meta', 'ext-123');

      expect(tag).toBe('spring-launch-abc1234');
      expect(updates).toHaveLength(0);
    });

    it('is stable across renames when minted from the same identity', () => {
      // The digest half comes from network + external id, both immutable; only the
      // readable prefix follows the name. Two DIFFERENT campaigns sharing a name get
      // different tags, which is the distinction name-matching loses.
      const a = utmCampaignFor('meta', 'ext-123', 'Launch');
      const b = utmCampaignFor('meta', 'ext-999', 'Launch');
      expect(a).not.toBe(b);
      expect(utmCampaignFor('meta', 'ext-123', 'Launch')).toBe(a);
    });

    it('returns null for a campaign this workspace does not own', async () => {
      const { db, updates } = fakeDb(null);
      expect(await ensureCampaignUtmTag(db, 1, 'meta', 'ext-nobody')).toBeNull();
      expect(updates).toHaveLength(0);
    });
  });
});
