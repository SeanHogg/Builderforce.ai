'use client';

import { useTranslations } from 'next-intl';
import type { FreelancerStats } from '@/lib/freelancerApi';

/**
 * Shared trust signal — the derived Top-Rated / Rising-Talent badge and (optionally)
 * the Job Success Score. ONE component every talent surface (detail, marketplace card,
 * workforce list) uses so the badge reads identically everywhere and decides its own
 * visibility (renders null when there is nothing to show). See deriveReputation() on
 * the API for how the badge + JSS are computed.
 */
export function TrustBadge({ badge, jss, size = 'md', showJss = true }: {
  badge: FreelancerStats['badge'];
  jss?: number | null;
  size?: 'sm' | 'md';
  showJss?: boolean;
}) {
  const t = useTranslations('trust');
  if (!badge && (jss == null || !showJss)) return null;

  const pad = size === 'sm' ? '1px 7px' : '3px 9px';
  const fs = size === 'sm' ? 11 : 12;
  const tone = badge === 'top_rated'
    ? { bg: 'var(--surface-coral-soft)', fg: 'var(--coral-bright, #f4726e)', icon: '★', label: t('topRated') }
    : badge === 'rising_talent'
      ? { bg: 'rgba(34,197,94,0.12)', fg: 'rgba(34,197,94,0.95)', icon: '↑', label: t('risingTalent') }
      : null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {tone && (
        <span title={t('badgeTip')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: fs, fontWeight: 700, padding: pad, borderRadius: 999, background: tone.bg, color: tone.fg, whiteSpace: 'nowrap' }}>
          <span aria-hidden>{tone.icon}</span>{tone.label}
        </span>
      )}
      {showJss && jss != null && (
        <span title={t('jssTip')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: fs, fontWeight: 700, padding: pad, borderRadius: 999, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: jss >= 90 ? 'rgba(34,197,94,0.95)' : jss >= 75 ? 'var(--coral-bright, #f4726e)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {t('jss')} {jss}%
        </span>
      )}
    </span>
  );
}
