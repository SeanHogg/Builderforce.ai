'use client';

/**
 * Step 1 — tell us about your business. What the public card and the CEO
 * advisor both read: name, one line, the story, sector, stage, where, since
 * when, and who founded it.
 *
 * Controlled by the wizard: this renders fields over a `StartupListingPatch`
 * draft and reports edits. It knows nothing about saving.
 */

import { useTranslations } from 'next-intl';
import { BUSINESS_STAGES, FUNDING_STAGES, LISTING_LIMITS, STARTUP_SECTORS } from '@builderforce/creation-canvas-contract';
import { Select } from '@/components/Select';
import type { StartupListingPatch } from '@/lib/investorApi';
import { useStartupLabels } from '../useStartupLabels';
import { fieldGridStyle, hintStyle, inputStyle, labelStyle, textareaStyle } from './listingFormStyles';

export function CompanyBasicsStep({ draft, onChange }: { draft: StartupListingPatch; onChange: (patch: StartupListingPatch) => void }) {
  const t = useTranslations('investor.listing.basics');
  const labels = useStartupLabels();
  const set = <K extends keyof StartupListingPatch>(key: K, value: StartupListingPatch[K]) => onChange({ ...draft, [key]: value });
  const thisYear = new Date().getFullYear();

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-body)' }}>{t('title')}</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('blurb')}</p>
      </div>

      <div style={fieldGridStyle}>
        <div>
          <label style={labelStyle} htmlFor="lst-name">{t('name')}</label>
          <input id="lst-name" style={inputStyle} required maxLength={LISTING_LIMITS.name} value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="lst-website">{t('website')}</label>
          <input id="lst-website" type="url" style={inputStyle} placeholder="https://" value={draft.website ?? ''} onChange={(e) => set('website', e.target.value || null)} />
        </div>
      </div>

      <div>
        <label style={labelStyle} htmlFor="lst-tagline">{t('tagline')}</label>
        <input id="lst-tagline" style={inputStyle} maxLength={LISTING_LIMITS.tagline} placeholder={t('taglinePlaceholder')} value={draft.tagline ?? ''} onChange={(e) => set('tagline', e.target.value || null)} />
        <span style={hintStyle}>{t('taglineHint', { max: LISTING_LIMITS.tagline })}</span>
      </div>

      <div>
        <label style={labelStyle} htmlFor="lst-description">{t('description')}</label>
        <textarea id="lst-description" style={textareaStyle} maxLength={LISTING_LIMITS.description} placeholder={t('descriptionPlaceholder')} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value || null)} />
        <span style={hintStyle}>{t('descriptionHint')}</span>
      </div>

      <div style={fieldGridStyle}>
        <div>
          <label style={labelStyle} htmlFor="lst-sector">{t('sector')}</label>
          <Select id="lst-sector" value={draft.sector ?? ''} onChange={(e) => set('sector', e.target.value || null)} style={inputStyle}>
            <option value="">{t('pick')}</option>
            {STARTUP_SECTORS.map((sector) => <option key={sector} value={sector}>{labels.sector(sector)}</option>)}
          </Select>
        </div>
        <div>
          <label style={labelStyle} htmlFor="lst-stage">{t('stage')}</label>
          <Select id="lst-stage" value={draft.stage ?? ''} onChange={(e) => set('stage', e.target.value || null)} style={inputStyle}>
            <option value="">{t('pick')}</option>
            {FUNDING_STAGES.map((stage) => <option key={stage} value={stage}>{labels.stage(stage)}</option>)}
          </Select>
        </div>
        <div>
          <label style={labelStyle} htmlFor="lst-bstage">{t('businessStage')}</label>
          <Select id="lst-bstage" value={draft.businessStage ?? ''} onChange={(e) => set('businessStage', e.target.value || null)} style={inputStyle}>
            <option value="">{t('pick')}</option>
            {BUSINESS_STAGES.map((stage) => <option key={stage} value={stage}>{labels.businessStage(stage)}</option>)}
          </Select>
        </div>
      </div>

      <div style={fieldGridStyle}>
        <div>
          <label style={labelStyle} htmlFor="lst-city">{t('city')}</label>
          <input id="lst-city" style={inputStyle} maxLength={LISTING_LIMITS.city} value={draft.city ?? ''} onChange={(e) => set('city', e.target.value || null)} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="lst-country">{t('country')}</label>
          <input id="lst-country" style={{ ...inputStyle, textTransform: 'uppercase' }} maxLength={2} placeholder={t('countryPlaceholder')} value={draft.country ?? ''} onChange={(e) => set('country', e.target.value.toUpperCase() || null)} />
          <span style={hintStyle}>{t('countryHint')}</span>
        </div>
        <div>
          <label style={labelStyle} htmlFor="lst-founded">{t('foundedYear')}</label>
          <input id="lst-founded" type="number" min={1800} max={thisYear} style={inputStyle} value={draft.foundedYear ?? ''} onChange={(e) => set('foundedYear', e.target.value ? Number(e.target.value) : null)} />
        </div>
      </div>

      <div style={fieldGridStyle}>
        <div>
          <label style={labelStyle} htmlFor="lst-headcount">{t('headcount')}</label>
          <input id="lst-headcount" type="number" min={0} style={inputStyle} value={draft.headcount ?? ''} onChange={(e) => set('headcount', e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="lst-founders">{t('founders')}</label>
          <input id="lst-founders" type="number" min={0} max={50} style={inputStyle} value={draft.foundersCount ?? ''} onChange={(e) => set('foundersCount', e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="lst-logo">{t('logo')}</label>
          <input id="lst-logo" type="url" style={inputStyle} placeholder="https://" value={draft.logoUrl ?? ''} onChange={(e) => set('logoUrl', e.target.value || null)} />
        </div>
      </div>
    </div>
  );
}
