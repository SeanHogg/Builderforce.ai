'use client';

/**
 * DemoFunnelPanel (migration 0360) — the sales-demo conversion funnel. Aggregates
 * anonymous demo_events by persona into the canonical funnel stages (start →
 * engaged → convert prompt shown → converted / booked / exited) so a superadmin
 * can see which persona demo converts best. Read-only; re-polls via reload.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminDemoFunnel } from '@/lib/adminApi';
import { AdminError, AdminLoading, AdminPanelHeader, fmtDateTime, fmtNum, useAdminData } from '@/components/admin/adminShared';

const STAGES = ['demo_start', 'page_view', 'convert_prompt_shown', 'convert_clicked', 'book_demo_opened', 'lead_submitted', 'exit_prompt_shown', 'demo_exit'] as const;
const PERSONAS = ['ai-team', 'insights', 'pmo', 'talent', 'governance'] as const;

export default function DemoFunnelPanel() {
  const t = useTranslations('admin.demoFunnel');
  const { data, loading, error, reload } = useAdminData<AdminDemoFunnel>(() => adminApi.demoFunnel());

  const matrix = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const persona of PERSONAS) m.set(persona, new Map());
    const totals = new Map<string, number>();
    for (const row of data?.byKind ?? []) {
      const p = row.persona ?? 'ai-team';
      if (!m.has(p)) m.set(p, new Map());
      m.get(p)!.set(row.kind, (m.get(p)!.get(row.kind) ?? 0) + row.count);
      totals.set(row.kind, (totals.get(row.kind) ?? 0) + row.count);
    }
    return { m, totals };
  }, [data]);

  if (loading && !data) return <AdminLoading />;

  const stageLabel = (s: string): string => t(`stages.${s}`);

  return (
    <div>
      <AdminPanelHeader title={t('title')} subtitle={t('subtitle')} onRefresh={reload} />
      <AdminError message={error} />

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('persona')}</th>
              {STAGES.map((s) => <th key={s} style={{ textAlign: 'right' }}>{stageLabel(s)}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERSONAS.map((persona) => {
              const row = matrix.m.get(persona);
              const starts = row?.get('demo_start') ?? 0;
              const converts = row?.get('convert_clicked') ?? 0;
              const rate = starts > 0 ? Math.round((converts / starts) * 100) : 0;
              return (
                <tr key={persona}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t(`personas.${persona}`)}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{t('convRate', { rate })}</div>
                  </td>
                  {STAGES.map((s) => (
                    <td key={s} style={{ textAlign: 'right' }}>{fmtNum(row?.get(s) ?? 0)}</td>
                  ))}
                </tr>
              );
            })}
            <tr>
              <td style={{ fontWeight: 700 }}>{t('total')}</td>
              {STAGES.map((s) => (
                <td key={s} style={{ textAlign: 'right', fontWeight: 700 }}>{fmtNum(matrix.totals.get(s) ?? 0)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: '24px 0 8px', fontSize: 15 }}>{t('recentTitle')}</h3>
      {(data?.recent.length ?? 0) === 0 ? (
        <p className="text-muted" style={{ padding: 12 }}>{t('empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('when')}</th>
                <th>{t('persona')}</th>
                <th>{t('event')}</th>
                <th>{t('path')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent ?? []).map((e, i) => (
                <tr key={`${e.visitorId}-${i}`}>
                  <td className="text-muted">{fmtDateTime(e.occurredAt)}</td>
                  <td>{e.persona ? t(`personas.${e.persona}`) : '—'}</td>
                  <td>{stageLabel(e.kind)}</td>
                  <td className="text-muted" style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.path ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
