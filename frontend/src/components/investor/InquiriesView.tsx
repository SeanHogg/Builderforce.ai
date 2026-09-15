/**
 * Investor interest — who pressed "express interest" on this company's card,
 * what they said, and the founder's triage of each.
 *
 * These are `deal_flow_opportunities` rows narrowed to this company; the CRO's
 * queue shows the same rows beside every other inbound. One table, two views,
 * and the triage statuses are the queue's own (`new · qualifying · converted ·
 * rejected`) so a founder marking an investor "converted" here is what the
 * revenue report counts.
 *
 * No `'use client'`: the boundary is `InvestorClient.tsx`.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { INQUIRY_STATUSES, type InquiryStatus } from '@builderforce/creation-canvas-contract';
import { Select } from '@/components/Select';
import { useFormat } from '@/i18n/useFormat';
import { faultMessage } from '@/lib/apiClient';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { investorApi, type CompanyDetail, type InvestorInquiry } from '@/lib/investorApi';
import { useStartupLabels } from '@/components/startups/useStartupLabels';
import { emptyStyle, errorStyle, gapChipStyle, inputStyle, listRowStyle, listStyle, mutedStyle, rowStyle, sectionStyle } from './investorStyles';

const STATUS_BADGE: Record<InquiryStatus, string> = {
  new: 'ui-badge--info',
  qualifying: 'ui-badge--warning',
  converted: 'ui-badge--success',
  rejected: 'ui-badge--neutral',
};

export function InquiriesView({ detail }: { detail: CompanyDetail | null }) {
  const t = useTranslations('investor.inquiries');
  const labels = useStartupLabels();
  const fmt = useFormat();
  const { formatMoney } = useMoneyFormat();
  const [rows, setRows] = useState<InvestorInquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const companyId = detail?.id ?? null;

  useEffect(() => {
    if (companyId == null) { setRows(null); return undefined; }
    let cancelled = false;
    investorApi.inquiries.list(companyId)
      .then((list) => { if (!cancelled) { setRows(list); setError(null); } })
      .catch((cause: unknown) => { if (!cancelled) { setRows([]); setError(faultMessage(cause, t('error.load'))); } });
    return () => { cancelled = true; };
  }, [companyId, t]);

  const triage = useCallback((inquiry: InvestorInquiry, status: InquiryStatus) => {
    if (companyId == null || status === inquiry.status) return;
    setBusyId(inquiry.id);
    setError(null);
    investorApi.inquiries.triage(companyId, inquiry.id, status)
      .then((updated) => setRows((list) => (list ?? []).map((row) => (row.id === updated.id ? updated : row))))
      .catch((cause: unknown) => setError(faultMessage(cause, t('error.triage'))))
      .finally(() => setBusyId(null));
  }, [companyId, t]);

  if (!detail) return <p style={mutedStyle}>{t('pickCompany')}</p>;

  const open = (rows ?? []).filter((row) => row.status === 'new' || row.status === 'qualifying').length;

  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('title', { name: detail.name })}</h2>
          <p style={mutedStyle}>{t('blurb')}</p>
        </div>
        {rows && <span style={gapChipStyle}>{t('openCount', { count: open })}</span>}
      </div>

      {error && <p style={errorStyle} role="alert">{error}</p>}
      {rows === null && !error && <p style={mutedStyle}>{t('loading')}</p>}
      {rows?.length === 0 && <p style={emptyStyle}>{t('empty')}</p>}

      {!!rows?.length && (
        <ul style={listStyle}>
          {rows.map((inquiry) => {
            const details = inquiry.details as Record<string, unknown>;
            const expertise = Array.isArray(details.areasOfExpertise) ? (details.areasOfExpertise as string[]) : [];
            return (
              <li key={inquiry.id} style={{ ...listRowStyle, alignItems: 'flex-start', flexDirection: 'column' }}>
                <div style={{ ...rowStyle, width: '100%' }}>
                  <span style={{ minWidth: 0 }}>
                    <b style={{ display: 'block' }}>{inquiry.investorName ?? t('anonymous')}</b>
                    <small style={mutedStyle}>
                      {[inquiry.investorCompany, typeof details.investorTitle === 'string' ? details.investorTitle : null, inquiry.investorEmail].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={`ui-badge ${STATUS_BADGE[inquiry.status] ?? 'ui-badge--neutral'}`}>{labels.inquiryStatus(inquiry.status)}</span>
                    <Select
                      aria-label={t('triage')}
                      value={inquiry.status}
                      disabled={busyId === inquiry.id}
                      onChange={(e) => triage(inquiry, e.target.value as InquiryStatus)}
                      style={{ ...inputStyle, width: 'auto' }}
                    >
                      {INQUIRY_STATUSES.map((status) => <option key={status} value={status}>{labels.inquiryStatus(status)}</option>)}
                    </Select>
                  </span>
                </div>
                {inquiry.message && <p style={{ margin: 0, fontSize: 'var(--font-size-small)', whiteSpace: 'pre-wrap' }}>{inquiry.message}</p>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {inquiry.interestedAmount != null && inquiry.interestedAmount > 0 && (
                    <span style={gapChipStyle}>{t('amount', { amount: formatMoney(inquiry.interestedAmount, { maximumFractionDigits: 0 }) })}</span>
                  )}
                  {typeof details.investmentType === 'string' && details.investmentType && <span style={gapChipStyle}>{labels.investmentType(details.investmentType)}</span>}
                  {typeof details.timeframe === 'string' && details.timeframe && <span style={gapChipStyle}>{labels.timeframe(details.timeframe)}</span>}
                  {details.isAccredited === true && <span style={gapChipStyle}>{t('accredited')}</span>}
                  {expertise.map((area) => <span key={area} style={gapChipStyle}>{labels.expertise(area)}</span>)}
                </div>
                {typeof details.investmentHistory === 'string' && details.investmentHistory && (
                  <p style={{ ...mutedStyle, margin: 0, whiteSpace: 'pre-wrap' }}>{details.investmentHistory}</p>
                )}
                <small style={mutedStyle}>{t('received', { date: fmt.dateTime(new Date(inquiry.createdAt)) })}</small>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
