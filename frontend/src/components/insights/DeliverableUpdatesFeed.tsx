import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type DeliverableScope, type DeliverableUpdate, type DeliverableUpdateStatus } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmError } from '@/components/pm/pmShared';
import { Select } from '@/components/Select';
import { statusColor, type StatusToneMap } from '@/lib/statusTone';
import { inputStyle } from './deliveryLensShared';

const btnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--accent)',
  color: 'var(--text-on-accent)', fontWeight: 600, fontSize: 'var(--font-size-small)', cursor: 'pointer', whiteSpace: 'nowrap',
};

const UPDATE_STATUSES: DeliverableUpdateStatus[] = ['note', 'on_track', 'at_risk', 'blocked', 'done'];
const UPDATE_TONE: StatusToneMap<DeliverableUpdateStatus> = {
  note: 'neutral', on_track: 'success', at_risk: 'warning', blocked: 'danger', done: 'info',
};

/** Qualitative update/comment stream for the selected deliverable (EMP-11). */
export function DeliverableUpdatesFeed({ scope, id }: { scope: DeliverableScope; id: string }) {
  const t = useTranslations('insights');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<DeliverableUpdateStatus>('note');
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = usePmData<DeliverableUpdate[]>(() => insightsApi.deliverableUpdates.list(scope, id), [scope, id]);

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); reload(); } finally { setBusy(false); } };

  return (
    <PmCard title={t('deliv.updates')}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Select style={{ ...inputStyle, width: 130 }} value={status} onChange={(e) => setStatus(e.target.value as DeliverableUpdateStatus)} aria-label={t('deliv.updateStatus')}>
          {UPDATE_STATUSES.map((s) => <option key={s} value={s}>{t(`deliv.updateStatusLabel.${s}`)}</option>)}
        </Select>
        <input
          style={{ ...inputStyle, flex: 1 }} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={t('deliv.updatePlaceholder')}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim() && !busy) run(async () => { await insightsApi.deliverableUpdates.create({ scopeKind: scope, scopeId: id, body: draft, statusLabel: status }); setDraft(''); }); }}
        />
        <button
          type="button" style={btnStyle} disabled={busy || !draft.trim()}
          onClick={() => run(async () => { await insightsApi.deliverableUpdates.create({ scopeKind: scope, scopeId: id, body: draft, statusLabel: status }); setDraft(''); })}
        >
          {t('deliv.postUpdate')}
        </button>
      </div>
      {error ? <PmError message={error} /> : !data || data.length === 0 ? (
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('deliv.noUpdates')}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map((u) => (
            <div key={u.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, borderLeft: `3px solid ${u.statusLabel ? statusColor(UPDATE_TONE, u.statusLabel, 'solid') : 'var(--border-subtle)'}`, paddingLeft: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                <span>
                  {u.statusLabel && <span style={{ color: statusColor(UPDATE_TONE, u.statusLabel), fontWeight: 600 }}>{t(`deliv.updateStatusLabel.${u.statusLabel}`)} · </span>}
                  {u.authorName ?? t('deliv.someone')} · {u.createdAt.slice(0, 10)}
                </span>
                <button type="button" disabled={busy} title={t('common.delete')} onClick={() => run(() => insightsApi.deliverableUpdates.remove(u.id))}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>×</button>
              </div>
              <div style={{ fontSize: 'var(--font-size-body)', whiteSpace: 'pre-wrap' }}>{u.body}</div>
            </div>
          ))}
        </div>
      )}
    </PmCard>
  );
}
