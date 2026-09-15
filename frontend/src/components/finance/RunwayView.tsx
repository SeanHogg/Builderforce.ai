/**
 * Runway — BurnRateOS's Runway Tracker, with the one thing it lacked: the word
 * "declared" or "observed" beside every figure.
 *
 * Two columns. OBSERVED is what the rollup computed from approved spend, payroll
 * and connected books — present only once there is any. DECLARED is what the
 * founder typed, editable right here through the ONE calculator, and saved to the
 * company. The monthly table under them is the observed series; the declared
 * projection is the cashflow view's.
 *
 * No `'use client'`: the boundary is `FinanceClient.tsx`.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { computeRunway } from '@builderforce/creation-canvas-contract';
import { useFormat } from '@/i18n/useFormat';
import { faultMessage } from '@/lib/apiClient';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { investorApi } from '@/lib/investorApi';
import type { RunwayReport } from '@/lib/financeApi';
import { RunwayCalculator, type RunwayInputs } from '@/components/startups/RunwayCalculator';
import { RunwayVerdictCard } from '@/components/startups/RunwayVerdictCard';
import {
  cardStyle, emptyStyle, errorStyle, gapChipStyle, mutedStyle, primaryButtonStyle, rowStyle, sectionStyle,
  tableStyle, tableWrapStyle, tdStyle, thStyle,
} from './financeStyles';

export function RunwayView({ report, onDeclared }: { report: RunwayReport; onDeclared: () => void }) {
  const t = useTranslations('financeHub.runway');
  const fmt = useFormat();
  const { formatMoney } = useMoneyFormat();
  const declared = report.declared;
  const [inputs, setInputs] = useState<RunwayInputs>(() => ({
    cashOnHand: declared?.finance.cashOnHand ?? null,
    monthlyBudget: declared?.finance.monthlyBudget ?? null,
    monthlyRevenue: declared?.finance.monthlyRevenue ?? null,
    teamCost: declared?.finance.teamCost ?? null,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // No effect re-seeds `inputs`: `FinanceClient` keys this view by company, so a
  // company switch remounts it and the initial state above IS the declared numbers.
  // A keystroke never gets overwritten by a refetch that returns the same values.

  const save = useCallback(() => {
    if (!declared) return;
    setBusy(true);
    setError(null);
    investorApi.listing.declareFinance(declared.companyId, {
      cashOnHand: inputs.cashOnHand,
      monthlyBudget: inputs.monthlyBudget,
      monthlyRevenue: inputs.monthlyRevenue,
      teamCost: inputs.teamCost ?? null,
    })
      .then(onDeclared)
      .catch((cause: unknown) => setError(faultMessage(cause, t('error.save'))))
      .finally(() => setBusy(false));
  }, [declared, inputs, onDeclared, t]);

  const money = (n: number | null) => (n == null ? '—' : formatMoney({ amount: n, currency: 'USD' }, { compact: false }));
  const observed = report.observed;
  const observedVerdict = observed.available && observed.cash != null && observed.monthlyBurn != null
    ? computeRunway({ cashOnHand: observed.cash, monthlyBudget: observed.monthlyBurn, monthlyRevenue: 0 })
    : null;

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', alignItems: 'start' }}>
        {/* OBSERVED */}
        <div style={{ ...cardStyle, display: 'grid', gap: 10 }}>
          <div style={rowStyle}>
            <span className="ui-eyebrow">{t('observed')}</span>
            {observed.asOf && <span style={gapChipStyle}>{t('asOf', { date: fmt.date(new Date(observed.asOf)) })}</span>}
          </div>
          {!observed.available ? (
            <p style={emptyStyle}>{t('observedEmpty')}</p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                <Stat label={t('cash')} value={money(observed.cash)} />
                <Stat label={t('netBurn')} value={money(observed.monthlyBurn)} />
                <Stat label={t('mrr')} value={money(observed.mrr)} />
                <Stat label={t('runwayMonths')} value={observed.runwayMonths == null ? '—' : t('months', { count: Math.round(observed.runwayMonths) })} />
              </div>
              {observedVerdict && <RunwayVerdictCard verdict={observedVerdict} provenance="observed" compact />}
            </>
          )}
          <p style={mutedStyle}>{t('observedHint')} <Link href="/settings/integrations">{t('connectBooks')}</Link></p>
        </div>

        {/* DECLARED */}
        <div style={{ ...cardStyle, display: 'grid', gap: 10 }}>
          <div style={rowStyle}>
            <span className="ui-eyebrow">{t('declared')}</span>
            {declared?.finance.declaredAt && <span style={gapChipStyle}>{t('asOf', { date: fmt.date(new Date(declared.finance.declaredAt)) })}</span>}
          </div>
          {!declared ? (
            <p style={emptyStyle}>{t('noCompany')} <Link href="/investor?tab=listing&start=1">{t('addCompany')}</Link></p>
          ) : (
            <>
              <p style={mutedStyle}>{t('declaredHint', { name: declared.companyName })}</p>
              <RunwayCalculator value={inputs} onChange={setInputs} withTeamCost idPrefix="fin" />
              {error && <p style={errorStyle} role="alert">{error}</p>}
              <div>
                <button type="button" style={primaryButtonStyle} onClick={save} disabled={busy}>{busy ? t('saving') : t('save')}</button>
              </div>
            </>
          )}
        </div>
      </div>

      {observed.months.length > 0 && (
        <div style={{ ...cardStyle, display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-body)' }}>{t('monthly')}</h3>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('col.month')}</th>
                  <th style={thStyle}>{t('col.revenue')}</th>
                  <th style={thStyle}>{t('col.expenses')}</th>
                  <th style={thStyle}>{t('col.netBurn')}</th>
                  <th style={thStyle}>{t('col.cash')}</th>
                </tr>
              </thead>
              <tbody>
                {observed.months.map((month) => {
                  const net = (month.burn ?? 0) - (month.revenue ?? 0);
                  return (
                    <tr key={month.month}>
                      <td style={tdStyle}>{month.month}</td>
                      <td style={tdStyle}>{money(month.revenue)}</td>
                      <td style={tdStyle}>{money(month.burn)}</td>
                      <td style={{ ...tdStyle, color: net > 0 ? 'var(--error-text)' : 'var(--success-text)' }}>{money(net)}</td>
                      <td style={tdStyle}>{money(month.cash)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={mutedStyle}>{t('monthlyNote')}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
