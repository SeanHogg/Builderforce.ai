'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { pmoApi, type PmoTree } from '@/lib/builderforceApi';
import { PmCard, PmError, StatusPill } from './pmShared';

/**
 * PMO structure manager — create/delete portfolios & initiatives, link projects
 * to initiatives (the rollup join), and wire initiative dependencies (blocker →
 * blocked, feeding the critical path). All mutations are manager-gated
 * server-side; the whole PMO page is wrapped in
 * <RoleGate capability="insights.portfolio">, so no per-control gate is re-inlined
 * here. Fully localized.
 */
const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.85rem',
};
const btnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)',
  color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
};
const ghostBtn: React.CSSProperties = {
  ...btnStyle, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
};
const dangerBtn: React.CSSProperties = {
  ...btnStyle, background: 'transparent', color: '#dc2626', border: '1px solid var(--border-subtle)',
};

export function PmoStructure({ tree, onChange }: { tree: PmoTree; onChange: () => void }) {
  const t = useTranslations('pmo');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newPortfolio, setNewPortfolio] = useState('');
  const [newInitiative, setNewInitiative] = useState<Record<string, string>>({});

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try { await fn(); onChange(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const initiativeName = (id: string) => tree.initiatives.find((i) => i.id === id)?.name ?? id;
  const initiativesByPortfolio = (portfolioId: string | null) =>
    tree.initiatives.filter((i) => (i.portfolioId ?? null) === portfolioId);
  const projectsByInitiative = (initiativeId: string) =>
    tree.projects.filter((p) => p.initiativeId === initiativeId);
  const unlinkedProjects = tree.projects.filter((p) => p.initiativeId == null);
  const blockersOf = (initiativeId: string) => tree.dependencies.filter((d) => d.toInitiativeId === initiativeId);

  const renderInitiative = (init: PmoTree['initiatives'][number]) => {
    const linked = projectsByInitiative(init.id);
    const blockers = blockersOf(init.id);
    const blockerIds = new Set(blockers.map((b) => b.fromInitiativeId));
    // Candidate blockers: any other initiative not already blocking this one.
    const candidates = tree.initiatives.filter((i) => i.id !== init.id && !blockerIds.has(i.id));
    return (
      <div key={init.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 12, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: '0.9rem' }}>{init.name}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusPill value={init.status} />
            <button type="button" disabled={busy} style={dangerBtn}
              onClick={() => { if (window.confirm(t('structure.confirmDeleteInitiative'))) run(() => pmoApi.initiatives.remove(init.id)); }}>
              {t('structure.delete')}
            </button>
          </div>
        </div>

        {/* Linked projects */}
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {linked.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('structure.noProjectsLinked')}</span>}
          {linked.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '0.83rem' }}>
              <span>{p.key} · {p.name}</span>
              <button type="button" disabled={busy} onClick={() => run(() => pmoApi.linkProject(p.id, null))} style={ghostBtn}>
                {t('structure.unlink')}
              </button>
            </div>
          ))}
        </div>
        {unlinkedProjects.length > 0 && (
          <select
            disabled={busy}
            defaultValue=""
            onChange={(e) => { const pid = Number(e.target.value); if (pid) run(() => pmoApi.linkProject(pid, init.id)); }}
            style={{ ...inputStyle, marginTop: 8, width: '100%' }}
          >
            <option value="">{t('structure.linkProject')}</option>
            {unlinkedProjects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </select>
        )}

        {/* Dependencies (blocked by) */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('structure.dependsOn')}</div>
          {blockers.map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '0.82rem', marginBottom: 4 }}>
              <span>{initiativeName(b.fromInitiativeId)}</span>
              <button type="button" disabled={busy} onClick={() => run(() => pmoApi.removeDependency(b.id))} style={ghostBtn}>
                {t('structure.remove')}
              </button>
            </div>
          ))}
          {candidates.length > 0 && (
            <select
              disabled={busy}
              defaultValue=""
              onChange={(e) => { const fromId = e.target.value; if (fromId) run(() => pmoApi.addDependency(fromId, init.id)); }}
              style={{ ...inputStyle, marginTop: 4, width: '100%' }}
            >
              <option value="">{t('structure.addDependency')}</option>
              {candidates.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {err && <PmError message={err} />}

      <PmCard
        title={t('structure.newPortfolio')}
        action={
          <div style={{ display: 'flex', gap: 8, minWidth: 320 }}>
            <input style={inputStyle} placeholder={t('structure.portfolioName')} value={newPortfolio} onChange={(e) => setNewPortfolio(e.target.value)} />
            <button type="button" style={btnStyle} disabled={busy || !newPortfolio.trim()}
              onClick={() => run(async () => { await pmoApi.portfolios.create({ name: newPortfolio.trim() }); setNewPortfolio(''); })}>
              {t('structure.create')}
            </button>
          </div>
        }
      >
        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{t('structure.portfolioHint')}</span>
      </PmCard>

      {tree.portfolios.length === 0 && (
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('structure.noPortfolios')}</span>
      )}

      {tree.portfolios.map((pf) => (
        <PmCard
          key={pf.id}
          title={pf.name}
          action={
            <div style={{ display: 'flex', gap: 8, minWidth: 360, alignItems: 'center' }}>
              <input
                style={inputStyle}
                placeholder={t('structure.newInitiativeName')}
                value={newInitiative[pf.id] ?? ''}
                onChange={(e) => setNewInitiative((s) => ({ ...s, [pf.id]: e.target.value }))}
              />
              <button type="button" style={btnStyle} disabled={busy || !(newInitiative[pf.id] ?? '').trim()}
                onClick={() => run(async () => {
                  await pmoApi.initiatives.create({ name: (newInitiative[pf.id] ?? '').trim(), portfolioId: pf.id });
                  setNewInitiative((s) => ({ ...s, [pf.id]: '' }));
                })}>
                {t('structure.addInitiative')}
              </button>
              <button type="button" style={dangerBtn} disabled={busy}
                onClick={() => { if (window.confirm(t('structure.confirmDeletePortfolio'))) run(() => pmoApi.portfolios.remove(pf.id)); }}>
                {t('structure.delete')}
              </button>
            </div>
          }
        >
          {initiativesByPortfolio(pf.id).length === 0
            ? <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('structure.noInitiatives')}</span>
            : initiativesByPortfolio(pf.id).map(renderInitiative)}
        </PmCard>
      ))}

      {initiativesByPortfolio(null).length > 0 && (
        <PmCard title={t('structure.unassignedInitiatives')}>
          {initiativesByPortfolio(null).map(renderInitiative)}
        </PmCard>
      )}
    </div>
  );
}
