'use client';

/**
 * "Express interest" — the investor's form, as a slide-out over whatever they
 * were reading (the directory, a profile, the explainer).
 *
 * BurnRateOS shipped this twice (`InvestorInquiryDrawer` and `InvestorInquiryModal`,
 * 649 lines between them, one form). Once here, and as a panel: a modal is for a
 * destructive approval, and telling a founder you would like to invest is the
 * opposite of destructive.
 *
 * Self-contained: owns its form state, its submission and its success state, and
 * needs only the company's slug and name — so the card, the profile page and the
 * teaser mount it without knowing anything else about each other.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  EXPERTISE_AREAS,
  INQUIRY_TIMEFRAMES,
  INVESTMENT_TYPES,
  LISTING_LIMITS,
} from '@builderforce/creation-canvas-contract';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { publicStartupApi, type InquiryReceipt } from '@/lib/startupDirectory';
import { useStartupLabels } from './useStartupLabels';
import { startupPrimaryButtonStyle } from './startupStyles';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  padding: '9px 10px',
  fontSize: 'var(--font-size-small)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

const grid: React.CSSProperties = { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' };

interface Draft {
  investorName: string;
  investorEmail: string;
  investorCompany: string;
  investorTitle: string;
  investorPhone: string;
  interestedAmount: string;
  investmentType: string;
  timeframe: string;
  isAccredited: boolean;
  areasOfExpertise: string[];
  investmentHistory: string;
  message: string;
}

const EMPTY: Draft = {
  investorName: '', investorEmail: '', investorCompany: '', investorTitle: '', investorPhone: '',
  interestedAmount: '', investmentType: '', timeframe: '', isAccredited: false, areasOfExpertise: [],
  investmentHistory: '', message: '',
};

export function ExpressInterestPanel({
  open,
  onClose,
  company,
}: {
  open: boolean;
  onClose: () => void;
  company: { slug: string; name: string } | null;
}) {
  const t = useTranslations('startups.inquiry');
  const labels = useStartupLabels();
  const errorMessage = useErrorMessage();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<InquiryReceipt | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const close = () => { if (busy) return; setDraft(EMPTY); setSent(null); setError(null); onClose(); };

  const canSend = draft.investorName.trim().length >= 2
    && /^\S+@\S+\.\S+$/.test(draft.investorEmail)
    && draft.message.trim().length >= LISTING_LIMITS.inquiryMessageMin;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!company || !canSend) return;
    setBusy(true);
    setError(null);
    try {
      const receipt = await publicStartupApi.inquire(company.slug, {
        investorName: draft.investorName.trim(),
        investorEmail: draft.investorEmail.trim(),
        investorCompany: draft.investorCompany.trim() || null,
        investorTitle: draft.investorTitle.trim() || null,
        investorPhone: draft.investorPhone.trim() || null,
        interestedAmount: draft.interestedAmount ? Number(draft.interestedAmount) : null,
        investmentType: draft.investmentType || null,
        timeframe: draft.timeframe || null,
        isAccredited: draft.isAccredited,
        areasOfExpertise: draft.areasOfExpertise,
        investmentHistory: draft.investmentHistory.trim() || null,
        message: draft.message.trim(),
      });
      setSent(receipt);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!company) return null;

  return (
    <SlideOutPanel open={open} onClose={close} title={t('title')} crumb={company.name} width="sheet" accentVar="--seat-ceo">
      {sent ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>{t('sentTitle')}</p>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('sentBody', { name: sent.companyName })}</p>
          <button type="button" className="ui-button ui-button--secondary" onClick={close}>{t('done')}</button>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('intro', { name: company.name })}</p>

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            <legend style={labelStyle}>{t('you')}</legend>
            <div style={grid}>
              <div><label style={labelStyle} htmlFor="inq-name">{t('name')}</label><input id="inq-name" style={fieldStyle} required value={draft.investorName} onChange={(e) => set('investorName', e.target.value)} /></div>
              <div><label style={labelStyle} htmlFor="inq-email">{t('email')}</label><input id="inq-email" type="email" style={fieldStyle} required value={draft.investorEmail} onChange={(e) => set('investorEmail', e.target.value)} /></div>
              <div><label style={labelStyle} htmlFor="inq-firm">{t('firm')}</label><input id="inq-firm" style={fieldStyle} value={draft.investorCompany} onChange={(e) => set('investorCompany', e.target.value)} /></div>
              <div><label style={labelStyle} htmlFor="inq-title">{t('role')}</label><input id="inq-title" style={fieldStyle} value={draft.investorTitle} onChange={(e) => set('investorTitle', e.target.value)} /></div>
              <div><label style={labelStyle} htmlFor="inq-phone">{t('phone')}</label><input id="inq-phone" type="tel" style={fieldStyle} value={draft.investorPhone} onChange={(e) => set('investorPhone', e.target.value)} /></div>
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            <legend style={labelStyle}>{t('investment')}</legend>
            <div style={grid}>
              <div><label style={labelStyle} htmlFor="inq-amount">{t('amount')}</label><input id="inq-amount" type="number" min={0} step={1000} style={fieldStyle} value={draft.interestedAmount} onChange={(e) => set('interestedAmount', e.target.value)} /></div>
              <div>
                <label style={labelStyle} htmlFor="inq-type">{t('instrument')}</label>
                <Select id="inq-type" value={draft.investmentType} onChange={(e) => set('investmentType', e.target.value)} style={fieldStyle}>
                  <option value="">{t('pick')}</option>
                  {INVESTMENT_TYPES.map((type) => <option key={type} value={type}>{labels.investmentType(type)}</option>)}
                </Select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="inq-time">{t('timeframe')}</label>
                <Select id="inq-time" value={draft.timeframe} onChange={(e) => set('timeframe', e.target.value)} style={fieldStyle}>
                  <option value="">{t('pick')}</option>
                  {INQUIRY_TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{labels.timeframe(tf)}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <span style={labelStyle}>{t('expertise')}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {EXPERTISE_AREAS.map((area) => {
                  const on = draft.areasOfExpertise.includes(area);
                  return (
                    <button
                      key={area}
                      type="button"
                      aria-pressed={on}
                      className={`ui-badge ${on ? 'ui-badge--accent' : 'ui-badge--neutral'}`}
                      style={{ cursor: 'pointer', minHeight: 30 }}
                      onClick={() => set('areasOfExpertise', on ? draft.areasOfExpertise.filter((a) => a !== area) : [...draft.areasOfExpertise, area])}
                    >
                      {labels.expertise(area)}
                    </button>
                  );
                })}
              </div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={draft.isAccredited} onChange={(e) => set('isAccredited', e.target.checked)} style={{ marginTop: 3 }} />
              <span><b style={{ color: 'var(--text-primary)' }}>{t('accredited')}</b><br />{t('accreditedHint')}</span>
            </label>
          </fieldset>

          <div>
            <label style={labelStyle} htmlFor="inq-message">{t('message')}</label>
            <textarea id="inq-message" required minLength={LISTING_LIMITS.inquiryMessageMin} rows={4} style={{ ...fieldStyle, resize: 'vertical' }} placeholder={t('messagePlaceholder')} value={draft.message} onChange={(e) => set('message', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="inq-history">{t('history')}</label>
            <textarea id="inq-history" rows={3} style={{ ...fieldStyle, resize: 'vertical' }} placeholder={t('historyPlaceholder')} value={draft.investmentHistory} onChange={(e) => set('investmentHistory', e.target.value)} />
          </div>

          {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="ui-button ui-button--ghost" onClick={close} disabled={busy}>{t('cancel')}</button>
            <button type="submit" style={{ ...startupPrimaryButtonStyle, width: 'auto' }} disabled={busy || !canSend}>
              {busy ? t('sending') : t('send')}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('privacy')}</p>
        </form>
      )}
    </SlideOutPanel>
  );
}
