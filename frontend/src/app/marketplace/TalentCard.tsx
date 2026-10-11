/**
 * One published person on the storefront — the card the Talent grid and the
 * All view's Talent strip both render, so a person reads the same in each.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { RatingStars } from '@/components/freelance/RatingStars';
import { TrustBadge } from '@/components/freelance/TrustBadge';
import { ProBonoBadge } from '@/components/freelance/ProBonoBadge';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import type { FreelancerProfile } from '@/lib/freelance/talentProfile';

const talentCardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18,
  display: 'flex', flexDirection: 'column', gap: 10, textDecoration: 'none',
};

/** Grid template shared by every grid of talent cards. */
export const TALENT_GRID_STYLE: React.CSSProperties = {
  display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
};

function talentInitials(name: string | null): string {
  return (name ?? '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('') || '?';
}

export function TalentCard({ profile: f }: { profile: FreelancerProfile }) {
  const tt = useTranslations('talent');
  const { formatCents } = useMoneyFormat();
  return (
    <Link href={`/talent/${f.userId}`} style={talentCardStyle} className="hover-lift">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--surface-interactive)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>
          {talentInitials(f.displayName)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.displayName ?? '—'}</div>
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{f.headline ?? f.discipline ?? ''}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            <RatingStars rating={f.rating} count={f.ratingCount} />
            <TrustBadge badge={f.badge ?? null} jss={f.jss} size="sm" showJss={false} />
            <ProBonoBadge sessionPriceCents={f.sessionPriceCents} size="sm" />
          </div>
        </div>
      </div>
      {f.skills.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {f.skills.slice(0, 4).map((s) => (
            <span key={s} style={{ fontSize: 'var(--font-size-eyebrow)', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{s}</span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
        <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--coral-bright)' }}>
          {f.hourlyRateCents != null ? `${formatCents(f.hourlyRateCents, { currency: f.currency, maximumFractionDigits: 0 })}${tt('perHour')}` : ''}
        </span>
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{f.bookable ? tt('book') : tt('viewProfile')} →</span>
      </div>
    </Link>
  );
}
