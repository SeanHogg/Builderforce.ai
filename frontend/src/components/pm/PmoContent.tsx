'use client';

import { useMemo, useState } from 'react';
import { Select } from '@/components/Select';
import { useTranslations } from 'next-intl';
import { pmoApi, type PmoTree, type PmoScopeKind } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError } from './pmShared';
import { PmoRollup } from './PmoRollup';
import { PmoStructure } from './PmoStructure';
import { PmoOkrs } from './PmoOkrs';
import { PmoCostReconciliation } from './PmoCostReconciliation';

/**
 * PMO lens — the portfolio/initiative/OKR cockpit. One page, three tabs (Rollup,
 * Structure, OKRs) over a shared scope picker (whole-portfolio, one initiative,
 * or the org-level workspace). The page-level RoleGate (insights.portfolio) owns
 * access; this component owns scope + tab state only. Fully localized.
 */
type Tab = 'rollup' | 'structure' | 'okrs' | 'cost';
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

  const scope: { kind: PmoScopeKind; id: string } | null =
    effectivePortfolioId === WORKSPACE
      ? { kind: 'workspace', id: WORKSPACE }
      : initiativeId && initiativesInPortfolio.some((i) => i.id === initiativeId)
        ? { kind: 'initiative', id: initiativeId }
        : effectivePortfolioId
          ? { kind: 'portfolio', id: effectivePortfolioId }
          : null;

  // Structure + Cost are segment-wide (no portfolio/initiative scope).
  const showScopePicker = tab !== 'structure' && tab !== 'cost' && (tree.portfolios.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['rollup', 'structure', 'okrs', 'cost'] as Tab[]).map((tb) => (
          <button key={tb} type="button" style={tabBtn(tab === tb)} onClick={() => setTab(tb)}>
            {t(`tabs.${tb}`)}
          </button>
        ))}

        {showScopePicker && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <Select
              style={selectStyle}
              value={effectivePortfolioId}
              onChange={(e) => { setPortfolioSel(e.target.value); setInitiativeId(''); }}
            >
              <option value={WORKSPACE}>{t('scope.workspace')}</option>
              {tree.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            {effectivePortfolioId !== WORKSPACE && (
              <Select style={selectStyle} value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
                <option value="">{t('scope.wholePortfolio')}</option>
                {initiativesInPortfolio.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            )}
          </div>
        )}
      </div>

      {tab === 'structure' && <PmoStructure tree={tree} onChange={reload} />}
      {tab === 'rollup' && (scope ? <PmoRollup scope={scope} /> : <PmEmpty message={t('emptyRollup')} />)}
      {tab === 'okrs' && (scope ? <PmoOkrs scope={scope} /> : <PmEmpty message={t('emptyOkrs')} />)}
      {tab === 'cost' && <PmoCostReconciliation />}
    </div>
  );
}
