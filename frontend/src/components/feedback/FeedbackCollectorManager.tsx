'use client';

/**
 * Feedback collector setup — the project's embeddable snippet.
 *
 * A project is the unit of feedback gathering: ONE collector (one ingest key =
 * one snippet) per project, so every application carrying that snippet feeds the
 * same backlog. Mirrors QualityCollectorsManager, and is gated on the same
 * quality.manageSources capability — configuring a collector is the same class
 * of act whether it gathers errors or requests.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { AUTH_API_URL } from '@/lib/auth';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { feedbackApi, type FeedbackCollector, type CreateFeedbackCollectorResult } from '@/lib/feedbackApi';

const ingestBase = `${AUTH_API_URL}/api/feedback-ingest`;

const card: React.CSSProperties = { background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20 };
const input: React.CSSProperties = { padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-deep)', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const btnSubtle: React.CSSProperties = { padding: '6px 10px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' };
const pre: React.CSSProperties = { background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12, fontSize: 12, color: 'var(--text-primary)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
const sectionTitle: React.CSSProperties = { fontWeight: 600, fontSize: 14, marginBottom: 8 };

export function FeedbackCollectorManager() {
  const t = useTranslations('feedback');
  const { projects, currentProjectId } = useProjectScope();
  const [collectors, setCollectors] = useState<FeedbackCollector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateFeedbackCollectorResult | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    feedbackApi.collectors.list()
      .then((rows) => { setCollectors(rows); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : t('setup.loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const active = useMemo(
    () => collectors.find((c) => c.projectId === currentProjectId) ?? null,
    [collectors, currentProjectId],
  );
  const projName = (id: number) => projects.find((p) => p.id === id)?.name ?? `#${id}`;

  // A collector belongs to exactly one project, so "All projects" scope has
  // nothing concrete to configure — say which switch to flip rather than
  // rendering a create form that cannot succeed.
  if (currentProjectId == null) {
    return <div style={{ ...card, fontSize: 13, color: 'var(--text-muted)' }}>{t('setup.pickProject')}</div>;
  }

  const createCollector = async () => {
    setError(null); setCreating(true);
    try {
      const res = await feedbackApi.collectors.create({
        projectId: currentProjectId,
        name: name.trim() || projName(currentProjectId),
      });
      setCreated(res); setName(''); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('setup.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('setup.intro')}</div>

      {created && <CreatedKeyPanel created={created} onDismiss={() => setCreated(null)} />}
      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('setup.loading')}</div>
      ) : active ? (
        <CollectorPanel
          collector={active}
          createdKey={created?.collector.id === active.id ? created.ingestKey : null}
          projName={projName}
          onChanged={load}
          setError={setError}
        />
      ) : (
        <RoleGate capability="quality.manageSources">
          <div style={card}>
            <div style={sectionTitle}>{t('setup.enable')}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                style={{ ...input, flex: '1 1 200px' }}
                placeholder={t('setup.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="button" style={btnPrimary} disabled={creating} onClick={createCollector}>
                {creating ? t('setup.creating') : t('setup.enableAction')}
              </button>
            </div>
          </div>
        </RoleGate>
      )}
    </div>
  );
}

function CollectorPanel({ collector, createdKey, projName, onChanged, setError }: {
  collector: FeedbackCollector;
  createdKey: string | null;
  projName: (id: number) => string;
  onChanged: () => void;
  setError: (s: string | null) => void;
}) {
  const t = useTranslations('feedback');
  const confirm = useConfirm();
  const [limit, setLimit] = useState(String(collector.dailyLimit));
  const [origins, setOrigins] = useState(collector.allowedOrigins);
  const [saving, setSaving] = useState(false);

  const keyLabel = createdKey ?? '<YOUR_INGEST_KEY>';
  const snippet = `<script src="https://unpkg.com/@seanhogg/builderforce-feedback"></script>
<script>
  BuilderforceFeedback.init({ key: '${keyLabel}', endpoint: '${ingestBase}' });
</script>`;

  const patch = async (body: Parameters<typeof feedbackApi.collectors.update>[1]) => {
    setSaving(true); setError(null);
    try { await feedbackApi.collectors.update(collector.id, body); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : t('setup.saveFailed')); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (await confirm(t('setup.confirmDelete'))) {
      await feedbackApi.collectors.remove(collector.id);
      onChanged();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14, flex: '1 1 180px', minWidth: 0 }}>
            {collector.name}
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
              {projName(collector.projectId)} · {collector.enabled ? t('setup.enabled') : t('setup.paused')}
              {collector.lastSubmissionAt
                ? ` · ${t('setup.lastSubmission')} ${new Date(collector.lastSubmissionAt).toLocaleString()}`
                : ''}
            </span>
          </span>
          <RoleGate capability="quality.manageSources">
            <button type="button" style={btnSubtle} disabled={saving} onClick={() => patch({ enabled: !collector.enabled })}>
              {collector.enabled ? t('setup.pause') : t('setup.resume')}
            </button>
            <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={remove}>
              {t('setup.delete')}
            </button>
          </RoleGate>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>{t('setup.snippetNote')}</div>
        <CopyBlock label={t('setup.snippet')} value={snippet} />
        <CopyBlock label={t('setup.endpoint')} value={`${ingestBase}/submit`} />
      </div>

      <RoleGate capability="quality.manageSources">
        <div style={card}>
          <div style={sectionTitle}>{t('setup.options')}</div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={collector.autoCreateTask}
              disabled={saving}
              onChange={(e) => patch({ autoCreateTask: e.target.checked })}
              style={{ marginTop: 3 }}
            />
            <span>
              {t('setup.autoCreateTask')}
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{t('setup.autoCreateTaskHint')}</span>
            </span>
          </label>

          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {t('setup.dailyLimit')}
            <input
              type="number"
              min={1}
              max={10000}
              style={{ ...input, marginTop: 4 }}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              onBlur={() => {
                const n = Number(limit);
                if (Number.isFinite(n) && n >= 1 && n <= 10000 && n !== collector.dailyLimit) patch({ dailyLimit: n });
                else setLimit(String(collector.dailyLimit));
              }}
            />
            <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginTop: 4 }}>
              {t('setup.dailyLimitHint')}
            </span>
          </label>

          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {t('setup.allowedOrigins')}
            <input
              type="text"
              style={{ ...input, marginTop: 4 }}
              placeholder="*"
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
              onBlur={() => { if (origins !== collector.allowedOrigins) patch({ allowedOrigins: origins }); }}
            />
            <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginTop: 4 }}>
              {t('setup.allowedOriginsHint')}
            </span>
          </label>
        </div>
      </RoleGate>
    </div>
  );
}

function CreatedKeyPanel({ created, onDismiss }: { created: CreateFeedbackCollectorResult; onDismiss: () => void }) {
  const t = useTranslations('feedback');
  const curl = `curl -X POST ${ingestBase}/submit \\
  -H "Authorization: Bearer ${created.ingestKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"kind":"feature","body":"It would be great if…"}'`;
  return (
    <div style={{ ...card, border: '1px solid var(--coral-bright)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{t('setup.created')}</div>
        <button type="button" style={btnSubtle} onClick={onDismiss}>{t('setup.dismiss')}</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('setup.keyOnce')}</div>
      <CopyBlock label={t('setup.ingestKey')} value={created.ingestKey} />
      <CopyBlock label={t('setup.curlSnippet')} value={curl} />
    </div>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const t = useTranslations('feedback');
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(value).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  });
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
        <button type="button" style={btnSubtle} onClick={copy} aria-label={t('setup.copy')}>{copied ? '✓' : '⧉'}</button>
      </div>
      <pre style={pre}>{value}</pre>
    </div>
  );
}
