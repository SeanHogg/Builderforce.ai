'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { CopyButton } from '@/components/CopyButton';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle } from '@/components/dataTableStyles';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { qualityApi, type ErrorGroup } from '@/lib/builderforceApi';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';
import { buildQualityDiagnosticsReport } from '@/lib/qualityDiagnostics';
import { ErrorGroupDetail } from './ErrorGroupDetail';
import { QualityStatsPanel } from './QualityStatsPanel';
import { ErrorConsumptionCard } from './ErrorConsumptionCard';
import { LEVELS, STATUSES, LEVEL_COLOR, STATUS_COLOR } from './qualityColors';
import { useFormat } from "@/i18n/useFormat";

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16,
};
const inputStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
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
  const fmt = useFormat();
  const t = useTranslations('quality');
  const tCommon = useTranslations('common');
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

  const buildDiagnostics = useCallback(async (): Promise<string> => {
    const filter = {
      projectId: currentProjectId,
      status: status || undefined,
      level: level || undefined,
      limit: 200,
    };
    const allGroups: ErrorGroup[] = [];
    let cursor: string | null = null;
    do {
      const page = await qualityApi.groups.list({ ...filter, cursor });
      allGroups.push(...page.groups);
      // A repeated cursor would otherwise make a malformed server response loop forever.
      if (page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    } while (cursor);

    const stats = await qualityApi.stats(currentProjectId, 30).catch(() => null);
    return buildQualityDiagnosticsReport(
      {
        projectId: currentProjectId ?? null,
        status: status || null,
        level: level || null,
        groups: allGroups,
        stats,
        statsError: stats == null ? 'the quality overview could not be loaded' : null,
      },
      await captureDiagnosticsContext(),
    );
  }, [currentProjectId, status, level]);


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-tour="demo-quality">
      {/* The plan meter is tenant-aggregate; analytics below follow project scope. */}
      <ErrorConsumptionCard />

      {/* Data-driven overview: volume collected, frequency trend + breakdowns. */}
      <QualityStatsPanel projectId={currentProjectId} />

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
        <CopyButton
          label={tCommon('copyDiagnostics')}
          ariaLabel={t('copyDiagnosticsAria')}
          getText={buildDiagnostics}
        />
        <ViewToggle value={view} onChange={setView} card table />
      </div>

      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}

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
                  <td style={tdStyle}>{fmt.dateTime(g.lastSeen)}</td>
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
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{fmt.dateTime(g.lastSeen)}</div>
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
