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

/**
 * Visitor chat on the public advisor profile (#2581).
 *
 * The contract is an ENTRY POINT into the existing employer↔freelancer thread —
 * so most of these assert what must NOT appear. A second composer, a name+email
 * gate, or a guest thread would all "work" in a browser while quietly shipping
 * the messenger product this ticket exists to avoid.
 */
describe('the advisor-profile visitor chat CTA', () => {
  const detail = read('../../app/talent/[id]/TalentDetailClient.tsx');

  it('shows the chat CTA only on an advisor-mode listing, never to the owner', () => {
    expect(detail).toContain('const showChatCta = !isOwner && bound;');
  });

  it('gates a visitor with no tenant through the existing sign-in, not a lead form', () => {
    expect(detail).toContain('{showChatCta && !canHire && (');
    expect(detail).toContain('href={signInHref()}');
    expect(detail).toContain("import { signInHref } from '@/lib/auth';");
  });

  it('does not collect name+email as the chat identity (that is booking, #2534)', () => {
    const chatBlock = detail.slice(detail.indexOf('{showChatCta && !canHire && ('));
    expect(chatBlock).not.toContain('type="email"');
    expect(chatBlock).not.toContain('guest');
  });

  it('starts no conversation from the profile itself — no in-profile composer', () => {
    expect(detail).not.toContain('startEmployerConversation');
    expect(detail).not.toContain('MessagesPanel');
    expect(detail).not.toContain('sendConversationMessage');
  });

  it('reuses the existing Message label rather than naming a new messenger', () => {
    const chatBlock = detail.slice(detail.indexOf('{showChatCta && !canHire && ('));
    expect(chatBlock).toContain("{t('message')}");
    expect(detail).not.toContain('Messenger');
  });

  it('keeps the tenant visitor on the existing MessagesButton (no duplicate CTA)', () => {
    // `!canHire` is what stops an advisor profile rendering two Message controls.
    expect(detail).toContain('{showChatCta && !canHire && (');
    expect(detail).toContain("<MessagesButton side=\"employer\"");
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
