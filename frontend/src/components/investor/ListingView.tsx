/**
 * Public listing — the company's face in the marketplace (B2).
 *
 * Two states of one sub-view: the SUMMARY (how complete the profile is, whether
 * it is live, the public address, the declared runway, list/withdraw) and the
 * WIZARD that edits it. A workspace with no company yet opens straight into the
 * wizard, because the first step creates one — which is how a founder who
 * registered with `intent=startup` lands here and leaves with a listed company.
 *
 * No `'use client'`: the boundary is `InvestorClient.tsx`.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { startupProfilePath } from '@builderforce/creation-canvas-contract';
import { faultMessage } from '@/lib/apiClient';
import { investorApi, type CompanySummary, type StartupListing } from '@/lib/investorApi';
import { RunwayVerdictCard } from '@/components/startups/RunwayVerdictCard';
import { StartupListingWizard } from '@/components/startups/onboarding/StartupListingWizard';
import { useStartupLabels } from '@/components/startups/useStartupLabels';
import {
  buttonStyle, cardStyle, emptyStyle, errorStyle, gapChipStyle, mutedStyle, primaryButtonStyle, rowStyle, sectionStyle,
} from './investorStyles';

export function ListingView({
  companies,
  companyId,
  startEditing,
  onCompanyCreated,
  onChanged,
}: {
  companies: CompanySummary[];
  companyId: number | null;
  /** `?start=1` — arrive with the wizard open. */
  startEditing: boolean;
  onCompanyCreated: (companyId: number) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('investor.listing');
  const labels = useStartupLabels();
  const [listing, setListing] = useState<StartupListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(startEditing || companies.length === 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (companyId == null) { setListing(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    investorApi.listing.get(companyId)
      .then((facet) => { if (!cancelled) { setListing(facet); setError(null); } })
      .catch((cause: unknown) => { if (!cancelled) setError(faultMessage(cause, t('error.load'))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, t]);

  const saved = useCallback((facet: StartupListing) => {
    setListing(facet);
    if (facet.companyId !== companyId) onCompanyCreated(facet.companyId);
    onChanged();
  }, [companyId, onChanged, onCompanyCreated]);

  const listed = useCallback((facet: StartupListing) => { saved(facet); setEditing(false); }, [saved]);

  const toggleListed = useCallback(() => {
    if (!listing) return;
    setBusy(true);
    setError(null);
    investorApi.listing.setVisibility(listing.companyId, !listing.isPubliclyListed)
      .then(saved)
      .catch((cause: unknown) => setError(faultMessage(cause, t('error.visibility'))))
      .finally(() => setBusy(false));
  }, [listing, saved, t]);

  const noCompany = companies.length === 0 && companyId == null;

  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('title')}</h2>
          <p style={mutedStyle}>{t('blurb')}</p>
        </div>
        {!editing && listing && (
          <button type="button" style={buttonStyle} onClick={() => setEditing(true)}>{t('edit')}</button>
        )}
      </div>

      {error && <p style={errorStyle} role="alert">{error}</p>}

      {(editing || noCompany) ? (
        <div style={cardStyle}>
          <StartupListingWizard
            key={listing?.companyId ?? 'new'}
            listing={listing}
            onSaved={saved}
            onListed={listed}
            onCancel={listing ? () => setEditing(false) : undefined}
          />
        </div>
      ) : loading && !listing ? (
        <p style={mutedStyle}>{t('loading')}</p>
      ) : listing ? (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', alignItems: 'start' }}>
          <div style={{ ...cardStyle, display: 'grid', gap: 10 }}>
            <div style={rowStyle}>
              <b>{listing.name}</b>
              <span className={`ui-badge ${listing.isPubliclyListed ? 'ui-badge--success' : 'ui-badge--neutral'}`}>
                {listing.isPubliclyListed ? t('live') : t('draft')}
              </span>
            </div>
            {listing.tagline && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{listing.tagline}</p>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {listing.stage && <span style={gapChipStyle}>{labels.stage(listing.stage)}</span>}
              {listing.sector && <span style={gapChipStyle}>{labels.sector(listing.sector)}</span>}
              {listing.isSeekingInvestment && <span style={gapChipStyle}>{t('raisingChip')}</span>}
            </div>
            <div>
              <div style={{ ...rowStyle, marginBottom: 4 }}>
                <span style={mutedStyle}>{t('completeness')}</span>
                <b style={{ fontSize: 'var(--font-size-small)' }}>{listing.completeness.percent}%</b>
              </div>
              <div role="progressbar" aria-valuenow={listing.completeness.percent} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 'var(--radius-full)', background: 'var(--surface-sunken)', overflow: 'hidden' }}>
                <div style={{ width: `${listing.completeness.percent}%`, height: '100%', background: 'var(--seat-ceo)' }} />
              </div>
              {listing.completeness.missing.length > 0 && (
                <p style={{ ...mutedStyle, marginTop: 6 }}>{t('missing', { fields: listing.completeness.missing.map((f) => t(`fields.${f}`)).join(', ') })}</p>
              )}
            </div>
            {listing.isPubliclyListed && listing.slug && (
              <p style={{ margin: 0, fontSize: 'var(--font-size-small)' }}>
                <Link href={startupProfilePath(listing.slug)} target="_blank" rel="noopener noreferrer">{t('viewPublic')} →</Link>
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={listing.isPubliclyListed ? buttonStyle : primaryButtonStyle}
                onClick={toggleListed}
                disabled={busy || (!listing.isPubliclyListed && listing.completeness.missing.length > 0)}
              >
                {listing.isPubliclyListed ? t('withdraw') : t('listNow')}
              </button>
              <Link href="/marketplace?family=company&kind=business" style={{ ...buttonStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>{t('openDirectory')}</Link>
            </div>
            <p style={{ ...mutedStyle, margin: 0 }}>{listing.isPubliclyListed ? t('liveNotice') : t('draftNotice')}</p>
          </div>
          <RunwayVerdictCard verdict={listing.finance.declaredAt ? listing.runway : null} provenance="declared" />
        </div>
      ) : (
        <p style={emptyStyle}>{t('pickCompany')}</p>
      )}
    </div>
  );
}
