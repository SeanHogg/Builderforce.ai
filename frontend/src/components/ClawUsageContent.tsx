'use client';

import { useState, useEffect } from 'react';
import { usageApi, type UsageSnapshot } from '@/lib/builderforceApi';

interface ClawUsageContentProps {
  clawId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function BarFill({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div
      style={{
        height: 6,
        borderRadius: 3,
        background: 'var(--bg-elevated)',
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
    </div>
  );
}

export function ClawUsageContent({ clawId }: ClawUsageContentProps) {
  const [snapshots, setSnapshots] = useState<UsageSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    usageApi
      .list(clawId)
      .then(setSnapshots)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clawId]);

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading usage…</div>;
  if (error) return <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>Error: {error}</div>;

  // Aggregate totals from all snapshots
  const totalInput = snapshots.reduce((s, x) => s + x.inputTokens, 0);
  const totalOutput = snapshots.reduce((s, x) => s + x.outputTokens, 0);
  const totalContext = snapshots.reduce((s, x) => s + x.contextTokens, 0);
  const totalCompactions = snapshots.reduce((s, x) => s + x.compactionCount, 0);
  const maxContext = snapshots.reduce((m, x) => Math.max(m, x.contextWindowMax ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Aggregate summary */}
      <div
        style={{
          ...cardStyle,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }}
      >
        {[
          { label: 'Input tokens', value: formatNum(totalInput), color: 'var(--coral-bright, #f4726e)' },
          { label: 'Output tokens', value: formatNum(totalOutput), color: 'var(--cyan-bright, #00e5cc)' },
          { label: 'Context tokens', value: formatNum(totalContext), color: 'var(--text-secondary)' },
          { label: 'Compactions', value: String(totalCompactions), color: 'var(--text-muted)' },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Per-snapshot rows */}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        Snapshots ({snapshots.length})
      </div>
      {snapshots.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          No usage snapshots yet.
        </div>
      ) : (
        snapshots.map((snap) => {
          const windowMax = snap.contextWindowMax ?? maxContext;
          const contextPct = windowMax > 0 ? Math.round((snap.contextTokens / windowMax) * 100) : 0;
          return (
            <div key={snap.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {snap.sessionKey ?? '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(snap.ts).toLocaleString()}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                {[
                  { label: 'Input', value: formatNum(snap.inputTokens), color: 'var(--coral-bright, #f4726e)' },
                  { label: 'Output', value: formatNum(snap.outputTokens), color: 'var(--cyan-bright, #00e5cc)' },
                  { label: 'Context', value: formatNum(snap.contextTokens), color: 'var(--text-secondary)' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
                  </div>
                ))}
              </div>
              {windowMax > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span>Context window</span>
                    <span>{contextPct}% of {formatNum(windowMax)}</span>
                  </div>
                  <BarFill value={snap.contextTokens} max={windowMax} color="var(--cyan-bright, #00e5cc)" />
                </div>
              )}
              {snap.compactionCount > 0 && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  Compactions: {snap.compactionCount}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
