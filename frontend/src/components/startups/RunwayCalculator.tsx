'use client';

/**
 * The runway calculator — cash on hand, monthly spend, monthly revenue, and the
 * verdict beside them as you type.
 *
 * BurnRateOS shipped this three times: a free `/tools/runway` marketing page, the
 * onboarding's "financial context" step, and the Runway Tracker's inputs. Once
 * here, CONTROLLED: the parent owns the numbers (a marketing page keeps them in
 * state, the founder's step saves them), and this renders the fields and the
 * verdict. `teamCost` is optional because only the founder's step collects it —
 * it is a component of the budget, named so the CFO advisor can name the
 * largest line, and never added on top.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { computeRunway } from '@builderforce/creation-canvas-contract';
import { RunwayVerdictCard } from './RunwayVerdictCard';

export interface RunwayInputs {
  cashOnHand: number | null;
  monthlyBudget: number | null;
  monthlyRevenue: number | null;
  teamCost?: number | null;
}

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

const hintStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 4 };

export function RunwayCalculator({
  value,
  onChange,
  withTeamCost = false,
  idPrefix = 'runway',
}: {
  value: RunwayInputs;
  onChange: (next: RunwayInputs) => void;
  withTeamCost?: boolean;
  idPrefix?: string;
}) {
  const t = useTranslations('startups.calculator');
  const verdict = useMemo(() => computeRunway(value), [value]);
  const hasInputs = value.cashOnHand != null || value.monthlyBudget != null;

  const field = (key: keyof RunwayInputs, label: string, hint: string, step: number) => (
    <div>
      <label style={labelStyle} htmlFor={`${idPrefix}-${key}`}>{label}</label>
      <input
        id={`${idPrefix}-${key}`}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        style={fieldStyle}
        value={value[key] ?? ''}
        onChange={(e) => onChange({ ...value, [key]: e.target.value === '' ? null : Number(e.target.value) })}
      />
      <span style={hintStyle}>{hint}</span>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 12 }}>
        {field('cashOnHand', t('cash'), t('cashHint'), 10_000)}
        {field('monthlyBudget', t('budget'), t('budgetHint'), 1_000)}
        {field('monthlyRevenue', t('revenue'), t('revenueHint'), 1_000)}
        {withTeamCost && field('teamCost', t('teamCost'), t('teamCostHint'), 1_000)}
      </div>
      <RunwayVerdictCard verdict={hasInputs ? verdict : null} provenance="declared" />
    </div>
  );
}
