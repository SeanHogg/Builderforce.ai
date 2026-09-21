'use client';

import { useTranslations } from 'next-intl';
import { isProBonoSession } from '@/lib/freelance/talentProfile';
import { Icon } from '@/components/ui/Icon';

/**
 * Volunteer / pro-bono chip — shown when an advisor's session price is unpaid.
 *
 * ONE component for every talent surface (marketplace card, talent list, grid,
 * search, recommendations) so the chip reads identically everywhere, exactly as
 * `TrustBadge` does for the reputation signal. Like TrustBadge it decides its own
 * visibility and renders `null` when there is nothing to show, which is what lets
 * a card drop it in unconditionally without an `&&` at every call site.
 *
 * Visibility is `isProBonoSession` and nothing else: strictly the number `0`.
 * `null`, absent, priced, negative and non-numeric all render nothing — not an
 * empty chip, not a spacer, not a "Paid" counterpart. The slot simply is not
 * occupied, so paid-card layout is untouched.
 *
 * Deliberately NOT a price display: unpaid is never rendered as `$0`/`$0.00`,
 * which reads as a discount rather than as volunteering.
 */
export function ProBonoBadge({ sessionPriceCents, size = 'md' }: {
  /** `freelancer_profiles.session_price_cents` as carried on the card payload (#2528). */
  sessionPriceCents: number | null | undefined;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('proBonoBadge');
  if (!isProBonoSession(sessionPriceCents)) return null;

  const pad = size === 'sm' ? '1px 7px' : '3px 9px';
  const fs = size === 'sm' ? 11 : 12;

  return (
    // The accessible name carries the MEANING ("Unpaid / volunteer session");
    // the visible label is the short product string ("Pro bono"). The icon is
    // decorative and hidden, so nothing here depends on colour or on glyph
    // recognition to be understood.
    <span
      title={t('accessibleName')}
      aria-label={t('accessibleName')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: fs,
        fontWeight: 700,
        padding: pad,
        borderRadius: 'var(--radius-full)',
        background: 'rgba(20,184,166,0.12)',
        color: 'var(--teal-bright, rgba(13,148,136,0.95))',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden><Icon source="♡" size={14} /></span>{t('label')}
    </span>
  );
}
