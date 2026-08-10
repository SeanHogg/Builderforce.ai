'use client';

/**
 * Platform broadcasts — messages to visitors who have no workspace.
 *
 * Every session on this platform starts as an anonymous prompt, so every session
 * is a conversion opportunity — and anonymous visitors were the one audience
 * marketing could not address. They have no email, no account and no tenant, so
 * the campaign engine (audiences of addresses, verified senders, suppression)
 * reaches none of them. What they have is an open tab. This panel is what puts a
 * message in it, and taking one live pushes to open tabs rather than waiting for
 * the next page load.
 *
 * Answer-first, like every other console surface: reach and click-through lead,
 * then the messages that produced them.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminBroadcast, type AdminBroadcastPage } from '@/lib/adminApi';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  AdminError,
  AdminLoading,
  AdminPanelHeader,
  errText,
  fmtDateTime,
  fmtNum,
  useAdminData,
} from '@/components/admin/adminShared';
import { BroadcastComposer } from './BroadcastComposer';

const STATUS_BADGE: Record<AdminBroadcast['status'], string> = {
  live: 'badge-success',
  draft: 'badge-neutral',
  archived: 'badge-neutral',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        flex: '1 1 150px',
        minWidth: 130,
        padding: '12px 14px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--surface-card)',
      }}
    >
      <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', marginTop: 2 }}>{value}</div>
      {hint && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function BroadcastsPanel() {
  const t = useTranslations('admin.broadcasts');
  const confirm = useConfirm();
  const { data, loading, error, reload } = useAdminData<AdminBroadcastPage>(() => adminApi.broadcasts());

  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<AdminBroadcast | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const broadcasts = useMemo(() => data?.broadcasts ?? [], [data]);

  const totals = useMemo(() => {
    const live = broadcasts.filter((b) => b.status === 'live').length;
    const reach = broadcasts.reduce((sum, b) => sum + b.reach, 0);
    const clicks = broadcasts.reduce((sum, b) => sum + b.clicks, 0);
    return {
      live,
      reach,
      clicks,
      // Against distinct visitors reached, not impressions: an impression counted
      // once per visitor is the only denominator a click-through rate can honestly
      // use here.
      ctr: reach > 0 ? Math.round((clicks / reach) * 1000) / 10 : 0,
    };
  }, [broadcasts]);

  async function setStatus(broadcast: AdminBroadcast, status: AdminBroadcast['status']) {
    setActionError(null);
    try {
      await adminApi.updateBroadcast(broadcast.id, { status });
      reload();
    } catch (err) {
      setActionError(errText(err));
    }
  }

  async function remove(broadcast: AdminBroadcast) {
    // Deleting a message that may be on screen right now IS terminal and
    // destructive — the one case the app reserves a centred confirm for.
    const ok = await confirm({
      title: t('deleteTitle'),
      message: t('deleteMessage', { message: broadcast.message.slice(0, 80) }),
      confirmLabel: t('deleteConfirm'),
      destructive: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      await adminApi.deleteBroadcast(broadcast.id);
      reload();
    } catch (err) {
      setActionError(errText(err));
    }
  }

  if (loading && !data) return <AdminLoading />;

  return (
    <div>
      <AdminPanelHeader
        title={t('title')}
        subtitle={t('subtitle')}
        count={t('count', { count: broadcasts.length })}
        onRefresh={reload}
        actions={
          <button type="button" className="btn-primary" onClick={() => { setEditing(null); setComposing(true); }}>
            {t('compose')}
          </button>
        }
      />
      <AdminError message={error ?? actionError} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <Stat label={t('statLive')} value={fmtNum(totals.live)} />
        <Stat label={t('statReach')} value={fmtNum(totals.reach)} hint={t('statReachHint')} />
        <Stat label={t('statClicks')} value={fmtNum(totals.clicks)} />
        <Stat label={t('statCtr')} value={`${totals.ctr}%`} hint={t('statCtrHint')} />
      </div>

      {broadcasts.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('colMessage')}</th>
                <th>{t('colAudience')}</th>
                <th>{t('colWindow')}</th>
                <th>{t('colEngagement')}</th>
                <th>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((broadcast) => (
                <tr key={broadcast.id}>
                  <td style={{ maxWidth: 320 }}>
                    <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{broadcast.message}</div>
                    <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className={`badge ${STATUS_BADGE[broadcast.status]}`}>{t(`status.${broadcast.status}`)}</span>
                      <span className="badge badge-neutral">{t(`tone.${broadcast.tone}`)}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <div>{t(`scope.${broadcast.audience.scope}`)}</div>
                    {broadcast.audience.visitorIds.length > 0 && (
                      <div className="text-muted">{t('audienceVisitors', { count: broadcast.audience.visitorIds.length })}</div>
                    )}
                    {broadcast.audience.minPrompts > 0 && (
                      <div className="text-muted">{t('audienceMinPrompts', { count: broadcast.audience.minPrompts })}</div>
                    )}
                  </td>
                  <td className="text-muted" style={{ fontSize: 12 }}>
                    <div>{broadcast.startsAt ? fmtDateTime(broadcast.startsAt) : t('windowImmediate')}</div>
                    <div>{broadcast.endsAt ? fmtDateTime(broadcast.endsAt) : t('windowOpenEnded')}</div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <div>{t('engagementReach', { count: broadcast.reach })}</div>
                    <div className="text-muted">
                      {t('engagementDetail', {
                        clicks: broadcast.clicks,
                        ctr: broadcast.clickThroughPct,
                        dismissals: broadcast.dismissals,
                      })}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn-ghost" onClick={() => { setEditing(broadcast); setComposing(true); }}>
                        {t('edit')}
                      </button>
                      {broadcast.status === 'live' ? (
                        <button type="button" className="btn-ghost" onClick={() => void setStatus(broadcast, 'archived')}>
                          {t('archive')}
                        </button>
                      ) : (
                        <button type="button" className="btn-ghost" onClick={() => void setStatus(broadcast, 'live')}>
                          {t('goLive')}
                        </button>
                      )}
                      <button type="button" className="btn-ghost" onClick={() => void remove(broadcast)}>
                        {t('delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BroadcastComposer
        open={composing}
        broadcast={editing}
        onClose={() => setComposing(false)}
        onSaved={() => { setComposing(false); reload(); }}
      />
    </div>
  );
}
