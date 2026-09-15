'use client';

/**
 * Step 3 — be found. Whether the company is raising, what it is looking for, the
 * goal, who investors should reach, and whether the card takes inquiries. The
 * LIST/UNLIST decision itself is the wizard's summary action, not a field here:
 * it is a transition with a completeness gate, and a checkbox hides that.
 */

import { useTranslations } from 'next-intl';
import { SEEKING_TYPES } from '@builderforce/creation-canvas-contract';
import type { StartupListingPatch } from '@/lib/investorApi';
import { useStartupLabels } from '../useStartupLabels';
import { checkRowStyle, fieldGridStyle, hintStyle, inputStyle, labelStyle } from './listingFormStyles';

export function VisibilityStep({ draft, onChange }: { draft: StartupListingPatch; onChange: (patch: StartupListingPatch) => void }) {
  const t = useTranslations('investor.listing.visibility');
  const labels = useStartupLabels();
  const set = <K extends keyof StartupListingPatch>(key: K, value: StartupListingPatch[K]) => onChange({ ...draft, [key]: value });
  const seeking = draft.seeking ?? [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-body)' }}>{t('title')}</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('blurb')}</p>
      </div>

      <div>
        <span style={labelStyle}>{t('seeking')}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SEEKING_TYPES.map((type) => {
            const on = seeking.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={on}
                className={`ui-badge ${on ? 'ui-badge--accent' : 'ui-badge--neutral'}`}
                style={{ cursor: 'pointer', minHeight: 30 }}
                onClick={() => set('seeking', on ? seeking.filter((s) => s !== type) : [...seeking, type])}
              >
                {labels.seeking(type)}
              </button>
            );
          })}
        </div>
      </div>

      <label style={checkRowStyle}>
        <input type="checkbox" checked={draft.isSeekingInvestment ?? false} onChange={(e) => set('isSeekingInvestment', e.target.checked)} style={{ marginTop: 3 }} />
        <span><b style={{ color: 'var(--text-primary)' }}>{t('raising')}</b><br />{t('raisingHint')}</span>
      </label>

      {draft.isSeekingInvestment && (
        <div style={fieldGridStyle}>
          <div>
            <label style={labelStyle} htmlFor="lst-goal">{t('goal')}</label>
            <input id="lst-goal" type="number" min={0} step={25_000} style={inputStyle} value={draft.fundingGoal ?? ''} onChange={(e) => set('fundingGoal', e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="lst-raised">{t('raised')}</label>
            <input id="lst-raised" type="number" min={0} step={25_000} style={inputStyle} value={draft.totalFundingRaised ?? ''} onChange={(e) => set('totalFundingRaised', e.target.value ? Number(e.target.value) : null)} />
            <span style={hintStyle}>{t('raisedHint')}</span>
          </div>
        </div>
      )}

      <label style={checkRowStyle}>
        <input type="checkbox" checked={draft.allowInvestorInquiries ?? true} onChange={(e) => set('allowInvestorInquiries', e.target.checked)} style={{ marginTop: 3 }} />
        <span><b style={{ color: 'var(--text-primary)' }}>{t('inquiries')}</b><br />{t('inquiriesHint')}</span>
      </label>

      <div style={fieldGridStyle}>
        <div>
          <label style={labelStyle} htmlFor="lst-contact-name">{t('contactName')}</label>
          <input id="lst-contact-name" style={inputStyle} value={draft.investorContactName ?? ''} onChange={(e) => set('investorContactName', e.target.value || null)} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="lst-contact-email">{t('contactEmail')}</label>
          <input id="lst-contact-email" type="email" style={inputStyle} value={draft.investorContactEmail ?? ''} onChange={(e) => set('investorContactEmail', e.target.value || null)} />
          <span style={hintStyle}>{t('contactHint')}</span>
        </div>
      </div>
    </div>
  );
}
