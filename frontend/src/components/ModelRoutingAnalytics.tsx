'use client';

/**
 * Learned Model Routing analytics (PRD 13 §6.5). Reads the cached `routing:<scope>`
 * KV blob via `/llm/v1/model-analytics` and renders, per action type, the models
 * ranked by empirical outcome score — the same ranking the router seeds runs from.
 * Read-only; the panel is the cache (the route just reads the blob).
 */

import { useEffect, useState } from 'react';
import { llmApi, type ModelAnalyticsResponse } from '@/lib/builderforceApi';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

type Scope = 'tenant' | 'global';

function fmtScore(n: number): string {
  return n.toFixed(3);
}
function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
function fmtUsd(millicents: number): string {
  const usd = millicents / 100_000;
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function ModelRoutingAnalytics() {
  const [scope, setScope] = useState<Scope>('tenant');
  const [data, setData] = useState<ModelAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch on scope change. Loading/error are reset in the scope-change handler
  // (an event handler, not synchronously in the effect) so the spinner shows on a
  // switch without tripping react-hooks/set-state-in-effect; initial mount relies on
  // the `loading: true` initial state.
  useEffect(() => {
    let cancelled = false;
    llmApi
      .modelAnalytics(scope)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load analytics'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const switchScope = (s: Scope) => {
    if (s === scope) return;
    setLoading(true);
    setError(null);
    setData(null);
    setScope(s);
  };

  return (
    <div style={{ ...cardStyle, marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>Learned model routing</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Models ranked by how they’ve actually performed per kind of task — the order the router seeds new runs from.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['tenant', 'global'] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => switchScope(s)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: scope === s ? 'var(--bg-elevated, rgba(124,131,253,0.15))' : 'transparent',
                color: scope === s ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {s === 'tenant' ? 'This workspace' : 'Global'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</p>
      ) : error ? (
        <p style={{ fontSize: 13, color: 'var(--red-bright, #ff6b6b)' }}>{error}</p>
      ) : !data || data.byAction.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          No routing data yet. As cloud runs finish, each is scored and the best model per task type is learned here.
          Until then, runs use the curated default order.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.byAction.map((action) => (
            <div key={action.actionType}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{action.label}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px', fontWeight: 500 }}>#</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500 }}>Model</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Avg score</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Merge rate</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Runs</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Avg cost</th>
                  </tr>
                </thead>
                <tbody>
                  {action.models.map((m, i) => (
                    <tr key={m.model} style={{ color: 'var(--text-primary)', borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>{i + 1}</td>
                      <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono, monospace)' }}>{m.model}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtScore(m.avgScore)}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtPct(m.mergeRate)}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{m.samples}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{fmtUsd(m.avgCostMillicents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {data.updatedAt && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
              Updated {new Date(data.updatedAt).toLocaleString()} · scope {data.scope}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
