'use client';

import { useMemo, useState } from 'react';
import { Select } from '@/components/Select';
import { useTranslations } from 'next-intl';
import { pmoApi, type PmoTree, type PmoScopeKind } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError } from './pmShared';
import { PmoRollup } from './PmoRollup';
import { PmoStructure } from './PmoStructure';
import { PmoCostReconciliation } from './PmoCostReconciliation';
import { MeetingsCalendar } from '@/components/meetings/MeetingsCalendar';

/**
 * PMO lens — the portfolio/initiative/OKR cockpit. Tabs: Rollup (the dashboard,
 * over a scope picker), Structure (the single management surface — portfolios own
 * their initiatives AND objectives, assigned by drag-drop or dropdown; the former
 * standalone OKRs tab was merged in here), and CAPEX/OPEX. The page-level RoleGate
 * (insights.portfolio) owns access; this component owns scope + tab state only.
 * Fully localized.
 */
type Tab = 'rollup' | 'structure' | 'cost';
const WORKSPACE = 'workspace';

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', cursor: 'pointer',
  background: active ? 'var(--accent, #2563eb)' : 'transparent',
  color: active ? '#fff' : 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem',
});
const selectStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.85rem', minWidth: 200,
};

export function PmoContent() {
  const t = useTranslations('pmo');
  const { data: tree, error, reload } = usePmData<PmoTree>(() => pmoApi.tree(), []);
  const [tab, setTab] = useState<Tab>('rollup');
  // '' = default to first portfolio, WORKSPACE = org-level, else a portfolio id.
  const [portfolioSel, setPortfolioSel] = useState<string>('');
  const [initiativeId, setInitiativeId] = useState<string>(''); // '' = whole portfolio
  const [projectSel, setProjectSel] = useState<string>(''); // '' = none; else a project id — its own OKR scope, takes precedence

  const effectivePortfolioId = useMemo(() => {
    if (!tree) return '';
    if (portfolioSel === WORKSPACE) return WORKSPACE;
    if (portfolioSel && tree.portfolios.some((p) => p.id === portfolioSel)) return portfolioSel;
    return tree.portfolios[0]?.id ?? '';
  }, [tree, portfolioSel]);

  const initiativesInPortfolio = useMemo(
    () => (tree ? tree.initiatives.filter((i) => i.portfolioId === effectivePortfolioId) : []),
    [tree, effectivePortfolioId],
  );

  if (error) return <PmError message={error} />;
  if (!tree) return <PmEmpty message={t('loading')} />;

  // A chosen project is its own OKR scope and takes precedence over the portfolio /
  // initiative lens — it's the surface that satisfies a project's 360 "Direction".
  const projectScoped = projectSel && tree.projects.some((p) => String(p.id) === projectSel);

  const scope: { kind: PmoScopeKind; id: string } | null =
    projectScoped
      ? { kind: 'project', id: projectSel }
      : effectivePortfolioId === WORKSPACE
        ? { kind: 'workspace', id: WORKSPACE }
        : initiativeId && initiativesInPortfolio.some((i) => i.id === initiativeId)
          ? { kind: 'initiative', id: initiativeId }
          : effectivePortfolioId
            ? { kind: 'portfolio', id: effectivePortfolioId }
            : null;

  // Only the Rollup dashboard is scoped; Structure + Cost are segment-wide.
  const showScopePicker = tab === 'rollup' && (tree.portfolios.length > 0 || tree.projects.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['rollup', 'structure', 'cost'] as Tab[]).map((tb) => (
          <button key={tb} type="button" style={tabBtn(tab === tb)} onClick={() => setTab(tb)}>
            {t(`tabs.${tb}`)}
          </button>
        ))}

        {showScopePicker && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {tree.portfolios.length > 0 && (
              <Select
                style={selectStyle}
                value={effectivePortfolioId}
                onChange={(e) => { setPortfolioSel(e.target.value); setInitiativeId(''); setProjectSel(''); }}
                disabled={!!projectScoped}
              >
                <option value={WORKSPACE}>{t('scope.workspace')}</option>
                {tree.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
            {!projectScoped && tree.portfolios.length > 0 && effectivePortfolioId !== WORKSPACE && (
              <Select style={selectStyle} value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
                <option value="">{t('scope.wholePortfolio')}</option>
                {initiativesInPortfolio.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            )}
            {tree.projects.length > 0 && (
              <Select
                style={selectStyle}
                value={projectSel}
                onChange={(e) => { setProjectSel(e.target.value); if (e.target.value) setInitiativeId(''); }}
              >
                <option value="">{t('scope.byProject')}</option>
                {tree.projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </Select>
            )}
          </div>
        )}
      </div>

      {tab === 'structure' && <PmoStructure tree={tree} onChange={reload} />}
      {tab === 'rollup' && (scope ? <PmoRollup scope={scope} /> : <PmEmpty message={t('emptyRollup')} />)}
      {tab === 'cost' && <PmoCostReconciliation />}

      {/* Meetings calendar for the portfolio — scoped to the chosen project when one
          is selected, else the whole workspace. A compact month overview + booking. */}
      {tab === 'rollup' && (
        <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            {t('meetingsHeading')}
          </h3>
          <MeetingsCalendar projectId={projectScoped ? Number(projectSel) : null} defaultView="month" compact />
        </div>
      )}
    </div>
  );
}
