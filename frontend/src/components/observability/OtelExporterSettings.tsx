'use client';

/**
 * Where this workspace sends its agent telemetry.
 *
 * Every run's lifecycle and tool calls were already recorded and could not leave,
 * so a team already running Honeycomb, Datadog or Grafana saw agent work as an
 * island. This card is the door: a collector endpoint, its auth header, and — the
 * part that matters once it is running — whether spans are actually arriving.
 *
 * A silently-failing exporter is the real failure mode here, which is why the
 * health line is as prominent as the endpoint rather than hidden behind a detail
 * view. Self-gating: it renders the not-entitled hint instead of the controls.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { usePermission } from '@/lib/rbac';
import { faultMessage } from '@/lib/apiClient';
import { observabilityExportApi, type OtelExporter } from '@/lib/observabilityExportApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};
const field: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 'var(--font-size-body)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
};
const label: React.CSSProperties = { display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 650, color: 'var(--text-secondary)', margin: '0 0 5px' };
const primary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 'var(--font-size-body)', fontWeight: 650, background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const subtle: React.CSSProperties = {
  padding: '6px 11px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};

export function OtelExporterSettings() {
  const t = useTranslations('otelExport');
  const confirm = useConfirm();
  const { allowed, requiredLabel } = usePermission('integrations.manage');
  const [exporters, setExporters] = useState<OtelExporter[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [headerName, setHeaderName] = useState('');
  const [headerValue, setHeaderValue] = useState('');

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return; }
    setLoading(true);
    try {
      setExporters(await observabilityExportApi.list());
      setError(null);
    } catch (e) {
      setError(faultMessage(e));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { void load(); }, [load]);

  const httpsOk = /^https:\/\//i.test(endpoint.trim());
  const canAdd = name.trim().length > 0 && httpsOk && !busy;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    setBusy(true);
    try {
      await observabilityExportApi.create({
        name: name.trim(),
        endpoint: endpoint.trim(),
        ...(headerName.trim() && headerValue.trim() ? { headers: { [headerName.trim()]: headerValue.trim() } } : {}),
      });
      setName(''); setEndpoint(''); setHeaderName(''); setHeaderValue('');
      await load();
    } catch (err) {
      setError(faultMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); await load(); }
    catch (e) { setError(faultMessage(e)); }
    finally { setBusy(false); }
  };

  if (!allowed) {
    return (
      <div style={card}>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>{t('title')}</div>
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('requiresRole', { role: requiredLabel })}</p>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontWeight: 650, fontSize: 'var(--font-size-card-title)', marginBottom: 6 }}>{t('title')}</div>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('intro')}</p>

      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>{error}</p>}

      {loading ? (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('loading')}</p>
      ) : exporters.length === 0 ? (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('empty')}</p>
      ) : (
        exporters.map((exporter) => (
          <div key={exporter.id} style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{exporter.name}</strong>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{exporter.endpoint}</p>
              </div>
              <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 650, color: !exporter.enabled ? 'var(--text-muted)' : exporter.consecutiveFailures > 0 ? 'var(--danger)' : 'var(--success)' }}>
                ● {!exporter.enabled ? t('status.paused') : exporter.consecutiveFailures > 0 ? t('status.failing', { count: exporter.consecutiveFailures }) : t('status.healthy')}
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
              {exporter.lastError
                ? t('lastError', { error: exporter.lastError })
                : exporter.lastExportAt
                  ? t('lastExport', { at: new Date(exporter.lastExportAt).toLocaleString() })
                  : t('neverExported')}
            </p>
            <RoleGate capability="integrations.manage" variant="inline">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button type="button" style={subtle} disabled={busy} onClick={() => void act(() => observabilityExportApi.update(exporter.id, { enabled: !exporter.enabled }))}>
                  {exporter.enabled ? t('pause') : t('resume')}
                </button>
                {exporter.hasHeaders && (
                  <button type="button" style={subtle} disabled={busy} onClick={() => void act(() => observabilityExportApi.update(exporter.id, { headers: null }))}>
                    {t('clearHeaders')}
                  </button>
                )}
                <button type="button" style={{ ...subtle, color: 'var(--danger)' }} disabled={busy} onClick={() => void act(async () => {
                  if (!(await confirm({ message: t('confirmRemove', { name: exporter.name }), destructive: true }))) return;
                  await observabilityExportApi.remove(exporter.id);
                })}>
                  {t('remove')}
                </button>
              </div>
            </RoleGate>
          </div>
        ))
      )}

      <RoleGate capability="integrations.manage" variant="inline">
        <form onSubmit={add} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, marginTop: 8, display: 'grid', gap: 12 }}>
          <div>
            <label style={label} htmlFor="otel-name">{t('form.nameLabel')}</label>
            <input id="otel-name" style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('form.namePlaceholder')} />
          </div>
          <div>
            <label style={label} htmlFor="otel-endpoint">{t('form.endpointLabel')}</label>
            <input id="otel-endpoint" style={field} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.honeycomb.io" inputMode="url" />
            <p style={{ fontSize: 'var(--font-size-eyebrow)', color: endpoint && !httpsOk ? 'var(--danger)' : 'var(--text-muted)', margin: '5px 0 0' }}>
              {endpoint && !httpsOk ? t('form.endpointMustBeHttps') : t('form.endpointHint')}
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <label style={label} htmlFor="otel-header-name">{t('form.headerNameLabel')}</label>
              <input id="otel-header-name" style={field} value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="x-honeycomb-team" />
            </div>
            <div>
              <label style={label} htmlFor="otel-header-value">{t('form.headerValueLabel')}</label>
              <input id="otel-header-value" style={field} type="password" value={headerValue} onChange={(e) => setHeaderValue(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: 0 }}>{t('form.headerHint')}</p>
          <div>
            <button type="submit" style={{ ...primary, opacity: canAdd ? 1 : 0.6, cursor: canAdd ? 'pointer' : 'not-allowed' }} disabled={!canAdd}>{t('form.add')}</button>
          </div>
        </form>
      </RoleGate>
    </div>
  );
}
