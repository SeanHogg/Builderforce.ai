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

const ok = '#00e5cc';
const bad = '#ff6b6b';
const muted = '#8a93a6';

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
        margin: 0, padding: 12, background: '#05080f', border: '1px solid #1b2436',
        borderRadius: 8, fontSize: 12, lineHeight: 1.5, overflow: 'auto',
        maxHeight: 360, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#cdd6e6',
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
      <div style={{ color: '#e6ebf5', wordBreak: 'break-word' }}>{children ?? '—'}</div>
    </div>
  );
}

export function LlmTracesPanel() {
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
      setError(e instanceof Error ? e.message : 'Failed to load traces');
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
      setError(e instanceof Error ? e.message : 'Failed to load trace');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  return (
    <div style={{ color: '#e6ebf5' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>LLM Diagnostics</h2>
        <p style={{ margin: 0, color: muted, fontSize: 13 }}>
          Paste a trace / correlation id (<code>llm-…</code>) a customer reported, or browse recent calls.
          Full request detail is recorded builder-side only.
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void load(query); }}
        style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Trace ID, correlation ID, or model…"
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #1b2436',
            background: '#080c14', color: '#e6ebf5', fontSize: 13,
          }}
        />
        <button
          type="submit"
          style={{
            padding: '8px 18px', borderRadius: 8, border: '1px solid #2a3a55',
            background: '#142033', color: '#e6ebf5', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >
          Search
        </button>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </form>

      {error && (
        <div style={{ color: bad, marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 16 }}>
        {/* List */}
        {viewMode === 'table' ? (
        <div style={{ border: '1px solid #1b2436', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#0a0f1a', color: muted, textAlign: 'left' }}>
                <th style={{ padding: '8px 10px' }}>Time</th>
                <th style={{ padding: '8px 10px' }}>Trace</th>
                <th style={{ padding: '8px 10px' }}>Model</th>
                <th style={{ padding: '8px 10px' }}>Status</th>
                <th style={{ padding: '8px 10px' }}>ms</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} style={{ padding: 16, color: muted }}>Loading…</td></tr>
              )}
              {!loading && traces.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, color: muted }}>No traces found.</td></tr>
              )}
              {traces.map((t) => (
                <tr
                  key={t.traceId}
                  onClick={() => void openTrace(t.traceId)}
                  style={{
                    cursor: 'pointer', borderTop: '1px solid #131b2a',
                    background: selected?.traceId === t.traceId ? '#101826' : 'transparent',
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
          <div style={{ padding: 16, color: muted, fontSize: 13 }}>Loading…</div>
        ) : traces.length === 0 ? (
          <div style={{ padding: 16, color: muted, fontSize: 13 }}>No traces found.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {traces.map((t) => (
              <div
                key={t.traceId}
                role="button"
                tabIndex={0}
                onClick={() => void openTrace(t.traceId)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openTrace(t.traceId); } }}
                style={{
                  cursor: 'pointer',
                  background: 'var(--bg-elevated, #0a0f1a)',
                  border: `1px solid ${selected?.traceId === t.traceId ? '#2a3a55' : 'var(--border-subtle, #1b2436)'}`,
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontFamily: 'monospace', fontSize: 11, color: '#9fb0cc' }}>
                    {t.traceId.replace(/^llm-/, '').slice(0, 8)}…
                  </code>
                  {pill(`${t.status ?? '—'}`, t.success ? ok : bad)}
                </div>
                <div style={{ fontSize: 13, color: '#e6ebf5', wordBreak: 'break-word' }}>{t.resolvedModel ?? '—'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: muted }}>
                  <span>{t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}</span>
                  <span>{t.durationMs} ms</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Detail */}
        {selected && (
          <div style={{ border: '1px solid #1b2436', borderRadius: 10, padding: 16, maxHeight: 700, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <code style={{ fontSize: 12, color: '#9fb0cc' }}>{selected.traceId}</code>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', color: muted, cursor: 'pointer', fontSize: 18 }}
              >
                ×
              </button>
            </div>

            {detailLoading ? (
              <div style={{ color: muted }}>Loading…</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {pill(selected.success ? 'SUCCESS' : 'FAILED', selected.success ? ok : bad)}
                  {selected.outcome && pill(selected.outcome, muted)}
                  {selected.classification && selected.classification !== 'none' && pill(selected.classification, bad)}
                  {selected.streamed && pill('streamed', muted)}
                </div>

                <Field label="Status">{selected.status}</Field>
                <Field label="Duration">{selected.durationMs} ms</Field>
                <Field label="Surface">{selected.surface}</Field>
                <Field label="Product / Plan">{selected.llmProduct} / {selected.effectivePlan}{selected.premiumOverride ? ' (premium)' : ''}</Field>
                <Field label="Resolved model">{selected.resolvedModel} {selected.resolvedVendor ? `(${selected.resolvedVendor})` : ''}</Field>
                <Field label="Tenant / User">{selected.tenantId ?? '—'} / {selected.userId ?? '—'}</Field>
                <Field label="AgentHost / API key">{selected.agentHostId ?? '—'} / {selected.tenantApiKeyId ?? '—'}</Field>
                <Field label="Tokens">{selected.promptTokens} in / {selected.completionTokens} out / {selected.totalTokens} total</Field>
                <Field label="Attempts / retries">{selected.attemptCount} / {selected.retries}{selected.schemaRetries ? ` (+${selected.schemaRetries} schema)` : ''}</Field>
                <Field label="Use case">{selected.useCase}</Field>
                <Field label="Consumer req id">{selected.consumerRequestId}</Field>
                <Field label="Request IP">{selected.requestIp}</Field>
                <Field label="Origin">{selected.origin}</Field>
                {selected.errorMessage && (
                  <Field label="Error"><span style={{ color: bad }}>{selected.errorMessage}</span></Field>
                )}

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>Candidate chain</h4>
                <Json value={selected.candidateChain} />

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>Attempts (every model tried, every exception)</h4>
                {Array.isArray(selected.attempts) && selected.attempts.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: muted, textAlign: 'left' }}>
                        <th style={{ padding: '4px 6px' }}>Model</th>
                        <th style={{ padding: '4px 6px' }}>Vendor</th>
                        <th style={{ padding: '4px 6px' }}>Status</th>
                        <th style={{ padding: '4px 6px' }}>Kind</th>
                        <th style={{ padding: '4px 6px' }}>ms</th>
                        <th style={{ padding: '4px 6px' }}>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.attempts.map((a, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #131b2a' }}>
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
                ) : (
                  <div style={{ color: muted, fontSize: 12 }}>No failed attempts — first model answered.</div>
                )}

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>Request shape</h4>
                <Json value={selected.requestShape} />

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>Request body</h4>
                <Json value={selected.requestBody} />

                <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>Response body</h4>
                <Json value={selected.responseBody} />

                {selected.callerMetadata != null && (
                  <>
                    <h4 style={{ margin: '16px 0 6px', fontSize: 13, color: muted }}>Caller metadata</h4>
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
