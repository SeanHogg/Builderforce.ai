import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { talentPrimaryAction } from './booking';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('talentPrimaryAction', () => {
  it('is Book when a booking_service is bound', () => {
    expect(talentPrimaryAction(true)).toBe('book');
  });

  it('is Message when the listing has no bound service', () => {
    expect(talentPrimaryAction(false)).toBe('message');
  });
});

describe('reserveTalentSession', () => {
  const src = read('booking.ts');

  it('swallows the overlap 409 so the page does not toast it globally', () => {
    expect(src).toContain('expectedErrors: [409]');
  });

  it('writes through the talent listing, not practice-ops', () => {
    expect(src).toContain('/api/freelancers/${encodeURIComponent(input.talentId)}/reservations');
    expect(src).not.toContain('/api/practice-ops');
  });
});

describe('the talent listing Book CTA', () => {
  const detail = read('../../app/talent/[id]/TalentDetailClient.tsx');
  const cards = read('../../app/marketplace/MarketplacePageClient.tsx');

  it('shows Book for a bound listing even when the visitor cannot hire', () => {
    expect(detail).toContain('canHire || bound');
    expect(detail).toContain('{bound && (');
    expect(detail).toContain("{!isOwner && bookingOpen && !booked && listingServices.length > 0 && (");
  });

  it('keeps Message for an unbound listing that can hire', () => {
    expect(detail).toContain("label={t('message')}");
    expect(detail).toContain('{canHire && (');
  });

  it('labels a bound marketplace card Book instead of view profile', () => {
    expect(cards).toContain("f.bookable ? tt('book') : tt('viewProfile')");
  });
});

describe('talent.book is localised', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'zh'] as const) {
    it(`${locale} has talent.book next to talent.message`, () => {
      const src = read(`../../i18n/messages/${locale}.json`);
      expect(src).toContain('"bookSession"');
      expect(src).toContain('"bookOverlap"');
      expect(src).toContain('"bookConfirm"');
    });
  }
});
