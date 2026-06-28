'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { qualityApi, type ErrorGroupDetail as Detail } from '@/lib/builderforceApi';

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
  display: 'flex', justifyContent: 'flex-end',
};
const panel: React.CSSProperties = {
  width: 'min(620px, 100%)', height: '100%', background: 'var(--bg-base)', borderLeft: '1px solid var(--border-subtle)',
  padding: 24, overflowY: 'auto', boxSizing: 'border-box',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '7px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};
const pre: React.CSSProperties = {
  background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12,
  fontSize: 12, color: 'var(--text-primary)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};

/** Render a sample stack (frames array or raw string) into a readable block. */
function renderStack(stack: unknown): string {
  if (!stack) return '';
  if (typeof stack === 'string') return stack;
  if (Array.isArray(stack)) {
    return stack
      .map((f) => {
        const fr = (f ?? {}) as Record<string, unknown>;
        return `  at ${fr.function ?? '<anonymous>'} (${fr.file ?? '?'}:${fr.line ?? '?'}:${fr.column ?? '?'})`;
      })
      .join('\n');
  }
  return '';
}

/**
 * Error-group detail drawer: sample stack trace, 14-day event trend, exact
 * affected-user count, triage (resolve/ignore/reopen) and the one-click
 * "Fix with agent" dispatch (manager+ via RoleGate quality.fix).
 */
export function ErrorGroupDetail({ groupId, onClose, onChanged }: { groupId: string; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations('quality');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fixMsg, setFixMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    qualityApi.groups.get(groupId)
      .then((d) => { setDetail(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load detail'));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (status: 'unresolved' | 'resolved' | 'ignored') => {
    setBusy(true);
    try {
      await qualityApi.groups.setStatus(groupId, status);
      onChanged();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setBusy(false);
    }
  };

  const fix = async () => {
    setBusy(true); setFixMsg(null);
    try {
      const r = await qualityApi.groups.fix(groupId);
      setFixMsg(t('detail.fixStarted', { taskId: r.taskId }));
      onChanged();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to dispatch fix');
    } finally {
      setBusy(false);
    }
  };

  const g = detail?.group;
  const stack = renderStack(g?.samplePayload?.stack);
  const maxTrend = Math.max(1, ...(detail?.trend.map((d) => d.count) ?? [1]));

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>{g?.title ?? t('loading')}</h2>
          <button type="button" style={btnSubtle} onClick={onClose} aria-label={t('detail.close')}>✕</button>
        </div>

        {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #dc2626)', marginTop: 10 }}>{error}</div>}

        {g && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {g.type ? `${g.type} · ` : ''}{t(`level.${g.level}`)} · {t(`status.${g.status}`)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16 }}>
              <Metric label={t('detail.events')} value={g.eventCount} />
              <Metric label={t('detail.users')} value={detail?.affectedUsers ?? g.userCount} />
              <Metric label={t('detail.environment')} value={g.environment ?? '—'} />
            </div>

            {/* Trend */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('detail.trend')}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
                {(detail?.trend ?? []).map((d) => (
                  <div key={d.day} title={`${new Date(d.day).toLocaleDateString()}: ${d.count}`}
                    style={{ flex: 1, height: `${(d.count / maxTrend) * 100}%`, minHeight: 2, background: 'var(--coral-bright)', borderRadius: 2 }} />
                ))}
                {(detail?.trend.length ?? 0) === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('detail.noTrend')}</div>}
              </div>
            </div>

            {/* Where + stack */}
            {typeof g.samplePayload?.url === 'string' && (
              <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
                {t('detail.where')}: <span style={{ color: 'var(--text-primary)' }}>{g.samplePayload.url as string}</span>
              </div>
            )}
            {stack && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('detail.stack')}</div>
                <pre style={pre}>{stack}</pre>
              </div>
            )}

            {fixMsg && (
              <div style={{ marginTop: 14, fontSize: 13, color: '#16a34a' }}>{fixMsg}</div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
              <RoleGate capability="quality.fix">
                <button type="button" style={btnPrimary} disabled={busy || !!g.taskId} onClick={fix}>
                  {g.taskId ? t('detail.fixLinked', { taskId: g.taskId }) : t('detail.fix')}
                </button>
              </RoleGate>
              {g.status !== 'resolved' && (
                <button type="button" style={btnSubtle} disabled={busy} onClick={() => setStatus('resolved')}>{t('detail.resolve')}</button>
              )}
              {g.status !== 'ignored' && (
                <button type="button" style={btnSubtle} disabled={busy} onClick={() => setStatus('ignored')}>{t('detail.ignore')}</button>
              )}
              {g.status !== 'unresolved' && (
                <button type="button" style={btnSubtle} disabled={busy} onClick={() => setStatus('unresolved')}>{t('detail.reopen')}</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ background: 'var(--bg-deep)', borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}
