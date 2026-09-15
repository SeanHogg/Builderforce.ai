'use client';

/**
 * The free runway calculator on the Business Intelligence explainer — BurnRateOS's
 * `/tools/runway` page, folded into the CFO's own story.
 *
 * It computes in the browser before anybody signs in (the same principle as
 * Diagnostics: return a result before asking for anything), and its one CTA
 * carries the numbers INTO the product — a visitor lands on the listing wizard's
 * finance step with them; a signed-in founder lands on Finance. The formula is
 * the contract package's, so the figure a visitor sees here is the figure the
 * CFO seat will print for the same inputs.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { registerHref } from '@/lib/auth';
import { RunwayCalculator, type RunwayInputs } from '@/components/startups/RunwayCalculator';
import { LIST_YOUR_STARTUP_HREF, STARTUP_REGISTER_INTENT } from '@/components/startups/StartupDoors';

const STARTING: RunwayInputs = { cashOnHand: 500_000, monthlyBudget: 60_000, monthlyRevenue: 20_000 };

export function RunwayCalculatorSection() {
  const t = useTranslations('burnrateMarketing.extras.calculator');
  const { isAuthenticated } = useAuth();
  const [inputs, setInputs] = useState<RunwayInputs>(STARTING);
  const href = isAuthenticated ? '/finance' : registerHref(LIST_YOUR_STARTUP_HREF, STARTUP_REGISTER_INTENT);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <RunwayCalculator value={inputs} onChange={setInputs} idPrefix="mk-runway" />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link href={href} className="ui-button ui-button--primary">{isAuthenticated ? t('openFinance') : t('keepNumbers')} →</Link>
        <Link href="/tools" className="ui-button ui-button--ghost">{t('moreTools')}</Link>
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('note')}</span>
      </div>
    </div>
  );
}
