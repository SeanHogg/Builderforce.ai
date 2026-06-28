'use client';

/**
 * Consolidated DevEx hub — the single entry point at /insights/devex that
 * replaces the two separate tabs (DevEx survey results and the standalone
 * /surveys management page). It shows an at-a-glance summary for each surface,
 * and every section drills down into the full lens in an interactive slide-out
 * side panel (see DevexPanelProvider). The "New survey" action opens the same
 * surveys slide-out, where templates/campaigns are authored. Mirrors the AI
 * hub's AiInsightsDashboard.
 *
 * The two surfaces read distinct sources (the survey-results rollup vs. the
 * template/campaign lists), so each summary owns its read and the results
 * summary reacts to the shared time-window selector.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PmCard } from '@/components/pm/pmShared';
import { RoleGate } from '@/components/RoleGate';
import { DaysWindowSelect } from './LensShell';
import { useDevexPanel } from './DevexPanelProvider';
import { DEVEX_PANELS, DEVEX_PANEL_IDS, isDevexPanelId, type DevexPanelId } from './devexPanels';

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

export function DevexDashboard() {
  const t = useTranslations('insights.devexhub');
  const [days, setDays] = useState(90);
  const { open } = useDevexPanel();
  const searchParams = useSearchParams();

  // Deep-link: /insights/devex?panel=surveys (and the redirect from the retired
  // /surveys route) auto-opens the drill-down.
  const panelParam = searchParams?.get('panel');
  useEffect(() => {
    if (isDevexPanelId(panelParam)) open(panelParam as DevexPanelId);
  }, [panelParam, open]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
        <RoleGate capability="devex.manage">
          <button
            type="button"
            onClick={() => open('surveys')}
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)',
              background: 'var(--coral-bright, #f4726e)', color: '#fff', cursor: 'pointer',
              fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap',
            }}
          >
            + {t('newSurvey')}
          </button>
        </RoleGate>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      {DEVEX_PANEL_IDS.map((id) => {
        const def = DEVEX_PANELS[id];
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
