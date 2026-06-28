'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { llmApi, dashboardApi, type LlmUsageStats, type LlmModelStatus, type LlmHealthResponse, type DashboardUsage, type UsageByKind } from '@/lib/builderforceApi';

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

function fmtUsd(n: number) {
  if (n === 0) return '$0';
  if (n < 0.01) return `<$0.01`;
  return `$${n.toFixed(2)}`;
}

const KIND_META: Record<UsageByKind['kind'], { label: string; color: string }> = {
  cloud: { label: 'Cloud', color: 'var(--indigo-bright, #7c83fd)' },
  'on-prem': { label: 'On-prem', color: 'var(--cyan-bright, #00e5cc)' },
  web: { label: 'Web / SDK', color: 'var(--text-secondary)' },
};

export function LlmUsageContent() {
  const t = useTranslations('llmUsage');
  const [usage, setUsage] = useState<LlmUsageStats | null>(null);
  const [health, setHealth] = useState<LlmHealthResponse | null>(null);
  const [models, setModels] = useState<LlmModelStatus[]>([]);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [errorUsage, setErrorUsage] = useState<string | null>(null);
  const [errorHealth, setErrorHealth] = useState<string | null>(null);
  const [poolTab, setPoolTab] = useState<'free' | 'pro'>('free');
  const [bySource, setBySource] = useState<DashboardUsage | null>(null);

  useEffect(() => {
    llmApi
      .usage()
      .then(setUsage)
      .catch((e: Error) => setErrorUsage(e.message))
      .finally(() => setLoadingUsage(false));

    // Cloud-vs-on-prem-vs-web breakdown with estimated cost (manager surface).
    dashboardApi.usage('week').then(setBySource).catch(() => { /* optional card */ });

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
              {((poolTab === 'free' ? health.free : health.pro) ?? []).map((m) => (
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 16 }}>
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

          {/* By source — CLOUD vs ON-PREM vs WEB, with estimated cost (7-day) */}
          {bySource && bySource.byKind.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>By Source · last 7 days</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  est. {fmtUsd(bySource.totals.estimatedCostUsd)} total
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bySource.byKind.map((k) => {
                  const meta = KIND_META[k.kind];
                  return (
                    <div
                      key={k.kind}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elevated)',
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{meta.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtNum(k.requests)} req</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan-bright, #00e5cc)', flexShrink: 0 }}>{fmtNum(k.totalTokens)} tok</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, flexShrink: 0, minWidth: 56, textAlign: 'right' }}>
                        est. {fmtUsd(k.estimatedCostUsd)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                Cost is estimated from catalog per-token prices, not an authoritative billed amount.
              </div>
            </div>
          )}

          {/* By project — agent spend attributed to each project, rolling up to
              the account total above (0103). */}
          {bySource && bySource.perProject.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>By Project · last 7 days</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  rolls up to {fmtUsd(bySource.totals.estimatedCostUsd)} account total
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bySource.perProject.map((p) => (
                  <div
                    key={p.projectId ?? 'none'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elevated)',
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.projectName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtNum(p.requests)} req</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan-bright, #00e5cc)', flexShrink: 0 }}>{fmtNum(p.totalTokens)} tok</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--coral-bright, #f4726e)', flexShrink: 0, minWidth: 56, textAlign: 'right' }}>
                      est. {fmtUsd(p.estimatedCostUsd)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By user — spend attributed to each individual human / SDK caller. */}
          {bySource && bySource.perUser.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t('byUser')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('rollsUpTo', { total: fmtUsd(bySource.totals.estimatedCostUsd) })}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bySource.perUser.map((u) => (
                  <div
                    key={u.userId ?? 'none'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elevated)',
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.userName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtNum(u.requests)} req</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan-bright, #00e5cc)', flexShrink: 0 }}>{fmtNum(u.totalTokens)} tok</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--coral-bright, #f4726e)', flexShrink: 0, minWidth: 56, textAlign: 'right' }}>
                      est. {fmtUsd(u.estimatedCostUsd)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By team — usage mapped to a team via team membership. */}
          {bySource && bySource.perTeam.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t('byTeam')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('rollsUpTo', { total: fmtUsd(bySource.totals.estimatedCostUsd) })}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bySource.perTeam.map((tm) => (
                  <div
                    key={tm.teamId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elevated)',
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tm.teamName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtNum(tm.requests)} req</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan-bright, #00e5cc)', flexShrink: 0 }}>{fmtNum(tm.totalTokens)} tok</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--coral-bright, #f4726e)', flexShrink: 0, minWidth: 56, textAlign: 'right' }}>
                      est. {fmtUsd(tm.estimatedCostUsd)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By repo — spend attributed to the explicit repo of the originating task. */}
          {bySource && bySource.perRepo.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t('byRepo')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('rollsUpTo', { total: fmtUsd(bySource.totals.estimatedCostUsd) })}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bySource.perRepo.map((r) => (
                  <div
                    key={r.repoId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elevated)',
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.repoLabel}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtNum(r.requests)} req</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan-bright, #00e5cc)', flexShrink: 0 }}>{fmtNum(r.totalTokens)} tok</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--coral-bright, #f4726e)', flexShrink: 0, minWidth: 56, textAlign: 'right' }}>
                      est. {fmtUsd(r.estimatedCostUsd)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
