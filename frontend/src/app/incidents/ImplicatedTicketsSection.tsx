import { useCallback, useEffect, useState } from 'react';
import type { useTranslations } from 'next-intl';
import type { ImplicatedTicket } from '@/lib/kanban';
import { incidentsApi } from '@/lib/builderforceApi';
import { SECTION_CARD as card } from '@/components/ui/SectionState';

type T = ReturnType<typeof useTranslations>;

/* ────────────── Implicated tickets + accountability (RCA linkage) ────────────── */

export function ImplicatedTicketsSection({ t, canManage, incidentId }: { t: T; canManage: boolean; incidentId: string }) {
  const [rows, setRows] = useState<ImplicatedTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [addId, setAddId] = useState('');
  const [busy, setBusy] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => { setLoading(true); setReloadKey((k) => k + 1); }, []);
  useEffect(() => {
    let cancelled = false;
    incidentsApi.implicated(incidentId)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [incidentId, reloadKey]);

  const add = async () => {
    const taskId = Number(addId.trim());
    if (!Number.isFinite(taskId) || taskId <= 0) return;
    setBusy(true);
    try { await incidentsApi.linkImplicated(incidentId, { taskId }); setAddId(''); load(); } finally { setBusy(false); }
  };
  const remove = async (taskId: number) => { setBusy(true); try { await incidentsApi.unlinkImplicated(incidentId, taskId); load(); } finally { setBusy(false); } };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('implicated.title')}</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('implicated.help')}</p>
      {loading ? (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('implicated.loading')}</span>
      ) : rows.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('implicated.empty')}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => {
            const a = r.accountability;
            const complete = a.percentComplete >= 100;
            return (
              <div key={r.taskId} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>#{r.taskId} {r.title}</span>
                  <span className="badge-muted">{r.status}</span>
                  <div style={{ flex: 1 }} />
                  {canManage && (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => remove(r.taskId)}>{t('implicated.remove')}</button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 100, height: 6, borderRadius: 'var(--radius-full)', background: 'var(--bg-deep)', overflow: 'hidden' }}>
                    <div style={{ width: `${a.percentComplete}%`, height: '100%', background: complete ? 'var(--success)' : 'var(--coral-bright)' }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('implicated.signed', { done: a.completedCount, total: a.requiredCount })}</span>
                </div>
                {a.gaps.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--danger-text)' }}>{t('implicated.gaps', { count: a.gaps.length })}: {a.gaps.map((g) => g.roleName).join(', ')}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" style={{ maxWidth: 160 }} value={addId} onChange={(e) => setAddId(e.target.value)} placeholder={t('implicated.addPlaceholder')} inputMode="numeric" />
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !addId.trim()} onClick={add}>{t('implicated.add')}</button>
        </div>
      )}
    </div>
  );
}
