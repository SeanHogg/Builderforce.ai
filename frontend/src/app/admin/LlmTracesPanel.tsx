'use client';

/**
 * Superadmin LLM diagnostics — paste a trace / correlation id (the
 * `llm-…` value a customer quotes from a failed call) and pull up everything
 * the gateway recorded: who called, how long it ran, every model attempt, every
 * exception, the candidate chain, and the full request/response bodies.
 *
 * This data lives only on the builder side; callers only ever receive the trace
 * id. Rendered both at /admin/llm-traces and as the "LLM Traces" admin tab.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/adminApi';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';

interface Attempt {
  model: string;
  vendor: string;
  status: number;
  error?: string;
  durationMs?: number;
  kind?: string;
}

interface TraceSummary {
  traceId: string;
  createdAt: string | null;
  tenantId: number | null;
  userId: string | null;
  surface: string;
  llmProduct: string | null;
  resolvedModel: string | null;
  resolvedVendor: string | null;
  status: number | null;
  success: boolean;
  outcome: string | null;
  classification: string | null;
  attemptCount: number;
  retries: number;
  schemaRetries: number;
  durationMs: number;
  totalTokens: number;
  useCase: string | null;
  consumerRequestId: string | null;
  streamed: boolean;
  errorMessage: string | null;
}

interface TraceDetail extends TraceSummary {
  effectivePlan: string | null;
  premiumOverride: boolean;
  agentHostId: number | null;
  tenantApiKeyId: string | null;
  promptTokens: number;
  completionTokens: number;
  idempotencyKey: string | null;
  requestIp: string | null;
  origin: string | null;
  userAgent: string | null;
  requestShape: unknown;
  candidateChain: unknown;
  attempts: Attempt[] | null;
  requestBody: unknown;
  responseBody: unknown;
  callerMetadata: unknown;
}

const ok = 'var(--cyan-bright)';
const bad = 'var(--error)';
const muted = 'var(--text-muted)';

function pill(text: string, color: string) {
  return (
    <span
      style={{
        display: 'inline-block', padding: '1px 8px', borderRadius: 999,
        fontSize: 11, fontWeight: 600, color, border: `1px solid ${color}55`,
        background: `${color}14`, whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

function Json({ value }: { value: unknown }) {
  if (value == null) return <span style={{ color: muted }}>—</span>;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      style={{
        margin: 0, padding: 12, background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)',
        borderRadius: 8, fontSize: 12, lineHeight: 1.5, overflow: 'auto',
        maxHeight: 360, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-secondary)',
      }}
    >
      {text}
    </pre>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13, padding: '3px 0' }}>
      <div style={{ width: 150, color: muted, flexShrink: 0 }}>{label}</div>
      <div style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{children ?? '—'}</div>
    </div>
  );
}

export function LlmTracesPanel() {
  const t = useTranslations('admin');
  const [query, setQuery] = useState('');
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Card/list view toggle for the trace summary list — default 'table'.
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.listLlmTraces({ q: q.trim() || undefined, limit: 100 });
      setTraces(data.traces ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('traces.loadTracesFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(''); }, [load]);

  const openTrace = useCallback(async (traceId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const data = await adminApi.getLlmTrace(traceId);
      setSelected(data.trace);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('traces.loadTraceFailed'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  return (
    <div style={{ color: 'var(--text-primary)' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>{t('traces.heading')}</h2>
        <p style={{ margin: 0, color: muted, fontSize: 13 }}>
          {t('traces.introBefore')}<code>llm-…</code>{t('traces.introAfter')}
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void load(query); }}
        style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('traces.searchPlaceholder')}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)',
            background: 'var(--bg-deep)', color: 'var(--text-primary)', fontSize: 13,
          }}
        />
        <button
          type="submit"
          style={{
            padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border-accent)',
            background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >
          {t('traces.search')}
        </button>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </form>

      {error && (
        <div style={{ color: bad, marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 16 }}>
        {/* List */}
        {viewMode === 'table' ? (
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, overflowX: 'auto', overflowY: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--bg-base)', color: muted, textAlign: 'left' }}>
                <th style={{ padding: '8px 10px' }}>{t('traces.colTime')}</th>
                <th style={{ padding: '8px 10px' }}>{t('traces.colTrace')}</th>
                <th style={{ padding: '8px 10px' }}>{t('traces.colModel')}</th>
                <th style={{ padding: '8px 10px' }}>{t('traces.colStatus')}</th>
                <th style={{ padding: '8px 10px' }}>{t('traces.colMs')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} style={{ padding: 16, color: muted }}>{t('common.loading')}</td></tr>
              )}
              {!loading && traces.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, color: muted }}>{t('traces.noTraces')}</td></tr>
              )}
              {traces.map((t) => (
                <tr
                  key={t.traceId}
                  onClick={() => void openTrace(t.traceId)}
                  style={{
                    cursor: 'pointer', borderTop: '1px solid var(--border-subtle)',
                    background: selected?.traceId === t.traceId ? 'var(--surface-interactive)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '7px 10px', color: muted, whiteSpace: 'nowrap' }}>
                    {t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: 11 }}>
                    {t.traceId.replace(/^llm-/, '').slice(0, 8)}…
                  </td>
                  <td style={{ padding: '7px 10px' }}>{t.resolvedModel ?? '—'}</td>
                  <td style={{ padding: '7px 10px' }}>
                    {pill(`${t.status ?? '—'}`, t.success ? ok : bad)}
                  </td>
                  <td style={{ padding: '7px 10px', color: muted }}>{t.durationMs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : loading ? (
          <div style={{ padding: 16, color: muted, fontSize: 13 }}>{t('common.loading')}</div>
        ) : traces.length === 0 ? (
          <div style={{ padding: 16, color: muted, fontSize: 13 }}>{t('traces.noTraces')}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {traces.map((tr) => (
              <div
                key={tr.traceId}
                role="button"
                tabIndex={0}
                onClick={() => void openTrace(tr.traceId)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openTrace(tr.traceId); } }}
                style={{
                  cursor: 'pointer',
                  background: 'var(--bg-elevated, var(--bg-base))',
                  border: `1px solid ${selected?.traceId === tr.traceId ? 'var(--border-accent)' : 'var(--border-subtle, var(--border-subtle))'}`,
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {tr.traceId.replace(/^llm-/, '').slice(0, 8)}…
                  </code>
                  {pill(`${tr.status ?? '—'}`, tr.success ? ok : bad)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{tr.resolvedModel ?? '—'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: muted }}>
                  <span>{tr.createdAt ? new Date(tr.createdAt).toLocaleString() : '—'}</span>
                  <span>{t('traces.msValue', { value: tr.durationMs })}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Detail */}
        {selected && (
          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 16, maxHeight: 700, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <code style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{selected.traceId}</code>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', color: muted, cursor: 'pointer', fontSize: 18 }}
              >
                ×
              </button>
            </div>

            {detailLoading ? (
              <div style={{ color: muted }}>{t('common.loading')}</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {pill(selected.success ? t('traces.pillSuccess') : t('traces.pillFailed'), selected.success ? ok : bad)}
                  {selected.outcome && pill(selected.outcome, muted)}
                  {selected.classification && selected.classification !== 'none' && pill(selected.classification, bad)}
                  {selected.streamed && pill(t('traces.pillStreamed'), muted)}
                </div>

                <Field label={t('traces.fieldStatus')}>{selected.status}</Field>
                <Field label={t('traces.fieldDuration')}>{t('traces.msValue', { value: selected.durationMs })}</Field>
                <Field label={t('traces.fieldSurface')}>{selected.surface}</Field>
                <Field label={t('traces.fieldProductPlan')}>{selected.llmProduct} / {selected.effectivePlan}{selected.premiumOverride ? t('traces.premiumSuffix') : ''}</Field>
                <Field label={t('traces.fieldResolvedModel')}>{selected.resolvedModel} {selected.resolvedVendor ? `(${selected.resolvedVendor})` : ''}</Field>
                <Field label={t('traces.fieldTenantUser')}>{selected.tenantId ?? '—'} / {selected.userId ?? '—'}</Field>
                <Field label={t('traces.fieldAgentHostApiKey')}>{selected.agentHostId ?? '—'} / {selected.tenantApiKeyId ?? '—'}</Field>
                <Field label={t('traces.fieldTokens')}>{t('traces.tokensValue', { in: selected.promptTokens, out: selected.completionTokens, total: selected.totalTokens })}</Field>
                <Field label={t('traces.fieldAttemptsRetries')}>{selected.attemptCount} / {selected.retries}{selected.schemaRetries ? t('traces.schemaRetriesSuffix', { count: selected.schemaRetries }) : ''}</Field>
                <Field label={t('traces.fieldUseCase')}>{selected.useCase}</Field>
                <Field label={t('traces.fieldConsumerReqId')}>{selected.consumerRequestId}</Field>
                <Field label={t('traces.fieldRequestIp')}>{selected.requestIp}</Field>
                <Field label={t('traces.fieldOrigin')}>{selected.origin}</Field>
                {selected.errorMessage && (
                  <Field label={t('traces.fieldError')}><span style={{ color: bad }}>{selected.errorMessage}</span></Field>
                )}

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>{t('traces.candidateChain')}</h4>
                <Json value={selected.candidateChain} />

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>{t('traces.attemptsHeading')}</h4>
                {Array.isArray(selected.attempts) && selected.attempts.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 480 }}>
                    <thead>
                      <tr style={{ color: muted, textAlign: 'left' }}>
                        <th style={{ padding: '4px 6px' }}>{t('traces.attemptColModel')}</th>
                        <th style={{ padding: '4px 6px' }}>{t('traces.attemptColVendor')}</th>
                        <th style={{ padding: '4px 6px' }}>{t('traces.attemptColStatus')}</th>
                        <th style={{ padding: '4px 6px' }}>{t('traces.attemptColKind')}</th>
                        <th style={{ padding: '4px 6px' }}>{t('traces.attemptColMs')}</th>
                        <th style={{ padding: '4px 6px' }}>{t('traces.attemptColError')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.attempts.map((a, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '4px 6px' }}>{a.model}</td>
                          <td style={{ padding: '4px 6px', color: muted }}>{a.vendor}</td>
                          <td style={{ padding: '4px 6px' }}>{a.status}</td>
                          <td style={{ padding: '4px 6px', color: muted }}>{a.kind ?? '—'}</td>
                          <td style={{ padding: '4px 6px', color: muted }}>{a.durationMs ?? '—'}</td>
                          <td style={{ padding: '4px 6px', color: bad, fontSize: 11, maxWidth: 280, wordBreak: 'break-word' }}>{a.error ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                ) : (
                  <div style={{ color: muted, fontSize: 12 }}>{t('traces.noFailedAttempts')}</div>
                )}

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>{t('traces.requestShape')}</h4>
                <Json value={selected.requestShape} />

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>{t('traces.requestBody')}</h4>
                <Json value={selected.requestBody} />

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>{t('traces.responseBody')}</h4>
                <Json value={selected.responseBody} />

                {selected.callerMetadata != null && (
                  <>
                    <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>{t('traces.callerMetadata')}</h4>
                    <Json value={selected.callerMetadata} />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default LlmTracesPanel;
