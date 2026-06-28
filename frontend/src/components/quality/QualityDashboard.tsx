'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle } from '@/components/dataTableStyles';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { qualityApi, type ErrorGroup } from '@/lib/builderforceApi';
import { ErrorGroupDetail } from './ErrorGroupDetail';

const STATUSES = ['unresolved', 'fixing', 'resolved', 'ignored'] as const;
const LEVELS = ['fatal', 'error', 'warning', 'info'] as const;

const LEVEL_COLOR: Record<string, string> = {
  fatal: '#b91c1c', error: '#dc2626', warning: '#d97706', info: '#2563eb',
};
const STATUS_COLOR: Record<string, string> = {
  unresolved: 'var(--coral-bright)', fixing: '#7c3aed', resolved: '#16a34a', ignored: 'var(--text-muted)',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};
const inputStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 8,
  background: 'var(--bg-base)', color: 'var(--text-primary)',
};

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

/**
 * The error-groups dashboard — the heart of the Quality pillar. Project-scoped
 * (follows the global tenant▸project switcher), filterable by status/level, with
 * a Card|List toggle. A row opens the detail drawer where a fix is dispatched.
 */
export function QualityDashboard() {
  const t = useTranslations('quality');
  const { currentProjectId } = useProjectScope();
  const [groups, setGroups] = useState<ErrorGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('table');
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const PAGE = 50;

  const load = useCallback(() => {
    setLoading(true);
    qualityApi.groups
      .list({ projectId: currentProjectId, status: status || undefined, level: level || undefined, limit: PAGE })
      .then((p) => { setGroups(p.groups); setNextCursor(p.nextCursor); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load errors'))
      .finally(() => setLoading(false));
  }, [currentProjectId, status, level]);

  const loadMore = useCallback(() => {
    if (!nextCursor) return;
    setLoadingMore(true);
    qualityApi.groups
      .list({ projectId: currentProjectId, status: status || undefined, level: level || undefined, limit: PAGE, cursor: nextCursor })
      .then((p) => { setGroups((prev) => [...prev, ...p.groups]); setNextCursor(p.nextCursor); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load errors'))
      .finally(() => setLoadingMore(false));
  }, [nextCursor, currentProjectId, status, level]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const unresolved = groups.filter((g) => g.status === 'unresolved').length;
    const events = groups.reduce((n, g) => n + g.eventCount, 0);
    const users = groups.reduce((n, g) => n + g.userCount, 0);
    return { count: groups.length, unresolved, events, users };
  }, [groups]);

  const fmt = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label={t('summary.groups')} value={summary.count} />
        <Stat label={t('summary.unresolved')} value={summary.unresolved} />
        <Stat label={t('summary.events')} value={summary.events} />
        <Stat label={t('summary.users')} value={summary.users} />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle} aria-label={t('filter.status')}>
          <option value="">{t('filter.allStatuses')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
        <Select value={level} onChange={(e) => setLevel(e.target.value)} style={inputStyle} aria-label={t('filter.level')}>
          <option value="">{t('filter.allLevels')}</option>
          {LEVELS.map((l) => <option key={l} value={l}>{t(`level.${l}`)}</option>)}
        </Select>
        <div style={{ flex: 1 }} />
        <ViewToggle value={view} onChange={setView} card table />
      </div>

      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : groups.length === 0 ? (
        <div style={{ ...cardStyle, color: 'var(--text-muted)', fontSize: 13 }}>{t('empty')}</div>
      ) : view === 'table' ? (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('col.error')}</th>
                <th style={thStyle}>{t('col.level')}</th>
                <th style={thStyle}>{t('col.status')}</th>
                <th style={thStyle}>{t('col.events')}</th>
                <th style={thStyle}>{t('col.users')}</th>
                <th style={thStyle}>{t('col.lastSeen')}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} style={{ ...trStyle, cursor: 'pointer' }} onClick={() => setOpenId(g.id)}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{g.title}</div>
                    {g.type && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.type}</div>}
                  </td>
                  <td style={tdStyle}><Badge text={t(`level.${g.level}`)} color={LEVEL_COLOR[g.level] ?? 'var(--text-muted)'} /></td>
                  <td style={tdStyle}><Badge text={t(`status.${g.status}`)} color={STATUS_COLOR[g.status] ?? 'var(--text-muted)'} /></td>
                  <td style={tdStyle}>{g.eventCount}</td>
                  <td style={tdStyle}>{g.userCount}</td>
                  <td style={tdStyle}>{fmt(g.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {groups.map((g) => (
            <button key={g.id} type="button" style={{ ...cardStyle, textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpenId(g.id)}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <Badge text={t(`level.${g.level}`)} color={LEVEL_COLOR[g.level] ?? 'var(--text-muted)'} />
                <Badge text={t(`status.${g.status}`)} color={STATUS_COLOR[g.status] ?? 'var(--text-muted)'} />
              </div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{g.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('card.meta', { events: g.eventCount, users: g.userCount })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{fmt(g.lastSeen)}</div>
            </button>
          ))}
        </div>
      )}

      {nextCursor && groups.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600 }}
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
        </div>
      )}

      {openId && (
        <ErrorGroupDetail
          groupId={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}
