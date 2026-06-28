'use client';

/**
 * Consolidated Finance hub — the single entry point at /insights/finance that
 * replaces the three separate routes (FinOps spend, Investment Allocation and
 * DevFinOps). It renders one launcher tile per financial capability; clicking a
 * tile drills into the full lens in the shared slide-out side panel (see
 * FinancePanelProvider) rather than navigating away, so the user can pivot
 * between them in place.
 *
 * Built as a plain reusable component (no page chrome of its own) so the Brain
 * can drop it into a conversation too. `initialDrill` lets the retired-route
 * redirects deep-link straight into a panel.
 */

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useFinancePanel } from './FinancePanelProvider';
import { FINANCE_PANELS, isFinancePanelId, type FinancePanelId } from './financePanels';

export function FinanceHub({ initialDrill }: { initialDrill?: string }) {
  const t = useTranslations('insights');
  const { open } = useFinancePanel();

  useEffect(() => {
    if (isFinancePanelId(initialDrill)) open(initialDrill as FinancePanelId);
  }, [initialDrill, open]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
      {FINANCE_PANELS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => open(p.id)}
          style={tileStyle}
          aria-label={t('finhub.openPanel', { name: t(p.titleKey) })}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden style={{ fontSize: '1.4rem', lineHeight: 1 }}>{p.icon}</span>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{t(p.titleKey)}</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{t(p.subtitleKey)}</p>
          <span style={{ marginTop: 'auto', fontSize: '0.82rem', fontWeight: 600, color: 'var(--coral-bright, #f4726e)' }}>
            {t('finhub.viewDetails')} →
          </span>
        </button>
      ))}
    </div>
  );
}

const tileStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', minHeight: 150, padding: 18,
  borderRadius: 14, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', cursor: 'pointer',
};
