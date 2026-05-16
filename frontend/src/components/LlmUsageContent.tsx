'use client';

import { useState, useEffect } from 'react';
import { llmApi, type LlmUsageStats, type LlmModelStatus, type LlmHealthResponse } from '@/lib/builderforceApi';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function LlmUsageContent() {
  const [usage, setUsage] = useState<LlmUsageStats | null>(null);
  const [health, setHealth] = useState<LlmHealthResponse | null>(null);
  const [models, setModels] = useState<LlmModelStatus[]>([]);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [errorUsage, setErrorUsage] = useState<string | null>(null);
  const [errorHealth, setErrorHealth] = useState<string | null>(null);
  const [poolTab, setPoolTab] = useState<'free' | 'pro'>('free');

  useEffect(() => {
    llmApi
      .usage()
      .then(setUsage)
      .catch((e: Error) => setErrorUsage(e.message))
      .finally(() => setLoadingUsage(false));

    llmApi
      .health()
      .then(setHealth)
      .catch((e: Error) => setErrorHealth(e.message))
      .finally(() => setLoadingHealth(false));

    llmApi
      .models()
      .then((r) => setModels(r.configured ? r.data : []))
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Health / Provider Status */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>LLM Provider Status</div>
          {health && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: 6,
                background: health.status === 'ok' ? 'rgba(0,229,204,0.15)' : 'rgba(244,114,94,0.15)',
                color: health.status === 'ok' ? 'var(--cyan-bright, #00e5cc)' : 'var(--coral-bright, #f4726e)',
              }}
            >
              {health.status}
            </span>
          )}
          {loadingHealth && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</span>}
        </div>

        {errorHealth && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright)' }}>{errorHealth}</div>
        )}

        {health && (
          <>
            {/* Pool tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {(['free', 'pro'] as const).map((pool) => (
                <button
                  key={pool}
                  type="button"
                  onClick={() => setPoolTab(pool)}
                  style={{
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    background: poolTab === pool ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))' : 'var(--bg-elevated)',
                    color: poolTab === pool ? 'var(--coral-bright, #f4726e)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {pool}
                </button>
              ))}
            </div>

            {/* Model list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(poolTab === 'free' ? health.free : health.pro).map((m) => (
                <div
                  key={m.model}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    opacity: m.available ? 1 : 0.5,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: m.available ? 'var(--cyan-bright, #00e5cc)' : 'var(--text-muted)',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                    {m.model}
                  </span>
                  {m.preferred && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--coral-bright, #f4726e)' }}>
                      preferred
                    </span>
                  )}
                  {!m.available && m.cooldownUntil && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      cooldown until {new Date(m.cooldownUntil).toLocaleTimeString()}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: m.available ? 'rgba(0,229,204,0.12)' : 'var(--bg-base)',
                      color: m.available ? 'var(--cyan-bright, #00e5cc)' : 'var(--text-muted)',
                    }}
                  >
                    {m.available ? 'available' : 'cooldown'}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              As of {new Date(health.timestamp).toLocaleString()} ·{' '}
              {models.length > 0 ? `${models.length} models available` : ''}
            </div>
          </>
        )}
      </div>

      {/* Usage stats */}
      {loadingUsage && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading usage…</div>
      )}
      {errorUsage && (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--coral-bright)' }}>
          Usage unavailable: {errorUsage}
        </div>
      )}
      {usage && (
        <>
          {/* Totals */}
          <div style={{ ...cardStyle }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Usage Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Total requests', value: fmtNum(usage.totalRequests), color: 'var(--coral-bright, #f4726e)' },
                { label: 'Prompt tokens', value: fmtNum(usage.promptTokens), color: 'var(--cyan-bright, #00e5cc)' },
                { label: 'Completion tokens', value: fmtNum(usage.completionTokens), color: 'var(--text-secondary)' },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* By model */}
          {usage.byModel && usage.byModel.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>By Model</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {usage.byModel.map((m) => (
                  <div
                    key={m.model}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'var(--bg-elevated)',
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        fontSize: 12,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.model}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {fmtNum(m.requests)} req
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan-bright, #00e5cc)', flexShrink: 0 }}>
                      {fmtNum(m.tokens)} tok
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
