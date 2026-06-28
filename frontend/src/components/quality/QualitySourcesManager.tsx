'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import { AUTH_API_URL } from '@/lib/auth';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import {
  qualityApi,
  type QualitySource,
  type QualitySourceCatalogEntry,
  type CreateQualitySourceResult,
} from '@/lib/builderforceApi';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};
const inputStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 8,
  background: 'var(--bg-deep)', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};
const pre: React.CSSProperties = {
  background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12,
  fontSize: 12, color: 'var(--text-primary)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};

const ingestBase = `${AUTH_API_URL}/api/quality-ingest`;

/**
 * Manage Quality ingest sources. Creating a source mints a one-time ingest key
 * and shows the copyable wiring (browser SDK / curl / OTLP endpoint / webhook URL)
 * — mirrors the board-connections manager. Management is gated quality.manageSources.
 */
export function QualitySourcesManager() {
  const t = useTranslations('quality');
  const { projects, currentProjectId } = useProjectScope();
  const [catalog, setCatalog] = useState<QualitySourceCatalogEntry[]>([]);
  const [sources, setSources] = useState<QualitySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreateQualitySourceResult | null>(null);

  const [projectId, setProjectId] = useState<number | ''>(currentProjectId ?? '');
  const [sourceType, setSourceType] = useState('native');
  const [name, setName] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  const selectedMeta = useMemo(() => catalog.find((s) => s.id === sourceType), [catalog, sourceType]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([qualityApi.sourceCatalog(), qualityApi.sources.list()])
      .then(([cat, srcs]) => { setCatalog(cat); setSources(srcs); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load sources'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (currentProjectId != null) setProjectId(currentProjectId); }, [currentProjectId]);

  const resetForm = () => { setSourceType('native'); setName(''); setWebhookSecret(''); };

  const add = async () => {
    setError(null);
    if (!projectId) { setError(t('sources.needProject')); return; }
    if (!name.trim()) { setError(t('sources.needName')); return; }
    setSaving(true);
    try {
      const res = await qualityApi.sources.create({
        projectId: Number(projectId),
        source: sourceType,
        name: name.trim(),
        webhookSecret: webhookSecret.trim() || null,
      });
      setCreated(res);
      resetForm(); setAdding(false); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create source');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: QualitySource) => {
    await qualityApi.sources.update(s.id, { enabled: !s.enabled });
    load();
  };
  const remove = async (s: QualitySource) => {
    if (confirm(t('sources.confirmDelete'))) { await qualityApi.sources.remove(s.id); load(); }
  };

  const projName = (id: number) => projects.find((p) => p.id === id)?.name ?? `#${id}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('sources.intro')}</div>

      {created && (
        <CreatedSourcePanel created={created} onDismiss={() => setCreated(null)} t={t} />
      )}

      <div style={cardStyle}>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
        ) : sources.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('sources.empty')}</div>
        ) : (
          sources.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--coral-bright)', minWidth: 70 }}>{s.source}</span>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
                {s.name}
                <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                  {projName(s.projectId)} · {s.enabled ? t('sources.enabled') : t('sources.paused')}
                  {s.lastEventAt ? ` · ${t('sources.lastEvent')} ${new Date(s.lastEventAt).toLocaleString()}` : ''}
                </span>
              </span>
              <RoleGate capability="quality.manageSources">
                <button type="button" style={btnSubtle} onClick={() => toggle(s)}>{s.enabled ? t('sources.pause') : t('sources.resume')}</button>
                <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(s)}>{t('sources.delete')}</button>
              </RoleGate>
            </div>
          ))
        )}

        {error && <div role="alert" style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 10 }}>{error}</div>}

        <RoleGate capability="quality.manageSources">
          {adding ? (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--bg-deep)', borderRadius: 10 }}>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} style={inputStyle} aria-label={t('sources.project')}>
                <option value="">{t('sources.selectProject')}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Select value={sourceType} onChange={(e) => setSourceType(e.target.value)} style={inputStyle} aria-label={t('sources.type')}>
                {catalog.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
              {selectedMeta && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedMeta.hint}</div>}
              <input style={inputStyle} placeholder={t('sources.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
              {selectedMeta?.supportsWebhook && (
                <input style={inputStyle} placeholder={t('sources.secretPlaceholder')} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={btnPrimary} disabled={saving} onClick={add}>{saving ? t('sources.creating') : t('sources.create')}</button>
                <button type="button" style={btnSubtle} onClick={() => { setAdding(false); resetForm(); setError(null); }}>{t('sources.cancel')}</button>
              </div>
            </div>
          ) : (
            <button type="button" style={{ ...btnPrimary, marginTop: 14 }} onClick={() => setAdding(true)}>{t('sources.add')}</button>
          )}
        </RoleGate>
      </div>
    </div>
  );
}

/** The one-time key + wiring panel shown right after a source is created. */
function CreatedSourcePanel({ created, onDismiss, t }: { created: CreateQualitySourceResult; onDismiss: () => void; t: ReturnType<typeof useTranslations> }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(null), 1500); });
  };

  const key = created.ingestKey;
  const sdkSnippet = `<script src="https://unpkg.com/@seanhogg/builderforce-quality"></script>
<script>
  BuilderforceQuality.init({
    key: '${key}',
    endpoint: '${ingestBase}',
  });
</script>`;
  const curlSnippet = `curl -X POST ${ingestBase}/events \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '[{"type":"TypeError","message":"x is not a function","level":"error"}]'`;
  const webhookUrl = `${AUTH_API_URL}${created.webhookUrl}`;
  const otlpUrl = `${AUTH_API_URL}${created.otlpEndpoint}`;

  return (
    <div style={{ ...cardStyle, border: '1px solid var(--coral-bright)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{t('sources.created')}</div>
        <button type="button" style={btnSubtle} onClick={onDismiss}>{t('detail.close')}</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('sources.keyOnce')}</div>

      <Block label={t('sources.ingestKey')} value={key} copied={copied} onCopy={copy} />
      <Block label={t('sources.sdkSnippet')} value={sdkSnippet} copied={copied} onCopy={copy} />
      <Block label={t('sources.curlSnippet')} value={curlSnippet} copied={copied} onCopy={copy} />
      <Block label={t('sources.otlpEndpoint')} value={otlpUrl} copied={copied} onCopy={copy} />
      <Block label={t('sources.webhookUrl')} value={webhookUrl} copied={copied} onCopy={copy} />
    </div>
  );
}

function Block({ label, value, copied, onCopy }: { label: string; value: string; copied: string | null; onCopy: (label: string, text: string) => void }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
        <button type="button" style={btnSubtle} onClick={() => onCopy(label, value)}>{copied === label ? '✓' : '⧉'}</button>
      </div>
      <pre style={pre}>{value}</pre>
    </div>
  );
}
