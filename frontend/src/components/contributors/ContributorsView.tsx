import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { analyticsApi, type ActivityCalendar, type ContributorCalendar } from '@/lib/builderforceApi';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { TenantActivityPanel } from './TenantActivityPanel';
import { Heatmap, HeatmapLegend } from './ContributorHeatmap';
import { contributorSearch, rankContributors, useContributorsDescriptor } from './contributorsCollection';
import { useFormat } from '@/i18n/useFormat';
import { faultMessage } from '@/lib/apiClient';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { StatTile } from '@/components/ui/StatTile';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0,
};

/**
 * Contributors → whole-team activity calendar (humans via git/PR activity, AI
 * agents via BuilderForce telemetry). Self-contained content surface: owns its
 * own data fetch, sync action, and leaderboard; the host page supplies the
 * heading chrome. Rendered standalone and as the activity half of the
 * Performance tab. The leaderboard renders through the ONE Collection (PRD 47);
 * profile consolidation lives on the Workforce directory, so this surface is
 * activity-only (read-only collection).
 */
export function ContributorsView() {
  const errorMessage = useErrorMessage();
  const fmt = useFormat();
  const t = useTranslations('contributors');
  const [data, setData] = useState<ActivityCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null); // null = whole team

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    analyticsApi.activityCalendar()
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [errorMessage]);

  useEffect(() => { load(); }, [load]);

  const syncAgents = async () => {
    setSyncing(true);
    try {
      await analyticsApi.syncAgents();
      load();
    } catch (e) {
      setError(faultMessage(e, t('syncFailed')));
    } finally {
      setSyncing(false);
    }
  };

  const descriptor = useContributorsDescriptor(selected, setSelected);
  const ranked = useMemo(() => rankContributors(data?.contributors ?? []), [data]);

  const from = useMemo(() => (data ? new Date(data.range.from) : new Date()), [data]);
  const to = useMemo(() => (data ? new Date(data.range.to) : new Date()), [data]);

  const selectedContributor: ContributorCalendar | null =
    selected != null ? data?.contributors.find((c) => c.id === selected) ?? null : null;

  const teamCells = selectedContributor ? selectedContributor.days : data?.calendar ?? [];
  const teamKind: 'human' | 'agent' = selectedContributor?.kind ?? 'human';

  const humans = data?.contributors.filter((c) => c.kind === 'human') ?? [];
  const agents = data?.contributors.filter((c) => c.kind === 'agent') ?? [];
  const totalContributions = data?.calendar.reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 12, marginBottom: 20 }}>
        <button
          onClick={syncAgents}
          disabled={syncing}
          style={{
            flexShrink: 0,
            fontSize: 13, padding: '8px 14px', borderRadius: 'var(--radius-md)', cursor: syncing ? 'default' : 'pointer',
            background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? t('syncing') : t('syncAgents')}
        </button>
      </div>

      <TenantActivityPanel />

      {loading && <div style={cardStyle}>{t('loading')}</div>}
      {error && <div style={{ ...cardStyle, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}

      {data && !loading && (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
            <StatTile label={t('stat.contributions')} value={fmt.number(totalContributions)} />
            <StatTile label={t('stat.teamMembers')} value={String(data.contributors.length)} />
            <StatTile label={t('stat.humans')} value={String(humans.length)} tone="success" />
            <StatTile label={t('stat.agents')} value={String(agents.length)} tone="accent" />
          </div>

          {/* Team / selected calendar */}
          <div style={{ ...cardStyle, marginBottom: 20, overflowX: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {selectedContributor ? selectedContributor.displayName : t('wholeTeam')}
              </h2>
              {selectedContributor && (
                <button onClick={() => setSelected(null)} style={linkBtn}>{t('backToTeam')}</button>
              )}
            </div>
            <Heatmap from={from} to={to} cells={teamCells} kind={teamKind} />
            <HeatmapLegend />
          </div>

          {/* Per-contributor leaderboard */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>{t('leaderboard')}</h2>
            <LocalCollection descriptor={descriptor} rows={ranked} searchText={contributorSearch} />
          </div>
        </>
      )}
    </>
  );
}
