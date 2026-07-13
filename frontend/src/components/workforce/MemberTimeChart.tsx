'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { timeApi, pmoApi, type MemberDailyHours, type MemberKind, type SpineNode } from '@/lib/builderforceApi';

/**
 * A member's activity chart — daily LOGGED hours (real time entries, migration
 * 0245) as a bar sparkline, plus a log form (pick a task, minutes, day) and the
 * recent entries with delete. Rendered in the member detail. Logging for yourself
 * is open; a manager viewing another member can log/delete on their behalf
 * (enforced server-side). Fully localized.
 */
const field: React.CSSProperties = {
  padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 12,
};
const btn: React.CSSProperties = {
  ...field, cursor: 'pointer', background: 'var(--accent, #6366f1)', color: '#fff', border: 'none', fontWeight: 600,
};

function fmtH(h: number): string { return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`; }
function fmtMins(m: number): string { return m >= 60 ? `${(m / 60).toFixed(m % 60 ? 1 : 0)}h` : `${m}m`; }

export function MemberTimeChart({ kind, refId, days = 30 }: { kind: MemberKind; refId: string; days?: number }) {
  const t = useTranslations('timeTracking');
  const [data, setData] = useState<MemberDailyHours | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<SpineNode[]>([]);
  const [taskId, setTaskId] = useState('');
  const [hours, setHours] = useState('');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    timeApi.member(kind, refId, days).then(setData).catch((e: Error) => setError(e.message));
  }, [kind, refId, days, reload]);

  useEffect(() => {
    // Task picker options come from the spine (epics + tasks) — reuse, don't refetch a task list.
    pmoApi.spine().then((s) => setTasks(s.nodes.filter((n) => n.kind === 'task' || n.kind === 'epic'))).catch(() => { /* optional */ });
  }, []);

  const maxHours = useMemo(() => Math.max(1, ...(data?.daily ?? []).map((d) => d.hours)), [data]);

  const logTime = async () => {
    const minutes = Math.round(Number(hours) * 60);
    if (!taskId || !Number.isFinite(minutes) || minutes <= 0) return;
    setBusy(true);
    try {
      await timeApi.log({ taskId: Number(taskId), minutes, entryDate, memberKind: kind, memberRef: refId });
      setHours(''); setReload((r) => r + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const del = async (id: string) => {
    setBusy(true);
    try { await timeApi.remove(id); setReload((r) => r + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{t('title')}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('windowTotal', { days, hours: fmtH(data?.totalHours ?? 0) })}</span>
      </div>

      {error && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 11 }}>{error}</div>}

      {/* Daily bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 56 }}>
        {(data?.daily ?? []).map((d) => (
          <div key={d.date} title={`${d.date}: ${fmtH(d.hours)}`}
            style={{ flex: 1, minWidth: 2, height: `${Math.max(2, (d.hours / maxHours) * 100)}%`,
              background: d.hours > 0 ? 'var(--accent, #6366f1)' : 'var(--border-subtle)', borderRadius: 2, alignSelf: 'flex-end' }} />
        ))}
        {data == null && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('loading')}</span>}
      </div>

      {/* Log form */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...field, flex: 1, minWidth: 140 }} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          <option value="">{t('pickTask')}</option>
          {tasks.map((n) => <option key={n.key} value={n.id}>{n.title}</option>)}
        </select>
        <input style={{ ...field, width: 70 }} type="number" min={0} step={0.25} placeholder={t('hoursPh')} value={hours} onChange={(e) => setHours(e.target.value)} />
        <input style={{ ...field, width: 130 }} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        <button style={{ ...btn, opacity: busy || !taskId || !hours ? 0.6 : 1 }} disabled={busy || !taskId || !hours} onClick={logTime}>{t('log')}</button>
      </div>

      {/* Recent entries */}
      {data && data.entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
          {data.entries.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ color: 'var(--muted)', width: 78, flexShrink: 0 }}>{e.entryDate}</span>
              <span style={{ fontWeight: 600, width: 44, flexShrink: 0 }}>{fmtMins(e.minutes)}</span>
              <span title={e.taskTitle ?? ''} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.taskKey ? `${e.taskKey} · ` : ''}{e.taskTitle ?? `#${e.taskId}`}
              </span>
              <button onClick={() => del(e.id)} disabled={busy} aria-label={t('delete')}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
