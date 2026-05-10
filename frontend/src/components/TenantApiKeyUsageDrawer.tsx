'use client';

import { useEffect, useState } from 'react';

/**
 * Per-key usage drawer — shared between the owner self-service flow
 * (`/settings/api-keys`) and the superadmin mint-on-behalf tab. Both render
 * exactly the same drawer when a row is expanded; only the `load` callback
 * differs (owner-tenant scoped vs admin-can-see-any-tenant). The drawer
 * decides its own visibility (caller passes `expanded` and `onClose`); no
 * prop-drilled state machine.
 */

export interface UsageRow {
  id: number;
  createdAt: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retries: number;
  streamed: boolean;
  useCase: string | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string | null;
  userId: string | null;
}

export interface UsageSummary {
  total: number;
  totalTokens: number;
  modelCount: number;
}

export interface UsageResult {
  summary: UsageSummary;
  rows: UsageRow[];
  days: number;
  page: number;
  limit: number;
}

interface Props {
  /** When false, the drawer renders nothing — self-managed visibility. */
  expanded: boolean;
  /** Caller's loader. Owner uses `tenantApiKeysApi.usage`, admin uses `adminApi.tenantApiKeyUsage`. */
  load: (params: { days: number; page: number; limit: number }) => Promise<UsageResult>;
}

const cardWrap: React.CSSProperties = {
  marginTop: 10,
  padding: 14,
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
};

const summaryGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 12,
  marginBottom: 14,
};

const summaryCell: React.CSSProperties = {
  padding: '10px 12px',
  background: 'var(--bg-elevated)',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
};

const fmtNum = (n: number) => n.toLocaleString();
const fmtDate = (iso: string) => new Date(iso).toLocaleString();

export function TenantApiKeyUsageDrawer({ expanded, load }: Props) {
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    load({ days, page, limit: 50 })
      .then((r) => !cancelled && setData(r))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [expanded, days, page, load]);

  if (!expanded) return null;

  const totalPages = data ? Math.max(1, Math.ceil(data.summary.total / data.limit)) : 1;

  return (
    <div style={cardWrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Recent activity</div>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Window:{' '}
          <select value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }}>
            <option value={1}>last 24h</option>
            <option value={7}>last 7 days</option>
            <option value={30}>last 30 days</option>
            <option value={90}>last 90 days</option>
          </select>
        </label>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>Error: {error}</div>}

      {loading && !data ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : !data ? null : (
        <>
          <div style={summaryGrid}>
            <div style={summaryCell}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Requests</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{fmtNum(data.summary.total)}</div>
            </div>
            <div style={summaryCell}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total tokens</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{fmtNum(data.summary.totalTokens)}</div>
            </div>
            <div style={summaryCell}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Distinct models</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{fmtNum(data.summary.modelCount)}</div>
            </div>
          </div>

          {data.rows.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>
              No activity in this window.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ padding: '6px 8px' }}>When</th>
                    <th style={{ padding: '6px 8px' }}>Model</th>
                    <th style={{ padding: '6px 8px' }}>useCase</th>
                    <th style={{ padding: '6px 8px' }}>Tokens (p / c / total)</th>
                    <th style={{ padding: '6px 8px' }}>Retries</th>
                    <th style={{ padding: '6px 8px' }}>Stream</th>
                    <th style={{ padding: '6px 8px' }}>Idempotency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmtDate(r.createdAt)}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{r.model}</td>
                      <td style={{ padding: '6px 8px' }}>{r.useCase ?? '—'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>
                        {fmtNum(r.promptTokens)} / {fmtNum(r.completionTokens)} / {fmtNum(r.totalTokens)}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{r.retries}</td>
                      <td style={{ padding: '6px 8px' }}>{r.streamed ? '✓' : ''}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{r.idempotencyKey ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 12 }}>
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                ← Prev
              </button>
              <span style={{ color: 'var(--text-muted)' }}>Page {page} of {totalPages}</span>
              <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
