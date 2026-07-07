'use client';

import { useTranslations } from 'next-intl';
import { RatingStars } from '@/components/freelance/RatingStars';
import { TrustBadge } from '@/components/freelance/TrustBadge';
import type { FreelancerProfile, FreelancerStats } from '@/lib/freelancerApi';

/**
 * Presentational render of a for-hire profile — the SINGLE source of truth for how a
 * talent profile looks, shared by the public detail page (/talent/[id]) and the
 * "Preview" slide-out in the profile editor. Callers pass a fully-resolved profile
 * object plus an optional `actions` slot (hire buttons, an Edit button, …). No data
 * fetching here, so it renders identically from a saved row or unsaved editor state.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};

function initials(name: string | null): string {
  return (name ?? '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('') || '?';
}

export function TalentAvatar({ profile, size = 64 }: { profile: Pick<FreelancerProfile, 'displayName' | 'avatarUrl'>; size?: number }) {
  const common: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover',
    border: '1px solid var(--border-subtle)',
  };
  if (profile.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={profile.avatarUrl} alt="" style={common} />;
  }
  return (
    <div style={{
      ...common, background: 'var(--surface-interactive)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontWeight: 700, fontSize: size * 0.36, color: 'var(--text-primary)',
    }}>
      {initials(profile.displayName)}
    </div>
  );
}

/** Compact reputation stat row: how much this worker leans on AI, how active they've
 *  been, work won vs. bids in flight, and lifetime earnings. Rendered on the public
 *  detail page and the editor Preview (both pass a profile carrying `stats`). */
function TalentStats({ stats }: { stats: FreelancerStats }) {
  const t = useTranslations('talent');
  const num = (n: number) => n.toLocaleString();
  const money = (cents: number, cur: string) => `${cur} ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const tiles: { key: string; value: string; label: string; sub: string; accent: string }[] = [
    { key: 'aiUsage', value: num(stats.aiActions), label: t('stats.aiUsage'), sub: t('stats.aiUsageSub'), accent: 'var(--cyan-bright, #00e5cc)' },
    { key: 'activity', value: `${num(stats.activeDays)}${t('stats.daysSuffix')}`, label: t('stats.activity'), sub: t('stats.activitySub', { signals: num(stats.activitySignals) }), accent: 'var(--coral-bright, #f4726e)' },
    { key: 'awarded', value: num(stats.projectsAwarded), label: t('stats.awarded'), sub: t('stats.awardedSub', { count: stats.activeEngagements }), accent: 'rgba(34,197,94,0.9)' },
    { key: 'inProposal', value: num(stats.proposalsActive), label: t('stats.inProposal'), sub: t('stats.inProposalSub'), accent: 'rgba(245,158,11,0.95)' },
    { key: 'earned', value: money(stats.earnedToDateCents, stats.currency), label: t('stats.earned'), sub: t('stats.earnedSub'), accent: 'var(--text-primary)' },
  ];

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>{t('stats.title')}</div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))' }}>
        {tiles.map((tile) => (
          <div key={tile.key} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10,
            padding: '12px 14px', borderTop: `2px solid ${tile.accent}`,
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1, wordBreak: 'break-word' }}>{tile.value}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 4 }}>{tile.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{tile.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface TalentProfileViewProps {
  profile: FreelancerProfile;
  /** Header-right slot (hire buttons, an Edit button, …). */
  actions?: React.ReactNode;
  /** Message shown in the résumé card when there's no embed URL. */
  resumeEmptyNote?: string;
}

export function TalentProfileView({ profile, actions, resumeEmptyNote }: TalentProfileViewProps) {
  const t = useTranslations('talent');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', minWidth: 0 }}>
          <TalentAvatar profile={profile} size={64} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{profile.displayName ?? '—'}</h1>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>{profile.headline ?? profile.discipline ?? ''}</p>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <RatingStars rating={profile.rating} count={profile.ratingCount} size={15} />
              {profile.stats && <TrustBadge badge={profile.stats.badge} jss={profile.stats.jss} />}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              {profile.hourlyRateCents != null && <span>{t('rate')}: <strong style={{ color: 'var(--coral-bright)' }}>{profile.currency} {(profile.hourlyRateCents / 100).toFixed(0)}{t('perHour')}</strong></span>}
              {profile.location && <span>{t('location')}: {profile.location}</span>}
              <span>{t('availability')}: {profile.availability}</span>
            </div>
          </div>
        </div>
        {actions && <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>{actions}</div>}
      </div>

      {profile.stats && <TalentStats stats={profile.stats} />}

      {profile.bio && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{t('about')}</div>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{profile.bio}</p>
        </div>
      )}

      {profile.skills.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{t('skills')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {profile.skills.map((s) => (
              <span key={s} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {profile.reviews && profile.reviews.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('reviews')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {profile.reviews.map((r, i) => (
              <div key={i} style={{ borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none', paddingTop: i > 0 ? 12 : 0 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
                  <RatingStars rating={r.rating} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.reviewerName ?? ''}</span>
                </div>
                {r.comment && <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{r.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('resumeTitle')}</div>
        {profile.embedUrl ? (
          <iframe title={t('resumeTitle')} src={profile.embedUrl}
            style={{ width: '100%', height: 560, border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--bg-elevated)' }} />
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{resumeEmptyNote ?? t('noResume')}</p>
        )}
      </div>
    </div>
  );
}
