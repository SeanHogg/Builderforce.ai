'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  IntegrationStatus,
  IntegrationType,
  IntegrationTypeLabels,
  type IntegrationHealth,
  type IntegrationGap,
} from '@/types/integration';

/** ── Severity badge tones ─────────────────────────────────────────────── */
const SEVERITY_TONE: Record<IntegrationGap['severity'], string> = {
  CRITICAL: 'var(--red, #e00)',
  HIGH: 'var(--coral-bright, #ff6b5e)',
  MEDIUM: 'var(--amber, #eab308)',
  LOW: 'var(--blue, #3b82f6)',
};

/** ── Status indicator tones ────────────────────────────────────────────── */
const STATUS_COLOR: Record<IntegrationStatus, string> = {
  CONNECTED: '#22c55e',
  PARTIAL: '#f59e0b',
  MISSING: '#dc2626',
};

const MAX_RETRIES = 2;

export function AuditDashboard({
  tenantId,
  segmentId,
}: {
  tenantId: string;
  segmentId: string;
}) {
  const [data, setData] = useState<IntegrationHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [sortField, setSortField] = useState<'completenessScore' | 'lastSync' | 'status'>('completenessScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [typeFilter, setTypeFilter] = useState<IntegrationType | ''>('');
  const [statusFilter, setStatusFilter] = useState<IntegrationStatus | ''>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        tenantId,
        segmentId,
        includeGaps: 'true',
        includeRecommendations: 'true',
        sortBy: sortField,
        sortOrder: sortDir,
      });

      if (typeFilter) params.set('integrationType', typeFilter);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/v1/audit/health?${params.toString()}`);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();

      if (json.error) {
        throw new Error(json.error);
      }

      setData(json.data ?? []);
      setRetryCount(0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);

      if (retryCount < MAX_RETRIES) {
        setRetryCount((c) => c + 1);
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId, segmentId, sortField, sortDir, typeFilter, statusFilter, retryCount]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ── Derived stats ──────────────────────────────────────────────────────
  const connected = useMemo(() => data.filter((d) => d.status === 'CONNECTED').length, [data]);
  const partial = useMemo(() => data.filter((d) => d.status === 'PARTIAL').length, [data]);
  const missing = useMemo(() => data.filter((d) => d.status === 'MISSING').length, [data]);
  const averageScore = useMemo(
    () => (data.length > 0 ? data.reduce((s, d) => s + d.completenessScore, 0) / data.length : 0),
    [data],
  );

  const typeOptions: IntegrationType[] = [
    'source-control',
    'issue-tracker',
    'communication',
    'cicd',
    'monitoring',
    'calendar',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* ── Summary strip ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <SummaryCard label="Connected" value={connected} color={STATUS_COLOR.CONNECTED} />
        <SummaryCard label="Partial" value={partial} color={STATUS_COLOR.PARTIAL} />
        <SummaryCard label="Missing" value={missing} color={STATUS_COLOR.MISSING} />
        <SummaryCard label="Avg Score" value={`${averageScore.toFixed(0)}%`} color="#3b82f6" />
      </div>

      {/* ── Controls ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as IntegrationType | '')}
          style={selectStyle}
        >
          <option value="">All Types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{IntegrationTypeLabels[t]}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as IntegrationStatus | '')}
          style={selectStyle}
        >
          <option value="">All Statuses</option>
          <option value="CONNECTED">Connected</option>
          <option value="PARTIAL">Partial</option>
          <option value="MISSING">Missing</option>
        </select>

        <select
          value={`${sortField}:${sortDir}`}
          onChange={(e) => {
            const [f, d] = e.target.value.split(':');
            setSortField(f as typeof sortField);
            setSortDir(d as typeof sortDir);
          }}
          style={selectStyle}
        >
          <option value="completenessScore:asc">Score ↑</option>
          <option value="completenessScore:desc">Score ↓</option>
          <option value="lastSync:asc">Last Sync ↑</option>
          <option value="lastSync:desc">Last Sync ↓</option>
          <option value="status:asc">Status A–Z</option>
          <option value="status:desc">Status Z–A</option>
        </select>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      {loading && !error && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading integration health…</p>}

      {error && !loading && (
        <div style={{ color: 'var(--red, #e00)', fontSize: '0.85rem' }}>
          {error}{' '}
          {retryCount <= MAX_RETRIES && (
            <button onClick={() => void fetchData()} style={retryBtnStyle}>Retry</button>
          )}
          {retryCount > MAX_RETRIES && <span>(Retries exhausted)</span>}
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No integrations found for this segment.
        </p>
      )}

      {!loading && !error && data.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th>Integration</th>
                <th>Status</th>
                <th>Score</th>
                <th>Last Sync</th>
                <th>Gaps</th>
                <th>Recommendations</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <br />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {IntegrationTypeLabels[row.type as IntegrationType] ?? row.type ?? 'Unknown'}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td>
                    <ScoreBar score={row.completenessScore} />
                  </td>
                  <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                    {row.lastSync ? new Date(row.lastSync).toLocaleString() : '—'}
                  </td>
                  <td>
                    {row.gaps.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem' }}>
                        {row.gaps.map((gap, i) => (
                          <li key={i} style={{ marginBottom: 4 }}>
                            <span style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: SEVERITY_TONE[gap.severity as keyof typeof SEVERITY_TONE] ?? 'var(--text-muted)',
                              marginRight: 6,
                            }} />
                            {gap.description}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>None</span>
                    )}
                  </td>
                  <td>
                    {row.recommendations.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem' }}>
                        {row.recommendations.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: IntegrationStatus }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: '0.72rem',
        fontWeight: 700,
        border: `1px solid ${STATUS_COLOR[status]}`,
        color: STATUS_COLOR[status],
        background: `${STATUS_COLOR[status]}15`,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[status] }} />
      {status}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const clamped = Math.min(100, Math.max(0, score));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            background:
              clamped >= 80 ? '#22c55e' : clamped >= 50 ? '#f59e0b' : '#dc2626',
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span style={{ fontSize: '0.8rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span style={{ fontSize: '1.5rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: '0.8rem',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.85rem',
  color: 'var(--text-primary)',
};

const retryBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'inherit',
  border: '1px solid currentColor',
  borderRadius: 6,
  padding: '1px 9px',
  fontSize: '0.74rem',
  cursor: 'pointer',
  marginLeft: 6,
};
