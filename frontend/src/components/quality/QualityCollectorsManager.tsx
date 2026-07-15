'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { AUTH_API_URL } from '@/lib/auth';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import {
  qualityApi,
  type QualityCollector,
  type QualitySourceCatalogEntry,
  type CreateQualityCollectorResult,
  type QualityIntegration,
  type QualityMappingRule,
} from '@/lib/builderforceApi';
import { ErrorConsumptionCard } from './ErrorConsumptionCard';

const ingestBase = `${AUTH_API_URL}/api/quality-ingest`;

const card: React.CSSProperties = { background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20 };
const input: React.CSSProperties = { padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-deep)', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const btnSubtle: React.CSSProperties = { padding: '6px 10px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' };
const pre: React.CSSProperties = { background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12, fontSize: 12, color: 'var(--text-primary)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
const sectionTitle: React.CSSProperties = { fontWeight: 600, fontSize: 14, marginBottom: 8 };

/**
 * Quality collectors — a project is the unit of error gathering: ONE collector
 * (one ingest key = one embeddable snippet) per project, serving all its repos and
 * channels (native SDK, OTLP, provider webhooks). At "All projects" scope this
 * manages the optional tenant-level collector that routes a mixed stream to
 * projects via error-mapping rules. Management is gated quality.manageSources.
 */
export function QualityCollectorsManager() {
  const t = useTranslations('quality');
  const { projects, currentProjectId } = useProjectScope();
  const [collectors, setCollectors] = useState<QualityCollector[]>([]);
  const [catalog, setCatalog] = useState<QualitySourceCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateQualityCollectorResult | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const isTenant = currentProjectId == null;

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([qualityApi.collectors.list(), qualityApi.sourceCatalog()])
      .then(([cols, cat]) => { setCollectors(cols); setCatalog(cat); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load collectors'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = useMemo(
    () => collectors.find((c) => (isTenant ? c.projectId == null : c.projectId === currentProjectId)) ?? null,
    [collectors, isTenant, currentProjectId],
  );
  const projName = (id: number) => projects.find((p) => p.id === id)?.name ?? `#${id}`;

  const createCollector = async () => {
    setError(null); setCreating(true);
    try {
      const res = await qualityApi.collectors.create({
        projectId: isTenant ? null : currentProjectId,
        name: name.trim() || (isTenant ? t('setup.tenantName') : projName(currentProjectId!)),
      });
      setCreated(res); setName(''); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create collector');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {isTenant ? t('setup.tenantIntro') : t('setup.projectIntro')}
      </div>

      {created && <CreatedKeyPanel created={created} onDismiss={() => setCreated(null)} t={t} />}
      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : active ? (
        <CollectorPanel
          collector={active}
          createdKey={created?.collector.id === active.id ? created.ingestKey : null}
          catalog={catalog}
          projects={projects}
          projName={projName}
          onChanged={load}
          setError={setError}
          t={t}
        />
      ) : (
        <RoleGate capability="quality.manageSources">
          <div style={card}>
            <div style={sectionTitle}>{isTenant ? t('setup.enableTenant') : t('setup.enableProject')}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input style={input} placeholder={t('setup.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
              <button type="button" style={btnPrimary} disabled={creating} onClick={createCollector}>
                {creating ? t('setup.creating') : t('setup.enable')}
              </button>
            </div>
          </div>
        </RoleGate>
      )}
    </div>
  );
}

function CollectorPanel({
  collector, createdKey, catalog, projects, projName, onChanged, setError, t,
}: {
  collector: QualityCollector;
  createdKey: string | null;
  catalog: QualitySourceCatalogEntry[];
  projects: { id: number; name: string }[];
  projName: (id: number) => string;
  onChanged: () => void;
  setError: (s: string | null) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const confirm = useConfirm();
  const isTenant = collector.projectId == null;
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const keyLabel = createdKey ?? '<YOUR_INGEST_KEY>';
  const sdkSnippet = `<script src="https://unpkg.com/@seanhogg/builderforce-quality"></script>
<script>
  BuilderforceQuality.init({ key: '${keyLabel}', endpoint: '${ingestBase}' });
</script>`;

  const toggle = async () => { await qualityApi.collectors.update(collector.id, { enabled: !collector.enabled }); onChanged(); };
  const remove = async () => { if (await confirm(t('setup.confirmDelete'))) { await qualityApi.collectors.remove(collector.id); onChanged(); } };
  const test = async () => {
    setTesting(true); setTestMessage(null); setError(null);
    try {
      await qualityApi.collectors.test(collector.id);
      setTestMessage(t('setup.testSucceeded'));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('setup.testFailed'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ErrorConsumptionCard collectorId={collector.id} collectorName={collector.name} refreshKey={collector.lastEventAt} />
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>
            {collector.name}
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              {isTenant ? t('setup.tenantScope') : projName(collector.projectId!)} · {collector.enabled ? t('setup.enabled') : t('setup.paused')}
              {collector.lastEventAt ? ` · ${t('setup.lastEvent')} ${new Date(collector.lastEventAt).toLocaleString()}` : ''}
            </span>
          </span>
          <RoleGate capability="quality.manageSources">
            <button type="button" style={btnSubtle} disabled={testing || !collector.enabled} onClick={test}>
              {testing ? t('setup.testing') : t('setup.test')}
            </button>
            <button type="button" style={btnSubtle} onClick={toggle}>{collector.enabled ? t('setup.pause') : t('setup.resume')}</button>
            <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={remove}>{t('setup.delete')}</button>
          </RoleGate>
        </div>

        {testMessage && <div role="status" style={{ fontSize: 12, color: 'var(--success, #16a34a)', marginTop: 10 }}>{testMessage}</div>}

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>{t('setup.snippetNote')}</div>
        <CopyBlock label={t('setup.sdkSnippet')} value={sdkSnippet} />
        <CopyBlock label={t('setup.otlpEndpoint')} value={`${ingestBase}/otlp`} />
      </div>

      <IntegrationsSection collector={collector} catalog={catalog} setError={setError} t={t} />
      {isTenant && <MappingSection collector={collector} projects={projects} projName={projName} onChanged={onChanged} setError={setError} t={t} />}
    </div>
  );
}

function IntegrationsSection({ collector, catalog, setError, t }: {
  collector: QualityCollector; catalog: QualitySourceCatalogEntry[];
  setError: (s: string | null) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [items, setItems] = useState<QualityIntegration[]>([]);
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState('sentry');
  const [secret, setSecret] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [scope, setScope] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const webhookProviders = catalog.filter((c) => c.supportsWebhook);
  const load = useCallback(() => { qualityApi.collectors.integrations.list(collector.id).then(setItems).catch(() => {}); }, [collector.id]);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setProvider('sentry'); setSecret(''); setApiToken(''); setScope(''); setBaseUrl(''); };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await qualityApi.collectors.integrations.save(collector.id, {
        provider, secret: secret.trim() || null,
        apiToken: provider === 'sentry' ? apiToken.trim() || null : null,
        scope: provider === 'sentry' ? scope.trim() || null : null,
        baseUrl: provider === 'sentry' ? baseUrl.trim() || null : null,
      });
      reset(); setAdding(false); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to connect provider'); }
    finally { setBusy(false); }
  };
  const remove = async (p: string) => { await qualityApi.collectors.integrations.remove(collector.id, p); load(); };
  const backfill = async () => {
    setBackfilling(true); setMsg(null);
    try { const r = await qualityApi.collectors.integrations.backfillSentry(collector.id); setMsg(t('setup.integrations.backfillDone', { pulled: r.pulled, accepted: r.accepted })); }
    catch (e) { setMsg(e instanceof Error ? e.message : t('setup.integrations.backfillFailed')); }
    finally { setBackfilling(false); }
  };

  return (
    <div style={card}>
      <div style={sectionTitle}>{t('setup.integrations.title')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('setup.integrations.intro')}</div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('setup.integrations.none')}</div>
      ) : items.map((i) => (
        <div key={i.provider} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--coral-bright)', minWidth: 80 }}>{i.provider}</span>
            <code style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, wordBreak: 'break-all' }}>{AUTH_API_URL}{i.webhookUrl}</code>
            <RoleGate capability="quality.manageSources">
              {i.provider === 'sentry' && <button type="button" style={btnSubtle} disabled={backfilling} onClick={backfill}>{backfilling ? t('setup.integrations.backfilling') : t('setup.integrations.backfill')}</button>}
              <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(i.provider)}>{t('setup.integrations.remove')}</button>
            </RoleGate>
          </div>
          {i.provider === 'sentry' && msg && <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 90 }}>{msg}</div>}
        </div>
      ))}

      <RoleGate capability="quality.manageSources">
        {adding ? (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--bg-deep)', borderRadius: 10 }}>
            <Select value={provider} onChange={(e) => setProvider(e.target.value)} style={input} aria-label={t('setup.integrations.provider')}>
              {webhookProviders.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
            <input style={input} placeholder={t('setup.integrations.secret')} value={secret} onChange={(e) => setSecret(e.target.value)} />
            {provider === 'sentry' && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('setup.integrations.sentryHint')}</div>
                <input style={input} placeholder={t('setup.integrations.apiToken')} value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
                <input style={input} placeholder={t('setup.integrations.scope')} value={scope} onChange={(e) => setScope(e.target.value)} />
                <input style={input} placeholder={t('setup.integrations.baseUrl')} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={btnPrimary} disabled={busy} onClick={save}>{busy ? t('setup.integrations.saving') : t('setup.integrations.save')}</button>
              <button type="button" style={btnSubtle} onClick={() => { setAdding(false); reset(); }}>{t('setup.cancel')}</button>
            </div>
          </div>
        ) : (
          <button type="button" style={{ ...btnPrimary, marginTop: 12 }} onClick={() => setAdding(true)}>{t('setup.integrations.add')}</button>
        )}
      </RoleGate>
    </div>
  );
}

function MappingSection({ collector, projects, projName, onChanged, setError, t }: {
  collector: QualityCollector; projects: { id: number; name: string }[]; projName: (id: number) => string;
  onChanged: () => void; setError: (s: string | null) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const FIELDS = ['service', 'release', 'environment', 'url'];
  const OPS = ['equals', 'contains', 'prefix'];
  const [rules, setRules] = useState<QualityMappingRule[]>([]);
  const [adding, setAdding] = useState(false);
  const [matchField, setMatchField] = useState('service');
  const [matchOp, setMatchOp] = useState('equals');
  const [matchValue, setMatchValue] = useState('');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [priority, setPriority] = useState(100);
  const [busy, setBusy] = useState(false);
  const [defaultProject, setDefaultProject] = useState<number | ''>(collector.defaultProjectId ?? '');

  const load = useCallback(() => { qualityApi.collectors.rules.list(collector.id).then(setRules).catch(() => {}); }, [collector.id]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!matchValue.trim()) { setError(t('setup.mapping.needValue')); return; }
    if (!projectId) { setError(t('setup.mapping.needProject')); return; }
    setBusy(true); setError(null);
    try {
      await qualityApi.collectors.rules.create(collector.id, { matchField, matchOp, matchValue: matchValue.trim(), projectId: Number(projectId), priority });
      setMatchValue(''); setProjectId(''); setPriority(100); setAdding(false); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to add rule'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { await qualityApi.collectors.rules.remove(collector.id, id); load(); };
  const saveDefault = async (v: number | '') => {
    setDefaultProject(v);
    await qualityApi.collectors.update(collector.id, { defaultProjectId: v === '' ? null : Number(v) });
    onChanged();
  };

  return (
    <div style={card}>
      <div style={sectionTitle}>{t('setup.mapping.title')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('setup.mapping.intro')}</div>

      <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 10 }}>
        {t('setup.mapping.default')}
        <Select value={defaultProject} onChange={(e) => saveDefault(e.target.value ? Number(e.target.value) : '')} style={{ ...input, marginTop: 4 }}>
          <option value="">{t('setup.mapping.noDefault')}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </label>

      {rules.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('setup.mapping.none')}</div>
      ) : rules.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border-subtle)', fontSize: 13 }}>
          <span style={{ flex: 1 }}>
            <code style={{ color: 'var(--text-primary)' }}>{r.matchField} {r.matchOp} &quot;{r.matchValue}&quot;</code>
            <span style={{ color: 'var(--text-muted)' }}> → {projName(r.projectId)} ({t('setup.mapping.priority')} {r.priority})</span>
          </span>
          <RoleGate capability="quality.manageSources">
            <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(r.id)}>{t('setup.mapping.remove')}</button>
          </RoleGate>
        </div>
      ))}

      <RoleGate capability="quality.manageSources">
        {adding ? (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--bg-deep)', borderRadius: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Select value={matchField} onChange={(e) => setMatchField(e.target.value)} style={input} aria-label={t('setup.mapping.field')}>
                {FIELDS.map((f) => <option key={f} value={f}>{t(`setup.mapping.field_${f}`)}</option>)}
              </Select>
              <Select value={matchOp} onChange={(e) => setMatchOp(e.target.value)} style={input} aria-label={t('setup.mapping.op')}>
                {OPS.map((o) => <option key={o} value={o}>{t(`setup.mapping.op_${o}`)}</option>)}
              </Select>
            </div>
            <input style={input} placeholder={t('setup.mapping.value')} value={matchValue} onChange={(e) => setMatchValue(e.target.value)} />
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} style={input} aria-label={t('setup.mapping.project')}>
              <option value="">{t('setup.mapping.selectProject')}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('setup.mapping.priority')}
              <input style={{ ...input, marginTop: 4 }} type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={btnPrimary} disabled={busy} onClick={add}>{busy ? t('setup.mapping.saving') : t('setup.mapping.save')}</button>
              <button type="button" style={btnSubtle} onClick={() => setAdding(false)}>{t('setup.cancel')}</button>
            </div>
          </div>
        ) : (
          <button type="button" style={{ ...btnPrimary, marginTop: 12 }} onClick={() => setAdding(true)}>{t('setup.mapping.add')}</button>
        )}
      </RoleGate>
    </div>
  );
}

function CreatedKeyPanel({ created, onDismiss, t }: {
  created: CreateQualityCollectorResult; onDismiss: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const key = created.ingestKey;
  const curl = `curl -X POST ${ingestBase}/events \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '[{"type":"TypeError","message":"x is not a function","level":"error"}]'`;
  return (
    <div style={{ ...card, border: '1px solid var(--coral-bright)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{t('setup.created')}</div>
        <button type="button" style={btnSubtle} onClick={onDismiss}>{t('detail.close')}</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('setup.keyOnce')}</div>
      <CopyBlock label={t('setup.ingestKey')} value={key} />
      <CopyBlock label={t('setup.curlSnippet')} value={curl} />
    </div>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
        <button type="button" style={btnSubtle} onClick={copy}>{copied ? '✓' : '⧉'}</button>
      </div>
      <pre style={pre}>{value}</pre>
    </div>
  );
}
