'use client';

/**
 * One listed startup, as a marketplace card.
 *
 * BurnRateOS's `BusinessProfileCard`, minus the three things that made it a
 * second design system: Mantine, a per-stage colour legend nobody has, and a
 * favourite/share pair that wrote nowhere. What survives is what a reader
 * decides on — name, one line, stage, sector, whether it is raising, the money
 * facts it chose to publish, where and when it was founded — and ONE action.
 *
 * The whole card is the link to the profile; the button stops propagation
 * because "express interest" is not "read more".
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { startupProfilePath } from '@builderforce/creation-canvas-contract';
import { Icon } from '@/components/ui/Icon';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import type { StartupCard as StartupCardData } from '@/lib/startupDirectory';
import { useStartupLabels } from './useStartupLabels';
import {
  runwayHealthTone,
  startupCardStyle,
  startupChipStyle,
  startupLogoStyle,
  startupMetricRowStyle,
  startupMutedStyle,
  startupPrimaryButtonStyle,
} from './startupStyles';

export function startupInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function StartupCard({ startup, onInquire }: { startup: StartupCardData; onInquire?: (startup: StartupCardData) => void }) {
  const t = useTranslations('startups.card');
  const labels = useStartupLabels();
  const { formatMoney } = useMoneyFormat();
  const tone = startup.runwayHealth ? runwayHealthTone[startup.runwayHealth] : null;
  const place = [startup.city, startup.country].filter(Boolean).join(', ');

  return (
    <Link href={startupProfilePath(startup.slug)} style={startupCardStyle} className="hover-lift">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={startupLogoStyle} aria-hidden>
          {startup.logoUrl
            // eslint-disable-next-line @next/next/no-img-element -- a founder-supplied URL; next/image needs a known host
            ? <img src={startup.logoUrl} alt="" width={44} height={44} style={{ objectFit: 'cover' }} />
            : startupInitial(startup.name)}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <b style={{ fontSize: 'var(--font-size-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{startup.name}</b>
            {startup.website && <Icon name="external-link" size={12} />}
          </span>
          {startup.tagline && (
            <span style={{ ...startupMutedStyle, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{startup.tagline}</span>
          )}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {startup.stage && <span style={startupChipStyle}>{labels.stage(startup.stage)}</span>}
        {startup.sector && <span style={startupChipStyle}>{labels.sector(startup.sector)}</span>}
        {startup.isSeekingInvestment && <span className="ui-badge ui-badge--success">{t('raising')}</span>}
        {tone && startup.runwayHealth && (
          <span style={{ ...startupChipStyle, color: tone.ink, background: tone.bg, borderColor: 'transparent' }}>
            {t('runwayHealth', { health: labels.health(startup.runwayHealth) })}
          </span>
        )}
      </div>

      {startup.description && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {startup.description}
        </p>
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={startupMetricRowStyle}>
          <span>{t('totalFunding')}</span>
          <b style={{ color: 'var(--text-primary)' }}>{formatMoney(startup.totalFundingRaised ?? 0, { maximumFractionDigits: 0 })}</b>
        </div>
        {startup.monthlyRevenue != null && startup.monthlyRevenue > 0 && (
          <div style={startupMetricRowStyle}>
            <span>{t('mrr')}</span>
            <b style={{ color: 'var(--text-primary)' }}>{formatMoney(startup.monthlyRevenue, { maximumFractionDigits: 0 })}</b>
          </div>
        )}
        {startup.headcount != null && startup.headcount > 0 && (
          <div style={startupMetricRowStyle}>
            <span>{t('team')}</span>
            <b style={{ color: 'var(--text-primary)' }}>{t('people', { count: startup.headcount })}</b>
          </div>
        )}
        {startup.runwayMonths != null && (
          <div style={startupMetricRowStyle}>
            <span>{t('runway')}</span>
            <b style={{ color: tone?.ink ?? 'var(--text-primary)' }}>{t('months', { count: Math.round(startup.runwayMonths) })}</b>
          </div>
        )}
      </div>

      <div style={{ ...startupMetricRowStyle, marginTop: 'auto' }}>
        <span>{place || t('noLocation')}</span>
        {startup.foundedYear && <span>{t('founded', { year: startup.foundedYear })}</span>}
      </div>

      {startup.inquiryCount > 0 && (
        <span style={startupMutedStyle}>{t('interested', { count: startup.inquiryCount })}</span>
      )}

      {onInquire && startup.acceptsInquiries && (
        <button
          type="button"
          style={startupPrimaryButtonStyle}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onInquire(startup); }}
        >
          {t('expressInterest')}
        </button>
      )}
    </Link>
  );
}
