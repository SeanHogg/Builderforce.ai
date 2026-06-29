'use client';

/**
 * Consolidated AI Insights hub — the single entry point at /insights/ai that
 * replaces the three separate routes (AI Impact, AI Effectiveness and
 * Recommendations). It shows an at-a-glance summary for each, and every section
 * drills down into the full lens in an interactive slide-out side panel (see
 * AiInsightPanelProvider). Mirrors the Finance hub's FinanceDashboard.
 *
 * Unlike Finance (one bundled audit read), the three AI reports come from
 * distinct collectors, so each summary owns its read and reacts to the shared
 * time-window selector.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PmCard } from '@/components/pm/pmShared';
import { AiConsumptionHeader } from './AiConsumptionHeader';
import { DaysWindowSelect } from './LensShell';
import { useAiInsightPanel } from './AiInsightPanelProvider';
import { AI_INSIGHT_PANELS, AI_INSIGHT_PANEL_IDS, isAiInsightPanelId, type AiInsightPanelId } from './aiInsightPanels';

/** The "open the full lens" affordance, shared by every dashboard section. */
function DrillButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)',
        background: 'transparent', color: 'var(--accent, #2563eb)', cursor: 'pointer',
        fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap',
      }}
    >
      {label} →
    </button>
  );
}

export function AiInsightsDashboard() {
  const t = useTranslations('insights.aihub');
  const [days, setDays] = useState(30);
  const { open } = useAiInsightPanel();
  const searchParams = useSearchParams();

  // Deep-link: /insights/ai?panel=engineering (and the redirects from the
  // retired /insights/ai-impact, /engineering, /recommendations routes)
  // auto-open the drill-down.
  const panelParam = searchParams?.get('panel');
  useEffect(() => {
    if (isAiInsightPanelId(panelParam)) open(panelParam as AiInsightPanelId);
  }, [panelParam, open]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      {/* Headline: total AI tokens consumed this month (all-members, always shown). */}
      <AiConsumptionHeader />

      {AI_INSIGHT_PANEL_IDS.map((id) => {
        const def = AI_INSIGHT_PANELS[id];
        const Summary = def.Summary;
        return (
          <PmCard
            key={id}
            title={`${def.icon} ${t(def.titleKey)}`}
            action={<DrillButton label={t('viewReport')} onClick={() => open(id)} />}
          >
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '-6px 0 14px' }}>{t(def.descKey)}</p>
            <Summary days={days} />
          </PmCard>
        );
      })}
    </div>
  );
}
